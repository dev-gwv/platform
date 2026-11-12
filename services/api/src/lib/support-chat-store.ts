import type { TransactionSql } from 'postgres'
import type { SupportTicketMessage } from '@ipc/contracts'
import type { Env } from '../context'
import { budgetUsed, budgetVerdict, DEFAULT_DAY_TOKENS, DEFAULT_MINUTE_TOKENS } from './ai-budget'
import { ask, DEFAULT_PROMPT, logAsk } from './assistant'
import { withService } from './db'
import { buildHelpContext } from './help-context'
import { describeError, log } from './log'
import { readSupportSettings } from './support-call-store'
import {
  AI_REPLIES_A_DAY,
  CHAT_SAY,
  chatHistory,
  escalateWhy,
  escalationPost,
  isOptWord,
  langOf,
  last10,
  MISSES_TO_ESCALATE,
  morePost,
  plainForWhatsapp,
  silenceDue,
  soundsFixed,
  soundsUnfixed,
  WHATSAPP_RULES,
  WHY_KIND,
  WHY_WORDS,
  windowOpen,
  type EscalateWhy,
} from './support-chat'
import { postToGroup, ticketLink } from './support-ticket-store'
import { sendWhatsAppTemplate, sendWhatsAppText, whatsappConfigured, type WhatsAppInbound } from './whatsapp'
import { providersFor, readSettings } from '../modules/assistant/router'

/**
 * The WhatsApp support agent (0304): what studios write to the official
 * number becomes a ticket; the assistant answers what the help can answer and
 * hands the rest to the owner in the support group. Rules: ./support-chat.ts.
 */

const OPEN = ['open', 'waiting_us', 'waiting_them'] as const

interface ChatTicket {
  id: string
  status: string
  phone: string
  contact_name: string | null
  company_id: string | null
  studio_name: string | null
  booking_id: string | null
  escalated_at: Date | null
  ai_misses: number
  last_in_at: Date | null
}

/** The studio a number belongs to: a login's phone first (an owner before staff), then the studio's invoice phone. */
async function studioByPhone(sql: TransactionSql, digits: string): Promise<string | null> {
  const ten = last10(digits)
  if (ten.length < 10) return null
  const [u] = await sql<{ company_id: string }[]>`
    select u.company_id from users u join companies c on c.id = u.company_id
     where right(regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g'), 10) = ${ten}
     order by (c.owner_user_id = u.user_id) desc limit 1`
  if (u) return u.company_id
  const [c] = await sql<{ id: string }[]>`
    select id from companies where right(regexp_replace(coalesce(invoice_phone, ''), '\\D', '', 'g'), 10) = ${ten} order by created_at limit 1`
  return c?.id ?? null
}

const CHAT_COLUMNS = `
  t.id, t.status, t.phone, t.contact_name, t.company_id, coalesce(c.display_name, c.name) as studio_name,
  t.booking_id, t.escalated_at, t.ai_misses, t.last_in_at`

async function readChat(sql: TransactionSql, id: string): Promise<ChatTicket | null> {
  const [t] = await sql.unsafe<ChatTicket[]>(`select ${CHAT_COLUMNS} from support_tickets t left join companies c on c.id = t.company_id where t.id = $1`, [id])
  return t ?? null
}

/**
 * Messages to the official number, from the webhook. Each is kept on the open
 * chat ticket of its number (or a new one) once, however often Meta posts it;
 * the answering runs after the webhook has answered Meta.
 */
export async function receiveSupportChat(env: Env, messages: readonly WhatsAppInbound[]): Promise<number> {
  const touched = new Set<string>()
  await withService(env, async (sql) => {
    for (const m of messages) {
      if (isOptWord(m.text)) continue
      const phone = m.from.replace(/\D/g, '')
      if (phone.length < 10) continue
      let [t] = await sql<{ id: string }[]>`
        select id from support_tickets
         where source = 'chat' and phone = ${phone} and status in ${sql(OPEN)}
         order by updated_at desc limit 1`
      if (!t) {
        const company = await studioByPhone(sql, phone)
        ;[t] = await sql<{ id: string }[]>`
          insert into support_tickets (source, status, phone, contact_name, company_id, summary)
          values ('chat', 'open', ${phone}, ${m.name}, ${company}, ${m.text.slice(0, 300)})
          returning id`
      }
      const kept = await sql`
        insert into support_ticket_messages (ticket_id, dir, author, body, wa_id, pending, created_at)
        values (${t!.id}, 'in', 'studio', ${m.text}, ${m.id}, true, ${m.at ?? new Date().toISOString()})
        on conflict (wa_id) do nothing returning id`
      if (!kept.length) continue
      await sql`
        update support_tickets set
          last_in_at = greatest(coalesce(last_in_at, 'epoch'), ${m.at ?? new Date().toISOString()}::timestamptz),
          contact_name = coalesce(${m.name}, contact_name),
          status = case when status = 'waiting_them' then 'open' else status end,
          updated_at = now()
        where id = ${t!.id}`
      touched.add(t!.id)
    }
  })
  for (const id of touched) {
    void answerTicket(env, id).catch((err) => log.error({ err: describeError(err), ticket: id }, 'support chat: answering failed'))
  }
  return touched.size
}

/** Send one message to the studio and keep it on the ticket. Inside the 24-hour window it is free text; after it, the follow-up template. */
async function sendToStudio(env: Env, t: ChatTicket, body: string, author: 'ai' | 'owner' | 'system'): Promise<{ ok: boolean; error: string | null }> {
  let error: string | null = null
  try {
    if (!whatsappConfigured(env)) throw new Error('The WhatsApp API is not set up on the server.')
    if (windowOpen(t.last_in_at)) {
      await sendWhatsAppText(env, t.phone, body)
    } else {
      const tpl = await withService(env, async (sql) => (await readSupportSettings(sql)).tpl_followup)
      const name = (t.contact_name ?? 'there').split(/\s+/)[0] || 'there'
      const clean = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 1000)
      await sendWhatsAppTemplate(env, t.phone, { name: tpl, language: 'en' }, [clean(name), clean(body)])
    }
  } catch (err) {
    error = describeError(err).message.slice(0, 300)
    log.warn({ ticket: t.id, error }, 'support chat: send failed')
  }
  await withService(env, (sql) => sql`
    insert into support_ticket_messages (ticket_id, dir, author, body, status, error)
    values (${t.id}, 'out', ${author}, ${body}, ${error ? 'failed' : 'sent'}, ${error})`)
  return { ok: !error, error }
}

/** Hand the ticket to the owner: the studio is told once, the group every time a new reason comes up. */
async function escalate(env: Env, t: ChatTicket, why: EscalateWhy, said: string, lang: ReturnType<typeof langOf>): Promise<void> {
  const first = !t.escalated_at
  await withService(env, (sql) => sql`
    update support_tickets set status = 'waiting_us', escalated_at = coalesce(escalated_at, now()),
           escalate_why = ${WHY_WORDS[why]}, kind = coalesce(kind, ${WHY_KIND[why] ?? null}), updated_at = now()
     where id = ${t.id}`)
  if (first) await sendToStudio(env, t, why === 'ai_off' ? CHAT_SAY[lang].aiOff : CHAT_SAY[lang].handed, 'system')
  await postToGroup(
    env,
    t.booking_id,
    escalationPost({ name: t.contact_name ?? `+${t.phone}`, studioName: t.studio_name, why, said, link: ticketLink(env, t.id) }),
    `chat-escalate:${t.id}:${why}:${Math.floor(Date.now() / 3_600_000)}`,
  )
}

/**
 * Deal with what the studio wrote since the last time. One run per ticket at
 * a time: Meta often posts two messages a second apart, and they are read as one.
 */
export async function answerTicket(env: Env, id: string, gatherMs = 4_000): Promise<'answered' | 'escalated' | 'fixed' | 'noted' | 'busy' | 'nothing'> {
  const claimed = await withService(env, (sql) => sql`
    update support_tickets set ai_lock_at = now()
     where id = ${id} and (ai_lock_at is null or ai_lock_at < now() - interval '3 minutes') returning id`)
  if (!claimed.length) return 'busy'
  try {
    // A second message a moment later is read with the first.
    await new Promise((r) => setTimeout(r, gatherMs))
    const { t, pending, history, settings, aiToday, lastOut } = await withService(env, async (sql) => {
      const t = await readChat(sql, id)
      const pending = await sql<{ id: string; body: string }[]>`
        update support_ticket_messages set pending = false
         where ticket_id = ${id} and pending returning id, body`
      const history = await sql<{ dir: 'in' | 'out'; author: string; body: string }[]>`
        select dir, author, body from support_ticket_messages where ticket_id = ${id} and status = 'sent' order by created_at desc limit 10`
      const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`
        select count(*)::int as n from support_ticket_messages
         where ticket_id = ${id} and author = 'ai' and created_at > now() - interval '1 day'`
      const [lastOut] = await sql<{ author: string }[]>`
        select author from support_ticket_messages where ticket_id = ${id} and dir = 'out' order by created_at desc limit 1`
      return { t, pending, history: history.reverse(), settings: await readSupportSettings(sql), aiToday: n, lastOut }
    })
    if (!t || !pending.length) return 'nothing'
    const said = pending.map((p) => p.body).join('\n')
    const lang = langOf(said)
    const link = ticketLink(env, t.id)

    // The owner already has it: the new words go to them, the assistant stays out.
    if (t.status === 'waiting_us' && t.escalated_at) {
      await postToGroup(env, t.booking_id, morePost({ name: t.contact_name ?? `+${t.phone}`, studioName: t.studio_name, said, link }), `chat-more:${t.id}:${Math.floor(Date.now() / 1_800_000)}`)
      return 'noted'
    }

    // "Thanks, ho gaya" after an answer.
    if (lastOut?.author === 'ai' && soundsFixed(said)) {
      await withService(env, (sql) => sql`
        update support_tickets set status = 'solved', solved_at = now(), closed_by = 'studio', updated_at = now() where id = ${t.id}`)
      await sendToStudio(env, t, CHAT_SAY[lang].fixed, 'system')
      return 'fixed'
    }

    let why: EscalateWhy | null = escalateWhy(said)
    if (!why && lastOut?.author === 'ai' && soundsUnfixed(said)) {
      const misses = t.ai_misses + 1
      await withService(env, (sql) => sql`update support_tickets set ai_misses = ${misses} where id = ${t.id}`)
      if (misses >= MISSES_TO_ESCALATE) why = 'misses'
    }
    if (!why && (!settings.chat_on || !env.AI_API_KEY)) why = 'ai_off'
    if (!why && aiToday >= AI_REPLIES_A_DAY) why = 'many'
    if (why) {
      await escalate(env, t, why, said, lang)
      return 'escalated'
    }

    const row = await readSettings(env).catch(() => null)
    const help = await buildHelpContext(env, said)
    const spent = await budgetUsed(env)
    if (spent) {
      const verdict = budgetVerdict(spent, { minute: row?.assistant_minute_tokens ?? DEFAULT_MINUTE_TOKENS, day: row?.assistant_day_tokens ?? DEFAULT_DAY_TOKENS }, help.varying, lang)
      if (!verdict.ok) {
        await escalate(env, t, 'no_answer', said, lang)
        return 'escalated'
      }
    }
    // The pending words are the question; what came before them is the history.
    const before = chatHistory(history.slice(0, Math.max(0, history.length - pending.length)))
    const result = await ask({
      provider: providersFor(env, row),
      help,
      prompt: `${DEFAULT_PROMPT}\n\n${WHATSAPP_RULES}`,
      callUrl: null,
      question: said,
      history: before,
      language: lang,
    })
    await logAsk(env, { companyId: t.company_id, userId: null, question: `[support:chat] ${said.slice(0, 500)}` }, result)
    if (result.status !== 'answered' || !result.answer.trim()) {
      await escalate(env, t, 'no_answer', said, lang)
      return 'escalated'
    }
    const sent = await sendToStudio(env, t, `${plainForWhatsapp(result.answer)}\n\n${CHAT_SAY[lang].askFixed}`, 'ai')
    await withService(env, (sql) => sql`
      update support_tickets set status = ${sent.ok ? 'waiting_them' : 'open'}, updated_at = now() where id = ${t.id}`)
    return 'answered'
  } finally {
    await withService(env, (sql) => sql`update support_tickets set ai_lock_at = null where id = ${id}`)
  }
}

/**
 * The five-minute tick: anything a crash or restart left unanswered, and
 * "did that fix it?" with two days of silence closes the ticket.
 */
export async function sweepSupportChats(env: Env, now = Date.now()): Promise<{ answered: number; closed: number }> {
  const { stale, quiet } = await withService(env, async (sql) => {
    const stale = await sql<{ ticket_id: string }[]>`
      select distinct ticket_id from support_ticket_messages
       where pending and created_at < now() - interval '1 minute' limit 20`
    const quiet = await sql<{ id: string; last_out: Date | null; last_in_at: Date | null }[]>`
      select t.id, t.last_in_at,
             (select max(m.created_at) from support_ticket_messages m where m.ticket_id = t.id and m.dir = 'out') as last_out
        from support_tickets t
       where t.source = 'chat' and t.status = 'waiting_them' and t.booking_id is null`
    return { stale, quiet }
  })
  let answered = 0
  for (const s of stale) {
    try {
      if ((await answerTicket(env, s.ticket_id, 0)) !== 'busy') answered++
    } catch (err) {
      log.error({ err: describeError(err), ticket: s.ticket_id }, 'support chat: sweep answer failed')
    }
  }
  let closed = 0
  for (const q of quiet) {
    if (!silenceDue(q.last_out, q.last_in_at, now)) continue
    await withService(env, (sql) => sql`
      update support_tickets set status = 'solved', solved_at = now(), closed_by = 'silence', updated_at = now()
       where id = ${q.id} and status = 'waiting_them'`)
    closed++
  }
  return { answered, closed }
}

// ── the ticket page ───────────────────────────────────────────────────────

export async function chatMessages(env: Env, id: string): Promise<SupportTicketMessage[]> {
  return withService(env, async (sql) => {
    const rows = await sql<SupportTicketMessage[]>`
      select id, dir, author, body, status, error, created_at::text as created_at
        from support_ticket_messages where ticket_id = ${id} order by created_at limit 500`
    return rows
  })
}

/** The owner's own reply, from the official number. The ticket then waits on the studio. */
export async function ownerReply(env: Env, id: string, text: string): Promise<{ ok: boolean; error: string | null; found: boolean }> {
  const t = await withService(env, (sql) => readChat(sql, id))
  if (!t) return { ok: false, error: null, found: false }
  if (!t.phone) return { ok: false, error: 'This ticket has no WhatsApp number to reply to.', found: true }
  const r = await sendToStudio(env, t, text, 'owner')
  if (r.ok) {
    await withService(env, (sql) => sql`
      update support_tickets set status = case when status = 'solved' then status else 'waiting_them' end, updated_at = now() where id = ${id}`)
  }
  return { ...r, found: true }
}

