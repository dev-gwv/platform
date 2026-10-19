import { Hono, type Context } from 'hono'
import { createSupportRequest, replySupportRequest, supportRequestList, supportSheetReply, z, type SupportRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { timingSafeEqual } from '../../lib/crypto'
import {
  addStudioMessage,
  applySheetReply,
  createRequest,
  notifyTeam,
  notifyTeamOfReply,
  verifySupportFilesToken,
} from '../../lib/support-desk'

/**
 * Support requests (0271, lib/support-desk.ts).
 * - /support/*: the studio's side. Anyone signed in may ask; each person sees their own requests, and the
 *   owner and admins also see the studio's others.
 * - /webhooks/support-sheet: replies from the team's Google Sheet (shared SUPPORT_SHEET_SECRET).
 * - /public/support-files/:token: the team's signed view of a request's screenshots.
 * Reads and writes run as the service role after these checks (the tables have no policy for the app).
 */

/** Owners and admins see every request of the studio; everyone else, their own. */
const seesAll = (c: Context<AppEnv>) => {
  const a = c.get('auth')
  return a.isOwner || a.role === 'super_admin' || a.role === 'admin'
}
const origin = (c: Context<AppEnv>) => new URL(c.req.url).origin

interface Row {
  id: string; subject: string; kind: SupportRequest['kind']; urgency: 'normal' | 'high'; status: SupportRequest['status']
  created_by: string | null; created_by_name: string | null; created_at: string; updated_at: string
}
interface MsgRow { id: string; request_id: string; sender: 'me' | 'support'; author_name: string | null; body: string; file_ids: string[]; created_at: string }

async function listFor(c: Context<AppEnv>, only?: string) {
  const a = c.get('auth')
  const all = seesAll(c)
  return attempt(c, 'support.list', () =>
    withService(c.env, async (sql) => {
      const rows = await sql<Row[]>`
        select r.id, r.subject, r.kind, r.urgency, r.status, r.created_by, u.name as created_by_name,
               to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
               to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
          from support_requests r
          left join users u on u.user_id = r.created_by and u.company_id = r.company_id
         where r.company_id = ${a.companyId} and (r.created_by = ${a.userId} or ${all})
           and (${only ?? null}::uuid is null or r.id = ${only ?? null}::uuid)
         order by r.updated_at desc
         limit 100`
      const ids = rows.map((r) => r.id)
      const msgs = ids.length
        ? await sql<MsgRow[]>`
            select id, request_id, sender, author_name, body, file_ids, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
              from support_messages where request_id = any(${ids}::uuid[]) order by created_at`
        : []
      const fileIds = [...new Set(msgs.flatMap((m) => m.file_ids))]
      const names = fileIds.length ? await sql<{ id: string; name: string }[]>`select id, name from files where id = any(${fileIds}::uuid[]) and company_id = ${a.companyId}` : []
      const nameOf = new Map(names.map((f) => [f.id, f.name]))
      const items: SupportRequest[] = rows.map((r) => ({
        id: r.id, subject: r.subject, kind: r.kind, urgency: r.urgency, status: r.status,
        created_by_name: r.created_by_name, mine: r.created_by === a.userId, created_at: r.created_at, updated_at: r.updated_at,
        messages: msgs.filter((m) => m.request_id === r.id).map((m) => ({
          id: m.id, sender: m.sender, author_name: m.author_name, body: m.body, created_at: m.created_at,
          files: m.file_ids.filter((f) => nameOf.has(f)).map((f) => ({ id: f, name: nameOf.get(f)!, url: `${origin(c)}/files/${f}` })),
        })),
      }))
      return { items, open: rows.filter((r) => r.status === 'open' || r.status === 'waiting').length }
    }),
  )
}

export const supportRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/requests', async (c) => {
    const out = await listFor(c)
    if (!out) fail(400, 'We could not load your requests.')
    return c.json(supportRequestList.parse(out))
  })

  /** Report a problem / ask the team. The team hears at once (bell, email, Sheet). */
  .post('/requests', async (c) => {
    const parsed = createSupportRequest.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Tell us what happened.')
    const a = c.get('auth')
    const input = parsed.data
    const id = await attempt(c, 'support.create', () =>
      withService(c.env, (sql) =>
        createRequest(sql, {
          companyId: a.companyId, userId: a.userId, kind: input.kind, body: input.body, urgent: input.urgent,
          pageUrl: input.page_url, fileIds: input.file_ids, context: input.context,
        }),
      ),
    )
    if (!id) fail(400, 'We could not send your request. Please try again, or use WhatsApp.')
    // After the request is saved: a Sheet or inbox that is slow never holds the studio up for long.
    await withService(c.env, (sql) => notifyTeam(c.env, sql, id, origin(c))).catch(() => undefined)
    const out = await listFor(c, id)
    return c.json(supportRequestList.parse(out ?? { items: [], open: 0 }), 201)
  })

  .post('/requests/:id/messages', async (c) => {
    const id = c.req.param('id')
    if (!z.string().uuid().safeParse(id).success) fail(404, 'Request not found.')
    const parsed = replySupportRequest.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) fail(422, 'Write your reply first.')
    const a = c.get('auth')
    const ok = await attempt(c, 'support.reply', () =>
      withService(c.env, (sql) => addStudioMessage(sql, id, { companyId: a.companyId, userId: a.userId, seesAll: seesAll(c) }, parsed.data.body, parsed.data.file_ids)),
    )
    if (ok === null) fail(400, 'We could not send your reply.')
    if (!ok) fail(404, 'Request not found.')
    await withService(c.env, (sql) => notifyTeamOfReply(c.env, sql, id, parsed.data.body)).catch(() => undefined)
    const out = await listFor(c, id)
    return c.json(supportRequestList.parse(out ?? { items: [], open: 0 }))
  })

  /** "That solved it": closes the request. */
  .post('/requests/:id/resolve', async (c) => {
    const id = c.req.param('id')
    if (!z.string().uuid().safeParse(id).success) fail(404, 'Request not found.')
    const a = c.get('auth')
    const all = seesAll(c)
    const done = await attempt(c, 'support.resolve', () =>
      withService(c.env, (sql) => sql`
        update support_requests set status = 'closed', resolved_at = now()
         where id = ${id} and company_id = ${a.companyId} and (created_by = ${a.userId} or ${all})
        returning id`),
    )
    if (!done?.length) fail(404, 'Request not found.')
    const out = await listFor(c, id)
    return c.json(supportRequestList.parse(out ?? { items: [], open: 0 }))
  })

/** POST /webhooks/support-sheet: a reply from the team's Sheet (its Apps Script, every 5 minutes). */
export const supportSheetWebhook = new Hono<AppEnv>().post('/support-sheet', async (c) => {
  const parsed = supportSheetReply.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ ok: false, error: 'bad request' }, 422)
  const secret = c.env.SUPPORT_SHEET_SECRET
  if (!secret || secret.length < 24) return c.json({ ok: false, error: 'not configured' }, 501)
  if (!timingSafeEqual(parsed.data.secret, secret)) return c.json({ ok: false, error: 'not the support Sheet' }, 401)
  const ok = await attempt(c, 'support.sheet_reply', () => withService(c.env, (sql) => applySheetReply(c.env, sql, parsed.data)))
  if (ok === null) return c.json({ ok: false, error: 'try again' }, 503)
  if (!ok) return c.json({ ok: false, error: 'unknown request' }, 404)
  return c.json({ ok: true })
})

/** The team's view of a request's screenshots, from the signed link in the Sheet row and the email. */
const escHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
export const supportFilesPublic = new Hono<AppEnv>()
  .get('/support-files/:token', async (c) => {
    const id = verifySupportFilesToken(c.env, c.req.param('token'))
    if (!id) return c.text('This link is not valid or has expired.', 404)
    const files = await attempt(c, 'support.files', () =>
      withService(c.env, (sql) => sql<{ id: string; name: string; mime: string; size_bytes: number; subject: string }[]>`
        select f.id, f.name, f.mime, f.size_bytes, r.subject
          from support_requests r
          join support_messages m on m.request_id = r.id
          join files f on f.id = any(m.file_ids) and f.company_id = r.company_id
         where r.id = ${id}
         order by m.created_at`),
    )
    if (!files) return c.text('Could not load the files.', 503)
    const base = c.req.path.replace(/\/$/, '')
    const items = files.map((f) => {
      const href = `${base}/${f.id}`
      return `<li><a href="${escHtml(href)}" target="_blank" rel="noreferrer">${escHtml(f.name)}</a> · ${(f.size_bytes / 1048576).toFixed(1)} MB${
        f.mime.startsWith('image/') ? `<br><img src="${escHtml(href)}" alt="" style="max-width:100%;max-height:420px;margin-top:6px;border:1px solid #ddd">` : ''}</li>`
    })
    c.header('Cache-Control', 'private, no-store')
    c.header('Referrer-Policy', 'no-referrer')
    return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Request ${escHtml(id)}</title>
<body style="font-family:system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px"><h2>${escHtml(files[0]?.subject ?? 'Support request')}</h2><p>Request ${escHtml(id)}</p>
${items.length ? `<ul style="list-style:none;padding:0;display:grid;gap:18px">${items.join('')}</ul>` : '<p>No screenshots attached.</p>'}</body>`)
  })
  .get('/support-files/:token/:fileId', async (c) => {
    const id = verifySupportFilesToken(c.env, c.req.param('token'))
    const fileId = c.req.param('fileId')
    if (!id || !z.string().uuid().safeParse(fileId).success) return c.text('Not found.', 404)
    const rows = await attempt(c, 'support.file', () =>
      withService(c.env, (sql) => sql<{ mime: string; bytes: Buffer }[]>`
        select f.mime, f.bytes
          from support_requests r
          join support_messages m on m.request_id = r.id
          join files f on f.id = ${fileId}::uuid and f.id = any(m.file_ids) and f.company_id = r.company_id
         where r.id = ${id}
         limit 1`),
    )
    const f = rows?.[0]
    if (!f) return c.text('Not found.', 404)
    return new Response(new Uint8Array(f.bytes), { headers: { 'Content-Type': f.mime, 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' } })
  })
