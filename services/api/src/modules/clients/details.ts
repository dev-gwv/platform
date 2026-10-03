import { Hono } from 'hono'
import {
  clientDetailsRequest,
  clientDetailsResult,
  detailsLinkIssued,
  projectDetailsStatus,
  publicClientDetails,
  type DetailsEvent,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { textParam, uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { newRawToken, sha256Hex } from '../../lib/auth-token'

/**
 * The details form a client fills (0244). Studio side, under /client-details:
 * a project's link (the raw token goes back once; the database keeps its
 * hash) and the studio's own form (a short code, printed as a QR). Public
 * side, /public/details/:token: no session, everything scoped by the token
 * inside SECURITY DEFINER functions, called as the service.
 */
const formUrl = (appUrl: string | undefined, raw: string) => `${(appUrl ?? '').replace(/\/+$/, '')}/details/${raw}`

const sameEvent = (a: { name: string; date?: string | null | undefined }, b: { name: string; date?: string | null | undefined }) =>
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && (a.date ?? null) === (b.date ?? null)

/** The client's events that are not on the project yet, newest send first, each once. */
export function waitingEvents(sent: DetailsEvent[][], shoots: { name: string; date: string | null }[]): DetailsEvent[] {
  const out: DetailsEvent[] = []
  for (const events of sent) {
    for (const e of events) {
      if (!e?.name?.trim()) continue
      if (shoots.some((s) => sameEvent(s, e)) || out.some((o) => sameEvent(o, e))) continue
      out.push(e)
    }
  }
  return out
}

export const clientDetailsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/projects/:id', requireAction('projects', 'view'), async (c) => {
    const id = uuidParam(c)
    const data = await attempt(c, 'client_details.status', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const project = await sql`select 1 from projects where id = ${id}`
        if (!project[0]) return null
        const [link] = await sql<{ created_at: string; last_submitted_at: string | null }[]>`
          select created_at, last_submitted_at from client_detail_links
           where project_id = ${id} and revoked_at is null`
        const sent = await sql<{ events: DetailsEvent[] | null }[]>`
          select payload -> 'events' as events from client_detail_submissions
           where project_id = ${id} order by created_at desc limit 5`
        const shoots = await sql<{ name: string; date: string | null }[]>`
          select name, shoot_date::text as date from shoots where project_id = ${id} and status <> 'cancelled'`
        return {
          sent_at: link?.created_at ?? null,
          last_submitted_at: link?.last_submitted_at ?? null,
          waiting: waitingEvents(sent.map((s) => (Array.isArray(s.events) ? s.events : [])), shoots),
        }
      }),
    )
    if (!data) fail(404, 'That project was not found.')
    return c.json(projectDetailsStatus.parse(data))
  })

  /** A new link for the project; the old one stops working. */
  .post('/projects/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const raw = newRawToken()
    const hash = await sha256Hex(raw)
    const ok = await attempt(
      c,
      'client_details.issue',
      () => withUser(c.env, c.get('auth').userId, (sql) => sql`select issue_client_details_link(${id}, ${hash}) as id`),
      { onCode: (code) => (code === 'P0002' ? fail(404, 'That project was not found.') : undefined) },
    )
    if (!ok) fail(400, 'We could not make the link.')
    await audit(c, { action: 'client_details.link', entityType: 'project', entityId: id })
    return c.json(detailsLinkIssued.parse({ url: formUrl(c.env.APP_URL, raw) }), 201)
  })

  /** The studio's own form: the same link every time, until it is replaced. */
  .get('/studio', requireAction('clients', 'create'), async (c) => {
    const rows = await attempt(c, 'client_details.studio', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ code: string }[]>`select client_details_studio_code(false) as code`),
    )
    if (!rows?.[0]) fail(400, 'We could not load the client form.')
    return c.json(detailsLinkIssued.parse({ url: formUrl(c.env.APP_URL, rows[0].code) }))
  })

  /** A new studio link; the printed QR and the old link stop working. */
  .post('/studio/new', requireAction('clients', 'create'), async (c) => {
    const rows = await attempt(c, 'client_details.studio_new', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ code: string }[]>`select client_details_studio_code(true) as code`),
    )
    if (!rows?.[0]) fail(400, 'We could not make a new link.')
    await audit(c, { action: 'client_details.studio_new', entityType: 'company', entityId: c.get('auth').companyId })
    return c.json(detailsLinkIssued.parse({ url: formUrl(c.env.APP_URL, rows[0].code) }))
  })

const GONE = 'This link is not working any more. Please ask the studio for a new one.'

function detailsToken(c: Parameters<typeof textParam>[0]): string {
  const token = textParam(c, 'token', 200)
  if (!/^[A-Za-z0-9-]+$/.test(token)) fail(404, GONE)
  return token
}

export const publicClientDetailsRouter = new Hono<AppEnv>()
  .get('/details/:token', async (c) => {
    const token = detailsToken(c)
    const rows = await attempt(c, 'client_details.public_get', () =>
      withService(c.env, (sql) => sql<{ d: unknown }[]>`select client_details_for_token(${token}) as d`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]?.d) fail(404, GONE)
    c.header('Cache-Control', 'no-store')
    return c.json(publicClientDetails.parse(rows[0].d))
  })

  .post('/details/:token', async (c) => {
    const token = detailsToken(c)
    const parsed = clientDetailsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the form.')
    const rows = await attempt(
      c,
      'client_details.public_submit',
      () => withService(c.env, (sql) => sql<{ r: unknown }[]>`select client_details_submit(${token}, ${sql.json(parsed.data as never)}) as r`),
      {
        onCode: (code, err) => {
          if (code === 'P0002') fail(404, GONE)
          if (code === '22023') fail(422, (err as { message?: string }).message ?? 'Please check the form.')
          return undefined
        },
      },
    )
    if (!rows?.[0]) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    return c.json(clientDetailsResult.parse(rows[0].r))
  })
