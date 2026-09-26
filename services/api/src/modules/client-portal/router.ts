import { Hono } from 'hono'
import {
  clientPortalFeedbackItem,
  clientPortalFeedbackRequest,
  clientPortalIssued,
  clientPortalLinkInfo,
  clientPortalStatus,
  createClientPortalLinkRequest,
  publicClientPortal,
  publicInvoice,
  updateClientPortalLinkRequest,
  z,
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
 * Client portal (0184): one private link per project, for the client.
 *
 * Studio side, under /client-portal/projects/:id -- see it on `projects.view`,
 * make, change or stop it on `projects.edit`. The raw token is made here and
 * returned once; the database keeps only its SHA-256.
 *
 * Public side, under /public/portal/:token -- no session. Every read goes
 * through a SECURITY DEFINER function scoped by the token to one project of
 * one studio, as service_role; nothing here takes an id the token does not
 * already own.
 */

const LINK_COLUMNS = 'id, created_at, expires_at, show_payments, show_team, allow_feedback, last_viewed_at, view_count'

const portalUrl = (appUrl: string | undefined, raw: string) => `${(appUrl ?? '').replace(/\/+$/, '')}/p/${raw}`

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

/** The issue/options functions' own refusals, said plainly. */
function portalRuleBroken(code: string): never | undefined {
  if (code === 'P0002') fail(404, 'That project was not found.')
  if (code === '22023') fail(422, 'The expiry must be in the future.')
  return undefined
}

export const clientPortalRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/projects/:id', requireAction('projects', 'view'), async (c) => {
    const id = uuidParam(c)
    const data = await attempt(c, 'client_portal.status', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const project = await sql`select 1 from projects where id = ${id}`
        if (!project[0]) return { missing: true as const }
        const links = await sql`
          select ${sql.unsafe(LINK_COLUMNS)} from client_portal_links
           where project_id = ${id} and revoked_at is null`
        const feedback = await sql`
          select f.id, f.deliverable_id, d.title as deliverable_title, f.kind, f.message, f.created_at
            from client_portal_feedback f
            left join deliverables d on d.id = f.deliverable_id
           where f.project_id = ${id}
           order by f.created_at desc
           limit 5`
        return { link: links[0] ?? null, recent_feedback: feedback }
      }),
    )
    if (!data) fail(400, 'We could not load the client portal.')
    if ('missing' in data) fail(404, 'That project was not found.')
    return c.json(
      clientPortalStatus.parse({
        link: data.link ? clientPortalLinkInfo.parse(data.link) : null,
        recent_feedback: z.array(clientPortalFeedbackItem).parse(data.recent_feedback),
      }),
    )
  })

  /** A new link. Any older link for the project stops working. */
  .post('/projects/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createClientPortalLinkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the link settings.')
    const d = parsed.data
    const raw = newRawToken()
    const hash = await sha256Hex(raw)
    const row = await attempt(
      c,
      'client_portal.issue',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const made = await sql<{ id: string }[]>`
            select issue_client_portal_link(
              p_project => ${id},
              p_token_hash => ${hash},
              p_show_payments => ${d.show_payments},
              p_show_team => ${d.show_team},
              p_allow_feedback => ${d.allow_feedback},
              p_expires_at => ${d.expires_in_days ? daysFromNow(d.expires_in_days) : null}
            ) as id`
          const rows = await sql`select ${sql.unsafe(LINK_COLUMNS)} from client_portal_links where id = ${made[0]!.id}`
          return rows[0] ?? null
        }),
      { onCode: portalRuleBroken },
    )
    if (!row) fail(400, 'We could not make the link.')
    const link = clientPortalLinkInfo.parse(row)
    await audit(c, {
      action: 'client_portal.create',
      entityType: 'project',
      entityId: id,
      after: { link_id: link.id, show_payments: link.show_payments, show_team: link.show_team, allow_feedback: link.allow_feedback, expires_at: link.expires_at },
    })
    return c.json(clientPortalIssued.parse({ link, url: portalUrl(c.env.APP_URL, raw) }), 201)
  })

  /** Change what the live link shows; the link itself stays the same. */
  .patch('/projects/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = updateClientPortalLinkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the link settings.')
    const d = parsed.data
    const row = await attempt(
      c,
      'client_portal.options',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const ok = await sql<{ ok: boolean }[]>`
            select set_client_portal_options(
              p_project => ${id},
              p_show_payments => ${d.show_payments ?? null},
              p_show_team => ${d.show_team ?? null},
              p_allow_feedback => ${d.allow_feedback ?? null},
              p_expires_at => ${d.expires_in_days ? daysFromNow(d.expires_in_days) : null},
              p_clear_expiry => ${d.expires_in_days === null}
            ) as ok`
          if (!ok[0]?.ok) return { missing: true as const }
          const rows = await sql`
            select ${sql.unsafe(LINK_COLUMNS)} from client_portal_links
             where project_id = ${id} and revoked_at is null`
          return rows[0] ?? null
        }),
      { onCode: portalRuleBroken },
    )
    if (!row) fail(400, 'We could not save the link settings.')
    if ('missing' in row) fail(404, 'This project has no live client link.')
    const link = clientPortalLinkInfo.parse(row)
    await audit(c, { action: 'client_portal.update', entityType: 'project', entityId: id, after: d })
    return c.json(link)
  })

  /** Stop the link. The client sees "this link no longer works". */
  .delete('/projects/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'client_portal.revoke', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ ok: boolean }[]>`select revoke_client_portal_link(${id}) as ok`),
    )
    if (!rows) fail(400, 'We could not stop the link.')
    if (!rows[0]?.ok) fail(404, 'This project has no live client link.')
    await audit(c, { action: 'client_portal.revoke', entityType: 'project', entityId: id })
    return c.json({ ok: true })
  })

const GONE = 'This link is not working any more. Please ask the studio for a new one.'

/** Token shape check before touching the database: 1..200 chars, url-safe. */
function portalToken(c: Parameters<typeof textParam>[0]): string {
  const token = textParam(c, 'token', 200)
  if (!/^[A-Za-z0-9-]+$/.test(token)) fail(404, GONE)
  return token
}

export const publicClientPortalRouter = new Hono<AppEnv>()
  .get('/portal/:token', async (c) => {
    const token = portalToken(c)
    const rows = await attempt(c, 'client_portal.public_get', () =>
      withService(c.env, (sql) => sql<{ doc: unknown }[]>`select get_client_portal(p_raw => ${token}) as doc`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]?.doc) fail(404, GONE)
    c.header('Cache-Control', 'no-store')
    return c.json(publicClientPortal.parse(rows[0].doc))
  })

  .get('/portal/:token/invoices/:id', async (c) => {
    const token = portalToken(c)
    const id = uuidParam(c)
    const rows = await attempt(c, 'client_portal.public_invoice', () =>
      withService(c.env, (sql) => sql<{ doc: unknown }[]>`select client_portal_invoice(p_raw => ${token}, p_invoice => ${id}) as doc`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]?.doc) fail(404, 'This invoice is not available on this link.')
    c.header('Cache-Control', 'no-store')
    return c.json(publicInvoice.parse(rows[0].doc))
  })

  .get('/portal/:token/terms/:id', async (c) => {
    const token = portalToken(c)
    const id = uuidParam(c)
    const rows = await attempt(c, 'client_portal.public_terms', () =>
      withService(c.env, (sql) => sql<Record<string, unknown>[]>`select * from client_portal_terms(p_raw => ${token}, p_doc => ${id})`),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const doc = rows[0]
    if (!doc) fail(404, 'This document is not available on this link.')
    c.header('Cache-Control', 'no-store')
    return c.json({ ...doc, body: (doc.body as string | null) ?? '', total_cost: doc.total_cost == null ? null : Number(doc.total_cost) })
  })

  .post('/portal/:token/feedback', async (c) => {
    const token = portalToken(c)
    const parsed = clientPortalFeedbackRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check your note.')
    const d = parsed.data
    const rows = await attempt(c, 'client_portal.public_feedback', () =>
      withService(
        c.env,
        (sql) => sql<{ ok: boolean }[]>`
          select client_portal_leave_feedback(
            p_raw => ${token}, p_deliverable => ${d.deliverable_id},
            p_kind => ${d.kind}, p_message => ${d.message ?? null}
          ) as ok`,
      ),
    )
    if (!rows) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (!rows[0]?.ok) fail(409, 'We could not send this note. The link may have changed — please ask the studio.')
    return c.json({ ok: true })
  })
