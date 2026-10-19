import { createHmac } from 'node:crypto'
import type { TransactionSql } from 'postgres'
import type { Env } from '../context'
import { timingSafeEqual } from './crypto'
import { deliver } from './email'

/**
 * Support requests (0271): the one way in and out.
 *
 * - In: a studio's Report a problem (or the assistant's hand-over) -> createRequest -> notifyTeam:
 *   a bell and an email to each platform admin, and a row in the shared support Google Sheet
 *   (SUPPORT_SHEET_URL, the Apps Script in the Frameline repo's docs/support-sheet.gs, tab "Studio AutoPilot").
 * - Back: the Sheet posts each reply to POST /webhooks/support-sheet -> applySheetReply: the reply joins the
 *   request, the person who wrote it gets a bell (and the owner an email).
 * - Morning: one email to the team listing what is still open (runSupportDigest, on the hourly cron).
 *
 * The team sees screenshots through one signed link per request (supportFilesUrl), because the files are the
 * studio's own private files and the team does not belong to that studio.
 * Every outside step is best effort: a Sheet or inbox that is down never fails the studio's request.
 */
export const SHEET_TAB = 'Studio AutoPilot'
const FILES_TTL_SEC = 90 * 86_400

export type SupportKind = 'problem' | 'question' | 'billing' | 'idea'
const KIND_WORD: Record<SupportKind, string> = { problem: 'Problem', question: 'Question', billing: 'Billing', idea: 'Idea' }

/** The first sentence, as the subject the team and the studio see. */
export function subjectFrom(body: string): string {
  const first = body.trim().split(/(?<=[.!?])\s|\n/)[0] ?? ''
  const s = first.replace(/\s+/g, ' ').trim()
  return (s.length > 80 ? `${s.slice(0, 77)}…` : s) || 'Help request'
}

export interface NewRequest {
  companyId: string
  userId: string
  kind: SupportKind
  body: string
  urgent: boolean
  pageUrl?: string | undefined
  fileIds: string[]
  context?: string | undefined
}

/** Makes the request and its first message. Screenshots must be this studio's own files; others are dropped. */
export async function createRequest(sql: TransactionSql, r: NewRequest): Promise<string> {
  const files = r.fileIds.length
    ? (await sql<{ id: string }[]>`select id from files where id = any(${r.fileIds}::uuid[]) and company_id = ${r.companyId}`).map((f) => f.id)
    : []
  const [who] = await sql<{ name: string | null }[]>`select name from users where user_id = ${r.userId} and company_id = ${r.companyId} limit 1`
  const [row] = await sql<{ id: string }[]>`
    insert into support_requests (company_id, created_by, subject, kind, urgency, page_url, context)
    values (${r.companyId}, ${r.userId}, ${subjectFrom(r.body)}, ${r.kind}, ${r.urgent ? 'high' : 'normal'},
            ${r.pageUrl?.slice(0, 500) ?? null}, ${r.context?.slice(0, 8000) ?? null})
    returning id`
  await sql`
    insert into support_messages (request_id, sender, author_uid, author_name, body, file_ids)
    values (${row!.id}, 'me', ${r.userId}, ${who?.name ?? null}, ${r.body}, ${files}::uuid[])`
  return row!.id
}

/** The studio wrote again. Returns false when it is not a request this person may write on. */
export async function addStudioMessage(sql: TransactionSql, requestId: string, by: { companyId: string; userId: string; seesAll: boolean }, body: string, fileIds: string[]): Promise<boolean> {
  const [req] = await sql<{ id: string }[]>`
    select id from support_requests
     where id = ${requestId} and company_id = ${by.companyId} and (created_by = ${by.userId} or ${by.seesAll})`
  if (!req) return false
  const files = fileIds.length
    ? (await sql<{ id: string }[]>`select id from files where id = any(${fileIds}::uuid[]) and company_id = ${by.companyId}`).map((f) => f.id)
    : []
  const [who] = await sql<{ name: string | null }[]>`select name from users where user_id = ${by.userId} and company_id = ${by.companyId} limit 1`
  await sql`insert into support_messages (request_id, sender, author_uid, author_name, body, file_ids)
            values (${requestId}, 'me', ${by.userId}, ${who?.name ?? null}, ${body}, ${files}::uuid[])`
  await sql`update support_requests set status = 'waiting', resolved_at = null where id = ${requestId}`
  return true
}

// ── The team's side ─────────────────────────────────────────────────────────

interface Facts {
  id: string; subject: string; kind: SupportKind; urgency: string; created_at: string; page_url: string | null; context: string | null
  studio: string; plan: string | null; person: string | null; person_email: string | null; person_role: string | null; first: string; files: number
}

async function factsOf(sql: TransactionSql, id: string): Promise<Facts | null> {
  const [f] = await sql<Facts[]>`
    select r.id, r.subject, r.kind, r.urgency, to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at, r.page_url, r.context,
           coalesce(co.display_name, co.name) as studio, co.plan, u.name as person, u.email as person_email, u.role as person_role,
           (select m.body from support_messages m where m.request_id = r.id order by m.created_at limit 1) as first,
           (select coalesce(sum(cardinality(m.file_ids)), 0)::int from support_messages m where m.request_id = r.id) as files
      from support_requests r
      join companies co on co.id = r.company_id
      left join users u on u.user_id = r.created_by and u.company_id = r.company_id
     where r.id = ${id}`
  return f ?? null
}

const sign = (secret: string, id: string, exp: number) => createHmac('sha256', secret).update(`support-files:${id}:${exp}`).digest('base64url')

/** The team's link to a request's screenshots (a small page), or null without the Sheet secret. */
export function supportFilesUrl(env: Env, apiOrigin: string, id: string): string | null {
  if (!env.SUPPORT_SHEET_SECRET) return null
  const exp = Math.floor(Date.now() / 1000) + FILES_TTL_SEC
  return `${apiOrigin.replace(/\/$/, '')}/public/support-files/${id}.${exp}.${sign(env.SUPPORT_SHEET_SECRET, id, exp)}`
}

/** The request a files link is for, when its signature holds and it has not expired. */
export function verifySupportFilesToken(env: Env, token: string): string | null {
  const [id, expRaw, sig] = token.split('.')
  const exp = Number(expRaw)
  if (!env.SUPPORT_SHEET_SECRET || !id || !sig || !Number.isFinite(exp) || exp < Date.now() / 1000) return null
  return timingSafeEqual(sig, sign(env.SUPPORT_SHEET_SECRET, id, exp)) ? id : null
}

async function postSheet(env: Env, payload: Record<string, unknown>): Promise<boolean> {
  if (!env.SUPPORT_SHEET_URL || !env.SUPPORT_SHEET_SECRET) return false
  try {
    const res = await fetch(env.SUPPORT_SHEET_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.SUPPORT_SHEET_SECRET, app: SHEET_TAB, ...payload }),
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null
    if (!res.ok || body?.ok !== true) throw new Error(`sheet answered ${res.status}`)
    return true
  } catch (e) {
    console.error('[support] sheet failed', payload.action, e instanceof Error ? e.message : e)
    return false
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
const para = (s: string) => `<p style="margin:0 0 12px;white-space:pre-line">${esc(s)}</p>`

/** A new request: a bell and an email to each platform admin, and a Sheet row. Never throws. */
export async function notifyTeam(env: Env, sql: TransactionSql, id: string, apiOrigin: string): Promise<void> {
  try {
    const f = await factsOf(sql, id)
    if (!f) return
    const team = await sql<{ company_id: string; user_id: string; email: string | null }[]>`select * from support_team_recipients()`
    const urgent = f.urgency === 'high'
    const title = `${urgent ? 'Urgent · ' : ''}${KIND_WORD[f.kind]} from ${f.studio}`
    const filesUrl = f.files ? supportFilesUrl(env, apiOrigin, id) : null
    for (const t of team) {
      await sql`
        select create_notification(${t.company_id}, ${t.user_id}, 'support_request', ${title}, ${f.subject},
               ${`support_request:${id}`}, 'support_request', ${id}::uuid, ${urgent ? 'warning' : 'info'}, null, '{}'::jsonb)`
      if (t.email) {
        await deliver(env, {
          to: t.email,
          subject: `[Support] ${title}: ${f.subject}`,
          html: [
            para(`${f.studio}${f.plan ? ` (${f.plan})` : ''} · ${f.person ?? 'someone'}${f.person_role ? `, ${f.person_role}` : ''}${f.person_email ? ` · ${f.person_email}` : ''}`),
            para(f.first),
            f.page_url ? para(`Page: ${f.page_url}`) : '',
            f.context ? para(`What they asked the assistant:\n${f.context.slice(0, 2000)}`) : '',
            filesUrl ? para(`Screenshots: ${filesUrl}`) : '',
            para(`Reply in the support Sheet (tab "${SHEET_TAB}"). Request ${id}.`),
          ].join(''),
        }, { kind: 'support_request' }).catch(() => undefined)
      }
    }
    const ok = await postSheet(env, {
      action: 'append',
      row: {
        ticketId: id, opened: f.created_at, studio: f.studio, plan: f.plan ?? '', person: [f.person, f.person_email].filter(Boolean).join(' · '),
        type: KIND_WORD[f.kind], urgency: urgent ? 'high' : 'normal', subject: f.subject,
        summary: f.context ? `Came from the assistant. ${f.context.slice(0, 600)}` : '', steps: '',
        message: f.first.slice(0, 3000), event: '', gallery: '', platform: f.page_url ?? '', files: filesUrl ?? '',
      },
    })
    if (ok) await sql`update support_requests set sheet_sent_at = now() where id = ${id}`
  } catch (e) {
    console.error('[support] notify failed', e instanceof Error ? e.message : e)
  }
}

/** The studio wrote again: a note on the Sheet row and an email to the team. Never throws. */
export async function notifyTeamOfReply(env: Env, sql: TransactionSql, id: string, body: string): Promise<void> {
  try {
    const f = await factsOf(sql, id)
    if (!f) return
    await postSheet(env, { action: 'note', ticketId: id, note: body.slice(0, 3000), at: new Date().toISOString() })
    const team = await sql<{ email: string | null }[]>`select email from support_team_recipients()`
    for (const t of team) {
      if (t.email) {
        await deliver(env, { to: t.email, subject: `[Support] ${f.studio} wrote again: ${f.subject}`, html: para(body.slice(0, 3000)) }, { kind: 'support_request' }).catch(() => undefined)
      }
    }
  } catch (e) {
    console.error('[support] reply notify failed', e instanceof Error ? e.message : e)
  }
}

export type SheetStatus = 'replied' | 'fixed' | 'resolved'

/** A reply from the Sheet: joins the request, rings the writer's bell, emails them if they are the owner. */
export async function applySheetReply(env: Env, sql: TransactionSql, input: { ticketId: string; reply: string; status: SheetStatus; by?: string | undefined }): Promise<boolean> {
  const [req] = await sql<{ id: string; company_id: string; created_by: string | null; subject: string }[]>`
    select id, company_id, created_by, subject from support_requests where id = ${input.ticketId}`
  if (!req) return false
  const reply = input.reply.trim()
  const done = input.status !== 'replied'
  if (reply) {
    await sql`insert into support_messages (request_id, sender, author_name, body)
              values (${req.id}, 'support', ${(input.by ?? '').slice(0, 120) || 'Studio AutoPilot team'}, ${reply.slice(0, 5000)})`
  }
  await sql`
    update support_requests
       set status = ${input.status === 'resolved' ? 'closed' : 'answered'},
           resolved_at = case when ${done} then now() else resolved_at end
     where id = ${req.id}`
  if (req.created_by && (reply || done)) {
    const title = input.status === 'fixed' ? 'Fixed: ' + req.subject : input.status === 'resolved' ? 'Resolved: ' + req.subject : 'The team replied: ' + req.subject
    await sql`
      select create_notification(${req.company_id}, ${req.created_by}, 'support_reply', ${title.slice(0, 200)}, ${reply.slice(0, 300) || null},
             ${`support_reply:${req.id}:${Date.now()}`}, 'support_request', ${req.id}::uuid, 'info', ${`/support-requests?r=${req.id}`}, '{}'::jsonb)`
    const [u] = await sql<{ email: string | null; name: string | null }[]>`
      select email, name from users where user_id = ${req.created_by} and company_id = ${req.company_id} limit 1`
    if (u?.email) {
      const lead = input.status === 'fixed' ? 'Good news: this is fixed.' : input.status === 'resolved' ? 'We have marked this as resolved.' : 'Our team replied to your request.'
      // Held for anyone but a studio owner (lib/email.ts); everyone gets the bell.
      await deliver(env, {
        to: u.email,
        subject: `Re: ${req.subject}`,
        html: para(`Hi ${(u.name ?? '').split(' ')[0] || 'there'},`) + para(lead) + (reply ? para(reply) : '') +
          para(`See the whole conversation or reply: ${env.APP_URL.replace(/\/$/, '')}/support-requests?r=${req.id}`),
      }, { kind: 'support_reply', companyId: req.company_id }).catch(() => undefined)
    }
  }
  return true
}

/** Hourly: from 9 am India time, once a day, the team gets the list of requests still waiting. */
export async function runSupportDigest(env: Env, sql: TransactionSql, now = new Date()): Promise<{ sent: number; open: number }> {
  const india = new Date(now.getTime() + 330 * 60_000)
  if (india.getUTCHours() < 9) return { sent: 0, open: 0 }
  const day = india.toISOString().slice(0, 10)
  const claimed = await sql`update platform_settings set support_digest_on = ${day}::date where support_digest_on is distinct from ${day}::date returning 1`
  if (!claimed.length) return { sent: 0, open: 0 }
  const open = await sql<{ id: string; subject: string; urgency: string; status: string; studio: string; age: number }[]>`
    select r.id, r.subject, r.urgency, r.status, coalesce(co.display_name, co.name) as studio,
           floor(extract(epoch from (now() - r.created_at)) / 86400)::int as age
      from support_requests r join companies co on co.id = r.company_id
     where r.status in ('open', 'waiting')
     order by (r.urgency = 'high') desc, r.created_at
     limit 100`
  if (!open.length) return { sent: 0, open: 0 }
  const lines = open.map((r) => `${r.urgency === 'high' ? 'URGENT · ' : ''}${r.studio}: ${r.subject} · ${r.age ? `${r.age} day${r.age === 1 ? '' : 's'} waiting` : 'today'}${r.status === 'waiting' ? ' · they wrote again' : ''}`)
  const old = open.filter((r) => r.age >= 1).length
  const team = await sql<{ email: string | null }[]>`select email from support_team_recipients()`
  let sent = 0
  for (const t of team) {
    if (!t.email) continue
    const r = await deliver(env, {
      to: t.email,
      subject: `[Support] ${open.length} waiting${old ? `, ${old} over a day` : ''}`,
      html: para(`Still waiting for an answer:\n\n${lines.join('\n')}`) + para(`Answer in the support Sheet (tab "${SHEET_TAB}").`),
    }, { kind: 'support_request' }).catch(() => null)
    if (r && r.status === 'sent') sent++
  }
  return { sent, open: open.length }
}
