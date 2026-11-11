import type { TransactionSql } from 'postgres'
import type { SupportTicket, SupportTicketKind, SupportTicketWatch } from '@ipc/contracts'
import { TUTORIALS } from '@ipc/help'
import type { Env } from '../context'
import { withService } from './db'
import { describeError, log } from './log'
import { readSupportSettings } from './support-call-store'
import { cleanParam } from './support-calls'
import { askAi, flowName, getTicket, postToGroup } from './support-ticket-store'
import { closedPost, followupMessages, followupText, indiaDatePlus, readFollowupReply, weeklyText } from './support-tickets'

/**
 * The support ticket assistant, step 2 (0301): tickets that close themselves,
 * the follow-up to the studio, a bug's GitHub issue and the Monday summary.
 * The rules live in ./support-tickets.ts.
 */

/** Whether the studio has done the watched thing since `from`, read from its own data. */
async function didIt(sql: TransactionSql, companyId: string, what: SupportTicketWatch, from: Date): Promise<boolean> {
  const since = (table: string) => sql.unsafe(`select exists (select 1 from ${table} where company_id = $1 and created_at >= $2) as ok`, [companyId, from])
  const rows =
    what === 'project'
      ? await since('projects')
      : what === 'invoice'
        ? await since('invoices')
        : what === 'lead'
          ? await since('crm_leads')
          : what === 'shoot'
            ? await since('shoots')
            : what === 'client'
              ? await since('clients')
              : what === 'gallery'
                ? await since('project_galleries')
                : what === 'team'
                  ? await sql.unsafe(
                      `select exists (select 1 from users u join companies c on c.id = u.company_id
                                       where u.company_id = $1 and u.created_at >= $2 and u.user_id is distinct from c.owner_user_id) as ok`,
                      [companyId, from],
                    )
                  : await sql.unsafe(
                      `select exists (select 1 from companies where id = $1 and plan_period_start >= $2)
                           or exists (select 1 from payment_orders where company_id = $1 and status = 'paid' and created_at >= $2) as ok`,
                      [companyId, from],
                    )
  return !!(rows[0] as { ok?: boolean } | undefined)?.ok
}

/**
 * Tickets that close themselves: the note said the studio was to do one thing
 * (make a project, add the team...), and its data now shows it. Each closes
 * with a line in the group. Only tickets waiting on the studio or still open;
 * one waiting on the owner is the owner's to close.
 */
export async function autoCloseTickets(env: Env): Promise<number> {
  const due = await withService(env, (sql) =>
    sql<{ id: string; booking_id: string; company_id: string; watch: SupportTicketWatch; watch_from: Date; name: string; studio: string | null }[]>`
      select t.id, t.booking_id, t.company_id, t.watch, t.watch_from, b.name, coalesce(c.display_name, c.name, b.studio_name) as studio
        from support_tickets t
        join support_call_bookings b on b.id = t.booking_id
        join companies c on c.id = t.company_id
       where t.status in ('open', 'waiting_them') and t.watch is not null and t.watch_from is not null
         and t.watch_from > now() - interval '60 days'`,
  )
  let closed = 0
  for (const t of due) {
    try {
      const done = await withService(env, (sql) => didIt(sql, t.company_id, t.watch, new Date(t.watch_from)))
      if (!done) continue
      const claimed = await withService(env, (sql) => sql`
        update support_tickets set status = 'solved', solved_at = now(), closed_by = 'assistant', next_action = null, due_on = null, updated_at = now()
         where id = ${t.id} and status in ('open', 'waiting_them') returning id`)
      if (!claimed.length) continue
      closed++
      await postToGroup(env, t.booking_id, closedPost(t.name, t.studio, t.watch), `closed:${t.id}`)
    } catch (err) {
      log.error({ err: describeError(err), ticket: t.id }, 'support ticket self-close failed')
    }
  }
  return closed
}

/** The tutorials a follow-up may point to: every one the app ships. */
const TUTORIAL_PICKS = TUTORIALS.map((t) => ({ key: t.key, title: t.title }))

/** "Asha" from "Asha Rao"; a booking that only carries an email gets "there". */
const firstName = (name: string) => (name.includes('@') ? 'there' : (name.trim().split(/\s+/)[0] ?? name))

/** The assistant drafts the follow-up to the studio; kept on the ticket until it is sent. */
export async function draftFollowup(env: Env, id: string): Promise<SupportTicket | null> {
  const t = await getTicket(env, id)
  if (!t) return null
  const first = firstName(t.name)
  const answer = await askAi(
    env,
    'followup',
    followupMessages({ name: first, summary: t.summary ?? t.transcript ?? 'We spoke about Studio AutoPilot.', nextAction: t.next_action, transcript: t.transcript }, TUTORIAL_PICKS),
    400,
  )
  const read = answer ? readFollowupReply(answer, TUTORIAL_PICKS) : null
  const message = read?.message ?? `Hi ${first}, thank you for the call today. ${t.next_action ? `Next: ${t.next_action}.` : 'Message us here if anything else comes up.'}`
  const text = followupText(message, read?.tutorials ?? [], env.APP_URL || 'https://studioautopilot.in')
  await withService(env, (sql) => sql`update support_tickets set followup = ${text}, updated_at = now() where id = ${id}`)
  return getTicket(env, id)
}

/**
 * The follow-up as the owner sent it. Through the official API it goes out
 * from our number as the `support_call_followup` template (once connected);
 * otherwise the owner sent it from their own WhatsApp (a link) or copied it,
 * and we only note that it went.
 */
export async function sendFollowup(
  env: Env,
  id: string,
  text: string,
  via: 'whatsapp_link' | 'official' | 'copied',
): Promise<{ ticket: SupportTicket | null; error: string | null }> {
  const t = await getTicket(env, id)
  if (!t) return { ticket: null, error: null }
  if (via === 'official') {
    if (!t.official_ready) return { ticket: t, error: 'The official WhatsApp number is not connected yet. Send it from your WhatsApp instead.' }
    if (!t.contact_phone) return { ticket: t, error: 'There is no WhatsApp number for this studio.' }
    await withService(env, async (sql) => {
      const s = await readSupportSettings(sql)
      const [b] = await sql<{ booking_id: string }[]>`select booking_id from support_tickets where id = ${id}`
      await sql`
        insert into support_call_outbox (booking_id, channel, audience, to_number, template, params, dedupe_key)
        values (${b!.booking_id}, 'official', 'booker', ${t.contact_phone}, ${s.tpl_followup},
                ${sql.json([cleanParam(firstName(t.name)), cleanParam(text)])}, ${`followup:${id}:${Date.now()}`})`
    })
  }
  await withService(env, (sql) => sql`
    update support_tickets set followup = ${text}, followup_sent_at = now(), followup_via = ${via}, updated_at = now() where id = ${id}`)
  return { ticket: await getTicket(env, id), error: null }
}

export async function markIssueOpened(env: Env, id: string): Promise<SupportTicket | null> {
  await withService(env, (sql) => sql`update support_tickets set issue_opened_at = coalesce(issue_opened_at, now()), updated_at = now() where id = ${id}`)
  return getTicket(env, id)
}

/** Monday from 9 am India time, once: last week's calls and what to fix. Nothing in an empty week. */
export async function queueWeeklySummary(env: Env, now = Date.now()): Promise<boolean> {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))
  const weekday = parts.find((p) => p.type === 'weekday')?.value
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  if (weekday !== 'Mon' || hour < 9) return false
  const key = `weekly:${indiaDatePlus(now, 0)}`
  return withService(env, async (sql) => {
    const s = await readSupportSettings(sql)
    if (!s.bot_on || !s.group_jid) return false
    const already = await sql`select 1 from support_call_outbox where dedupe_key = ${key}`
    if (already.length) return false
    const [n] = await sql<{ calls: number; solved: number; open: number; auto: number; bugs: number }[]>`
      select count(*) filter (where b.starts_at > now() - interval '7 days' and b.starts_at <= now() and t.status <> 'cancelled')::int as calls,
             count(*) filter (where t.solved_at > now() - interval '7 days')::int as solved,
             count(*) filter (where t.status in ('open', 'waiting_us', 'waiting_them'))::int as open,
             count(*) filter (where t.solved_at > now() - interval '7 days' and t.closed_by = 'assistant')::int as auto,
             count(*) filter (where t.kind = 'bug' and t.status in ('open', 'waiting_us', 'waiting_them'))::int as bugs
        from support_tickets t join support_call_bookings b on b.id = t.booking_id`
    const kinds = await sql<{ kind: SupportTicketKind; n: number }[]>`
      select t.kind, count(*)::int as n from support_tickets t join support_call_bookings b on b.id = t.booking_id
       where t.kind is not null and b.starts_at > now() - interval '7 days' group by t.kind order by 2 desc`
    const stuck = await sql<{ flow: string; studios: number }[]>`
      select route as flow, count(distinct company_id)::int as studios from usage_events
       where module = 'flow' and event_name in ('flow_refused', 'flow_stuck') and occurred_at > now() - interval '7 days' and route is not null
       group by route order by 2 desc limit 3`
    const repeat = await sql<{ name: string; calls: number }[]>`
      select coalesce(c.display_name, c.name, max(b.studio_name)) as name, count(*)::int as calls
        from support_call_bookings b left join companies c on c.id = b.company_id
       where b.company_id is not null and b.status <> 'cancelled' and b.starts_at > now() - interval '30 days'
       group by b.company_id, c.display_name, c.name having count(*) > 1 order by 2 desc limit 3`
    const body = weeklyText({
      calls: n?.calls ?? 0,
      solved: n?.solved ?? 0,
      open: n?.open ?? 0,
      closedByThemselves: n?.auto ?? 0,
      kinds,
      bugsOpen: n?.bugs ?? 0,
      stuck: stuck.map((x) => ({ flow: flowName(x.flow), studios: x.studios })),
      repeat,
    })
    if (!body) return false
    const rows = await sql`
      insert into support_call_outbox (channel, audience, to_number, body, dedupe_key)
      values ('group', 'group', ${s.group_jid}, ${body}, ${key})
      on conflict (dedupe_key) do nothing returning id`
    return rows.length > 0
  })
}
