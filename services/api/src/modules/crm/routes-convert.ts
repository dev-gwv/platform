import { Hono } from 'hono'
import { convertLeadRequest, convertLeadResponse } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { claimRule } from './rules'

export const crmConvertRoutes = new Hono<AppEnv>()
  // ── Lead → project ──────────────────────────────────────────
  // Winning a lead should leave a project behind, not just a status.
  // Client-only convert (no project): the lead is won and linked to the
  // client; converted_project_id stays null until the project comes later.
  .post('/leads/:id/convert', requireAction('crm', 'edit'), async (c) => {
    const parsed = convertLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the project details.')
    const leadId = uuidParam(c)
    const v = parsed.data
    // A lead can start with just a name, but a client needs a number: say so
    // plainly rather than failing inside the conversion.
    if (!v.client_id) {
      const known = await attempt(c, 'crm.convert_phone', () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql<{ phone: string | null }[]>`select phone from crm_leads where id = ${leadId}`),
      )
      if (known?.[0] && !known[0].phone?.trim() && !v.client?.phone) fail(422, 'Add a phone number to this lead before booking it.')
    }
    const row = await attempt(
      c,
      'crm.convert',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ client_id: string; project_id: string | null }[]>`
            select * from convert_lead_to_project(
              ${leadId}, ${v.client_id ?? null}, ${sql.json(v.client ?? {})}, ${v.project ? sql.json(v.project) : null}, ${v.quote_id ?? null})`
          const made = rows[0] ?? null
          // Each function the couple asked for becomes a shoot on the new
          // project -- Haldi, Wedding, Reception arrive already planned. Not
          // when the project already has shoots (a quote may have brought them).
          if (made?.project_id) {
            await sql`
              insert into shoots (company_id, project_id, name, shoot_date, location, guests)
              select f.company_id, ${made.project_id}, coalesce(f.event_type, 'Shoot'), f.event_date, f.location, f.guests
                from crm_lead_functions f
               where f.lead_id = ${leadId}
                 and not exists (select 1 from shoots s where s.project_id = ${made.project_id})
               order by f.event_date nulls last, f.sort`
          }
          return made
        }),
      { onCode: (code, err) => (code === '22023' && String((err as { message?: string })?.message ?? '').includes('already') ? ('done' as const) : undefined) },
    )
    if (row === 'done') fail(409, 'This lead has already been converted.')
    if (!row) fail(400, 'We could not convert this lead.')
    await audit(c, { action: 'lead.convert', entityType: 'crm_lead', entityId: leadId, after: { ...row, client_only: !v.project && !v.quote_id } })
    return c.json(convertLeadResponse.parse(row), 201)
  })

  // Booked by mistake (0286): the lead goes back to the first open stage and
  // forgets the project and client. Both stay -- the project is deleted from
  // its own page if it should go.
  .post('/leads/:id/unbook', requireAction('crm', 'edit'), async (c) => {
    const leadId = uuidParam(c)
    const before = await attempt(c, 'crm.unbook_read', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ converted_project_id: string | null; converted_client_id: string | null }[]>`
        select converted_project_id, converted_client_id from crm_leads where id = ${leadId}`),
    )
    if (!before) fail(400, 'We could not undo this booking.')
    if (!before[0]) fail(404, 'That lead was not found.')
    const done = await attempt(
      c,
      'crm.unbook',
      () => withUser(c.env, c.get('auth').userId, (sql) => sql`select crm_unbook_lead(${leadId}) as stage_id`),
      { onCode: claimRule },
    )
    if (done && 'rule' in done) fail(422, done.rule)
    if (!done) fail(400, 'We could not undo this booking.')
    await audit(c, { action: 'lead.unbook', entityType: 'crm_lead', entityId: leadId, before: before[0] })
    return c.body(null, 204)
  })
