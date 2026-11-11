import type { TransactionSql } from 'postgres'
import {
  ASSISTANT_DEFAULT_BASE_URL,
  normalizePhoneForWhatsApp,
  supportTicket,
  type SupportTicket,
  type UpdateSupportTicketRequest,
} from '@ipc/contracts'
import type { Env } from '../context'
import type { ChatMessage } from './ai'
import { budgetUsed, budgetVerdict, DEFAULT_DAY_TOKENS, DEFAULT_MINUTE_TOKENS } from './ai-budget'
import { logAsk } from './assistant'
import { withService } from './db'
import { describeError, log } from './log'
import { whatsappConfigured } from './whatsapp'
import { readSupportSettings } from './support-call-store'
import { istWhen } from './support-calls'
import {
  briefDue,
  briefMessages,
  briefPost,
  factsText,
  indiaDatePlus,
  issueUrl,
  noteMessages,
  nudgeDue,
  nudgePost,
  readNoteReply,
  speechModelFor,
  ticketsLine,
  type StudioFacts,
} from './support-tickets'
import { providersFor, readSettings } from '../modules/assistant/router'

/**
 * The support ticket assistant (0300): the database, the AI and the group
 * posts. The rules live in ./support-tickets.ts. It rides the five-minute
 * messages tick (briefs, nudges) and the 9 am post; the voice note comes in
 * through Platform -> Support calls (modules/support-calls).
 */

// ── tickets follow their bookings ─────────────────────────────────────────

/**
 * Called whenever a booking is saved: a new booking opens its ticket, a
 * cancelled one closes it, and a moved one is briefed and asked about again
 * at its new time. A ticket the owner already worked on keeps its status.
 */
export async function followBooking(sql: TransactionSql, bookingId: string, companyId: string | null, status: 'booked' | 'rescheduled' | 'cancelled') {
  await sql`
    insert into support_tickets (booking_id, company_id, status)
    values (${bookingId}, ${companyId}, ${status === 'cancelled' ? 'cancelled' : 'booked'})
    on conflict (booking_id) do update set
      company_id = coalesce(excluded.company_id, support_tickets.company_id),
      status = case
                 when ${status} = 'cancelled' and support_tickets.status = 'booked' then 'cancelled'
                 when ${status} <> 'cancelled' and support_tickets.status = 'cancelled' then 'booked'
                 else support_tickets.status end,
      brief_at = case when ${status} = 'rescheduled' and support_tickets.status = 'booked' then null else support_tickets.brief_at end,
      nudged_at = case when ${status} = 'rescheduled' and support_tickets.status = 'booked' then null else support_tickets.nudged_at end,
      updated_at = now()`
}

// ── the AI, for the platform (no studio's allowance) ──────────────────────

/**
 * One AI answer for the support assistant. It spends the platform's token
 * budget (so the help assistant is never starved by it) but never a studio's
 * daily allowance: these are the owner's own tickets. Null when the AI is not
 * set up, out of budget or down -- every caller has a plain fallback.
 */
export async function askAi(env: Env, kind: string, messages: ChatMessage[], maxTokens: number): Promise<string | null> {
  if (!env.AI_API_KEY) return null
  const row = await readSettings(env).catch(() => null)
  const spent = await budgetUsed(env)
  if (spent) {
    const verdict = budgetVerdict(
      spent,
      { minute: row?.assistant_minute_tokens ?? DEFAULT_MINUTE_TOKENS, day: row?.assistant_day_tokens ?? DEFAULT_DAY_TOKENS },
      maxTokens + 800,
      'en',
    )
    if (!verdict.ok) return null
  }
  const reply = await providersFor(env, row).chat({ messages, maxTokens, temperature: 0.2 })
  await logAsk(
    env,
    { companyId: null, userId: null, question: `[support:${kind}]` },
    reply.ok
      ? { status: 'answered', answer: reply.text, sources: [], callUrl: null, model: reply.model, promptTokens: reply.usage.promptTokens, completionTokens: reply.usage.completionTokens, cachedTokens: reply.usage.cachedTokens, error: null }
      : { status: 'failed', answer: '', sources: [], callUrl: null, model: null, promptTokens: null, completionTokens: null, cachedTokens: null, error: reply.error },
  )
  return reply.ok && reply.text ? reply.text : null
}

/**
 * Speech to text with the same provider and key as the assistant (Groq's
 * Whisper by default). Hindi, Hinglish and English are all heard; the prompt
 * only teaches it the app's own words.
 */
export async function transcribe(env: Env, audio: Blob, filename: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!env.AI_API_KEY) return { ok: false, error: 'AI is not set up on the server (no API key), so voice notes cannot be read. Type the note instead.' }
  const row = await readSettings(env).catch(() => null)
  const base = (row?.assistant_base_url || env.AI_BASE_URL || ASSISTANT_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', speechModelFor(base))
  form.append('response_format', 'json')
  form.append('temperature', '0')
  form.append('prompt', 'Studio AutoPilot support call. Quotation, invoice, project, shoot, leads, Frameline gallery, Diamond plan, Starter, Pro, Studio Max, team login.')
  try {
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    })
    const raw = await res.text()
    if (!res.ok) {
      log.warn({ status: res.status, body: raw.slice(0, 300) }, 'support voice note: transcription refused')
      return { ok: false, error: `The voice note could not be read (${res.status}). Try again, or type the note.` }
    }
    const text = String((JSON.parse(raw) as { text?: unknown }).text ?? '').trim()
    return text ? { ok: true, text } : { ok: false, error: 'Nothing could be heard in that voice note. Try again a little closer to the phone.' }
  } catch (err) {
    return { ok: false, error: `The voice note could not be read: ${describeError(err).message.slice(0, 120)}` }
  }
}

// ── what we know about a studio ───────────────────────────────────────────

/** Names of the screens a studio learns (useLearn keys), said plainly. */
const FLOW_NAME: Record<string, string> = {
  team: 'Add one person',
  'team-bulk': 'Add your team (list)',
  client: 'New client',
  'project-client': 'Create project: who it is for',
  'project-shoots': 'Create project: event days',
  'project-deliverables': 'Create project: deliverables',
  'project-billing': 'Create project: price',
}
export const flowName = (f: string) => FLOW_NAME[f] ?? f.replace(/[-_]/g, ' ')

const daysAgo = (d: Date | null, now: number) => (d ? Math.max(0, Math.floor((now - new Date(d).getTime()) / 86_400_000)) : null)

export async function studioFacts(sql: TransactionSql, companyId: string | null, exceptTicket: string | null, now = Date.now()): Promise<StudioFacts | null> {
  if (!companyId) return null
  const [c] = await sql<
    { studio: string; plan: string | null; plan_expiry: Date | null; trial: Date | null; access_until: Date | null; created_at: Date }[]
  >`
    select coalesce(c.display_name, c.name) as studio, p.name as plan, c.plan_expiry, c.grandfathered_until as trial,
           company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until) as access_until, c.created_at
      from companies c left join plans p on p.key = c.plan
     where c.id = ${companyId}`
  if (!c) return null
  const [n] = await sql<{ projects: number; invoices: number; leads: number; shoots: number; team: number; d7: number; last: Date | null }[]>`
    select (select count(*) from projects where company_id = ${companyId})::int as projects,
           (select count(*) from invoices where company_id = ${companyId})::int as invoices,
           (select count(*) from crm_leads where company_id = ${companyId} and not coalesce(is_archived, false))::int as leads,
           (select count(*) from shoots where company_id = ${companyId})::int as shoots,
           (select count(*) from users where company_id = ${companyId} and deleted_at is null)::int as team,
           (select count(distinct (occurred_at at time zone 'Asia/Kolkata')::date) from usage_events
             where company_id = ${companyId} and occurred_at > now() - interval '7 days')::int as d7,
           (select max(occurred_at) from usage_events where company_id = ${companyId} and occurred_at > now() - interval '30 days') as last`
  const stuck = await sql<{ flow: string; times: number }[]>`
    select route as flow, count(*)::int as times from usage_events
     where company_id = ${companyId} and module = 'flow' and event_name in ('flow_refused', 'flow_stuck')
       and occurred_at > now() - interval '30 days' and route is not null
     group by route order by 2 desc limit 3`
  const earlier = await sql<{ starts_at: Date; summary: string }[]>`
    select b.starts_at, t.summary from support_tickets t join support_call_bookings b on b.id = t.booking_id
     where t.company_id = ${companyId} and t.summary is not null and t.id is distinct from ${exceptTicket}::uuid
     order by b.starts_at desc limit 3`

  const until = c.access_until ? new Date(c.access_until).getTime() : null
  const lifetime = until !== null && until > now + 50 * 365 * 86_400_000
  const paid = !!c.plan_expiry && new Date(c.plan_expiry).getTime() > now
  const access: StudioFacts['access'] = until === null ? null : until < now ? 'expired' : lifetime ? 'lifetime' : paid ? 'paid' : 'trial'
  return {
    studio: c.studio,
    plan: c.plan,
    access,
    daysLeft: until !== null && !lifetime && until > now ? Math.ceil((until - now) / 86_400_000) : null,
    joinedDaysAgo: daysAgo(c.created_at, now),
    projects: n?.projects ?? 0,
    invoices: n?.invoices ?? 0,
    leads: n?.leads ?? 0,
    shoots: n?.shoots ?? 0,
    team: n?.team ?? 0,
    activeDays7: n?.d7 ?? 0,
    lastActiveDaysAgo: daysAgo(n?.last ?? null, now),
    stuck: stuck.map((s) => ({ flow: flowName(s.flow), times: s.times })),
    earlier: earlier.map((e) => ({ when: istWhen(new Date(e.starts_at).toISOString()), summary: e.summary.replace(/\s+/g, ' ').slice(0, 200) })),
  }
}

// ── the tick: briefs before calls, nudges after them ──────────────────────

export const ticketLink = (env: Env, id: string) => `${(env.APP_URL ?? '').replace(/\/+$/, '')}/platform/support-calls/tickets/${id}`

interface DueRow {
  ticket_id: string
  booking_id: string
  company_id: string | null
  starts_at: Date
  ends_at: Date | null
  name: string
  email: string | null
  notes: string | null
  page: string | null
  studio_name: string | null
}

export async function postToGroup(env: Env, bookingId: string, body: string, dedupeKey: string): Promise<boolean> {
  return withService(env, async (sql) => {
    const s = await readSupportSettings(sql)
    if (!s.bot_on || !s.group_jid) return false
    const rows = await sql`
      insert into support_call_outbox (booking_id, channel, audience, to_number, body, dedupe_key)
      values (${bookingId}, 'group', 'group', ${s.group_jid}, ${body}, ${dedupeKey})
      on conflict (dedupe_key) do nothing returning id`
    return rows.length > 0
  })
}

/** Write one ticket's brief, keep it on the ticket and post it in the group. */
export async function briefTicket(env: Env, r: DueRow, now = Date.now()): Promise<string> {
  const facts = await withService(env, (sql) => studioFacts(sql, r.company_id, r.ticket_id, now))
  const plain = factsText(facts, { name: r.name, email: r.email, notes: r.notes, page: r.page })
  const brief = (await askAi(env, 'brief', briefMessages(plain, r.name), 220)) ?? plain
  await withService(env, (sql) => sql`update support_tickets set brief = ${brief}, brief_at = now(), updated_at = now() where id = ${r.ticket_id}`)
  const startsAt = new Date(r.starts_at).toISOString()
  await postToGroup(
    env,
    r.booking_id,
    briefPost({ name: r.name, studioName: facts?.studio ?? r.studio_name, startsAt, endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null }, brief, ticketLink(env, r.ticket_id)),
    `brief:${r.ticket_id}:${startsAt}`,
  )
  return brief
}

/** Every five minutes: brief the calls about to start, ask about the ones just ended. */
export async function runTicketAssistant(env: Env, now = Date.now()): Promise<{ briefed: number; nudged: number }> {
  const { due, ended } = await withService(env, async (sql) => {
    // A booking saved before tickets existed, or by a path that missed it.
    await sql`
      insert into support_tickets (booking_id, company_id, status)
      select b.id, b.company_id, case when b.status = 'cancelled' then 'cancelled' else 'booked' end
        from support_call_bookings b
       where not exists (select 1 from support_tickets t where t.booking_id = b.id)
      on conflict (booking_id) do nothing`
    const rows = await sql<(DueRow & { brief_at: Date | null; nudged_at: Date | null })[]>`
      select t.id as ticket_id, b.id as booking_id, coalesce(t.company_id, b.company_id) as company_id, b.starts_at, b.ends_at,
             b.name, b.email, b.notes, b.page, b.studio_name, t.brief_at, t.nudged_at
        from support_tickets t join support_call_bookings b on b.id = t.booking_id
       where t.status = 'booked' and b.status <> 'cancelled'
         and b.starts_at between now() - interval '1 day' and now() + interval '2 hours'
         and (t.brief_at is null or t.nudged_at is null)`
    return {
      due: rows.filter((r) => !r.brief_at && briefDue(new Date(r.starts_at).toISOString(), now)),
      ended: rows.filter((r) => !r.nudged_at && nudgeDue(new Date(r.starts_at).toISOString(), r.ends_at ? new Date(r.ends_at).toISOString() : null, now)),
    }
  })
  let briefed = 0
  let nudged = 0
  for (const r of due) {
    try {
      await briefTicket(env, r, now)
      briefed++
    } catch (err) {
      log.error({ err: describeError(err), ticket: r.ticket_id }, 'support ticket brief failed')
    }
  }
  for (const r of ended) {
    const claimed = await withService(env, (sql) => sql`
      update support_tickets set nudged_at = now(), updated_at = now() where id = ${r.ticket_id} and nudged_at is null returning id`)
    if (!claimed.length) continue
    await postToGroup(env, r.booking_id, nudgePost({ name: r.name, studioName: r.studio_name }, ticketLink(env, r.ticket_id)), `nudge:${r.ticket_id}`)
    nudged++
  }
  return { briefed, nudged }
}

/** The 9 am post's ticket line, or null when nothing is open. */
export async function ticketsSummary(sql: TransactionSql, now = Date.now()): Promise<string | null> {
  const today = indiaDatePlus(now, 0)
  const rows = await sql<{ name: string; studio_name: string | null; status: string; next_action: string | null; due_on: string | null }[]>`
    select b.name, b.studio_name, t.status, t.next_action, t.due_on::text as due_on
      from support_tickets t join support_call_bookings b on b.id = t.booking_id
     where t.status in ('open', 'waiting_us', 'waiting_them')
     order by t.due_on nulls last, b.starts_at`
  const mine = rows
    .filter((r) => r.status === 'waiting_us' || r.status === 'open')
    .map((r) => ({ name: r.studio_name ? `${r.name} (${r.studio_name})` : r.name, action: r.next_action, late: !!r.due_on && r.due_on < today }))
  return ticketsLine(rows.length, mine)
}

// ── reading and changing tickets (Platform -> Support calls) ──────────────

const TICKET_COLUMNS = `
  t.id, t.status, t.kind, b.starts_at::text as starts_at, b.ends_at::text as ends_at, b.name, b.email,
  coalesce(c.display_name, c.name, b.studio_name) as studio_name, coalesce(t.company_id, b.company_id) as company_id,
  b.meeting_url, b.notes as booking_notes, t.brief, t.transcript, t.summary, t.next_action, t.due_on::text as due_on,
  t.solved_at::text as solved_at, t.updated_at::text as updated_at,
  t.watch, t.closed_by, t.followup, t.followup_sent_at::text as followup_sent_at, t.followup_via,
  t.issue_opened_at::text as issue_opened_at, p.name as plan_name,
  coalesce(b.phone,
           (select u.phone from users u where u.user_id = c.owner_user_id and u.company_id = c.id and u.phone is not null limit 1),
           c.invoice_phone) as raw_phone`

const TICKET_FROM = `
  from support_tickets t
  join support_call_bookings b on b.id = t.booking_id
  left join companies c on c.id = coalesce(t.company_id, b.company_id)
  left join plans p on p.key = c.plan`

/** The repository a bug's issue is opened in. */
const ISSUE_REPO = 'dev-gwv/platform'

/** A row as the screen gets it: a usable number, whether official sending works, a bug's issue link. */
function shape(env: Env, officialReady: boolean) {
  return (r: Record<string, unknown>): SupportTicket => {
    const phone = normalizePhoneForWhatsApp((r.raw_phone as string | null) ?? '')
    const base = { ...r, contact_phone: /^\d{10,15}$/.test(phone) ? phone : null, official_ready: officialReady, issue_url: null }
    const t = supportTicket.parse(base)
    return t.kind === 'bug'
      ? {
          ...t,
          issue_url: issueUrl(ISSUE_REPO, {
            studio: t.studio_name,
            plan: (r.plan_name as string | null) ?? null,
            when: istWhen(t.starts_at, t.ends_at),
            summary: t.summary,
            nextAction: t.next_action,
            bookingNotes: t.booking_notes,
            link: ticketLink(env, t.id),
          }),
        }
      : t
  }
}

async function officialReady(env: Env, sql: TransactionSql): Promise<boolean> {
  if (!whatsappConfigured(env)) return false
  return (await readSupportSettings(sql)).official_on
}

export async function listTickets(env: Env): Promise<SupportTicket[]> {
  return withService(env, async (sql) => {
    const rows = await sql.unsafe(`
      select ${TICKET_COLUMNS} ${TICKET_FROM}
       where t.status in ('booked', 'open', 'waiting_us', 'waiting_them')
          or coalesce(t.solved_at, t.updated_at) > now() - interval '30 days'
       order by case t.status when 'waiting_us' then 0 when 'open' then 1 when 'booked' then 2 when 'waiting_them' then 3 else 4 end,
                case when t.status = 'booked' then b.starts_at end asc,
                b.starts_at desc
       limit 200`)
    return rows.map(shape(env, await officialReady(env, sql)))
  })
}

export async function getTicket(env: Env, id: string): Promise<SupportTicket | null> {
  return withService(env, async (sql) => {
    const rows = await sql.unsafe(`select ${TICKET_COLUMNS} ${TICKET_FROM} where t.id = $1`, [id])
    return rows[0] ? shape(env, await officialReady(env, sql))(rows[0]) : null
  })
}

/**
 * The owner's words after the call, spoken or typed: kept as they were said,
 * then read into a summary, a kind, a status and the next step. A second note
 * adds to the first, and the reading is done again from both.
 */
export async function applyNote(env: Env, id: string, words: string, now = Date.now()): Promise<SupportTicket | null> {
  const t = await getTicket(env, id)
  if (!t) return null
  const transcript = [t.transcript, words.trim()].filter(Boolean).join('\n\n— later —\n')
  const context = [
    `${t.name}${t.studio_name ? ` · ${t.studio_name}` : ''}, ${istWhen(t.starts_at, t.ends_at)}`,
    t.booking_notes ? `They wrote when booking: ${t.booking_notes}` : null,
    t.brief ? `Brief before the call: ${t.brief}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  const answer = await askAi(env, 'note', noteMessages(transcript, context), 500)
  const r = readNoteReply(answer ?? '', transcript)
  await withService(env, (sql) => sql`
    update support_tickets set
      transcript = ${transcript}, summary = ${r.summary}, kind = ${r.kind}, status = ${r.status},
      next_action = ${r.nextAction}, due_on = ${r.dueInDays === null ? null : indiaDatePlus(now, r.dueInDays)},
      solved_at = case when ${r.status} = 'solved' then coalesce(solved_at, now()) else null end,
      -- What they are to do is watched from the start of the call: done on the call counts.
      watch = ${r.watch}, watch_from = case when ${r.watch}::text is null then null
                                            else (select b.starts_at from support_call_bookings b where b.id = support_tickets.booking_id) end,
      closed_by = null, nudged_at = coalesce(nudged_at, now()), updated_at = now()
    where id = ${id}`)
  return getTicket(env, id)
}

export async function updateTicket(env: Env, id: string, d: UpdateSupportTicketRequest): Promise<SupportTicket | null> {
  const has = (k: keyof UpdateSupportTicketRequest) => Object.prototype.hasOwnProperty.call(d, k)
  const done = await withService(env, async (sql) => {
    const rows = await sql`
      update support_tickets set
        status = coalesce(${d.status ?? null}, status),
        kind = case when ${has('kind')} then ${d.kind ?? null} else kind end,
        summary = case when ${has('summary')} then ${d.summary ?? null} else summary end,
        next_action = case when ${has('next_action')} then ${d.next_action ?? null} else next_action end,
        due_on = case when ${has('due_on')} then ${d.due_on ?? null}::date else due_on end,
        solved_at = case when ${d.status ?? null} = 'solved' then coalesce(solved_at, now())
                         when ${d.status ?? null} is not null then null else solved_at end,
        updated_at = now()
      where id = ${id} returning id`
    return rows.length > 0
  })
  return done ? getTicket(env, id) : null
}
