import { Hono } from 'hono'
import {
  createLeadSourceRequest,
  leadSourceRow,
  updateLeadSourceRequest,
  fbImportsQuery,
  fbImportsSummary,
  fbLeadImport,
  fbTestImportRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { cleanLead } from '../../lib/lead-fields'
import { edit, remove } from './shared'

export const crmSourceRoutes = new Hono<AppEnv>()
  // ── Lead sources ────────────────────────────────────────────
  // Each row is an inbox: a key a web form or Meta posts to. The counts come
  // from the leads that actually arrived through it, which is the only way to
  // answer "is this campaign worth paying for".
  .get('/sources', async (c) => {
    const rows = await attempt(c, 'crm.sources', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select s.id, s.label, s.source_key, s.kind, s.is_active, s.created_at,
                  s.source_type, s.allowed_origin, s.default_source, s.default_stage,
                  s.default_quality, s.default_assigned_to, s.last_received_at,
                  coalesce(l.total, 0)::int as lead_count,
                  l.last_lead_at
           from crm_webhook_sources s
           left join lateral (
             select count(*) as total, max(created_at) as last_lead_at
             from crm_leads where source_key = s.source_key
           ) l on true
           order by s.is_active desc, s.created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load your lead sources.')
    return c.json(leadSourceRow.array().parse(rows))
  })

  .post('/sources', requireAction('crm', 'create'), async (c) => {
    const parsed = createLeadSourceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the source.')
    const { label, kind, source_type, allowed_origin, default_source, default_quality, default_assigned_to } = parsed.data

    // The key is generated in SQL and never accepted from the client — it is
    // the one credential that lets an unauthenticated caller write leads here.
    const row = await attempt(c, 'crm.source_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [created] = await sql`select * from create_lead_source(${label}, ${kind})`
        if (!created) return null
        const [full] = await sql`
          update crm_webhook_sources
             set source_type = ${source_type},
                 allowed_origin = ${allowed_origin ?? null},
                 default_source = ${default_source ?? null},
                 default_quality = ${default_quality ?? null},
                 default_assigned_to = ${default_assigned_to ?? null}
           where id = ${created.id}
           returning *`
        return full ?? created
      }),
    )
    if (!row) fail(400, 'We could not create this lead source.')
    const created = leadSourceRow.parse({ ...row, lead_count: 0, last_lead_at: null })
    await audit(c, { action: 'lead_source.create', entityType: 'crm_webhook_source', entityId: created.id, after: { label, kind } })
    return c.json(created, 201)
  })

  .patch('/sources/:id', edit, async (c) => {
    const parsed = updateLeadSourceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.source_update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update crm_webhook_sources set ${sql(parsed.data)} where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update this lead source.')
    if (!rows.length) fail(404, 'We could not find that lead source.')
    await audit(c, { action: 'lead_source.update', entityType: 'crm_webhook_source', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  // Deleting a source stops the key working. Leads it already brought in stay —
  // they belong to the studio, not to the form that delivered them.
  .delete('/sources/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.source_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from crm_webhook_sources where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not delete this lead source.')
    if (!rows.length) fail(404, 'We could not find that lead source.')
    await audit(c, { action: 'lead_source.delete', entityType: 'crm_webhook_source', entityId: id })
    return c.body(null, 204)
  })

  // ── Per-source import log (fb_lead_imports) ───────────────────
  // Every lead that arrives through a source — webhook, Meta, or the Test
  // Center — leaves a row here, so "did the form work" is answerable.
  .get('/sources/:id/leads', async (c) => {
    const sourceId = uuidParam(c)
    const q = fbImportsQuery.safeParse({
      search: c.req.query('search'),
      status: c.req.query('status'),
      page: c.req.query('page'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
      sort: c.req.query('sort'),
      limit: c.req.query('limit'),
    })
    if (!q.success) fail(422, 'Invalid query.')
    const v = q.data
    const needle = v.search ? `%${v.search.replace(/[%_]/g, '')}%` : null
    const rows = await attempt(c, 'crm.source_leads', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [src] = await sql<{ id: string }[]>`select id from crm_webhook_sources where id = ${sourceId}`
        if (!src) return 'missing' as const
        const items = await sql`
          select id, source_id, page_id, page_name, leadgen_id, name, phone, email,
                 status, error, lead_id, created_at
          from fb_lead_imports
          where source_id = ${sourceId}
            and ${v.status ? sql`status = ${v.status}` : sql`true`}
            and ${v.page ? sql`page_id = ${v.page}` : sql`true`}
            and ${v.date_from ? sql`created_at >= ${v.date_from}::timestamptz` : sql`true`}
            and ${v.date_to ? sql`created_at <= ${v.date_to}::timestamptz` : sql`true`}
            and ${needle ? sql`(name ilike ${needle} or phone ilike ${needle} or email ilike ${needle})` : sql`true`}
          order by ${v.sort === 'oldest' ? sql`created_at asc` : sql`created_at desc`}
          limit ${v.limit}`
        const [sum] = await sql<{
          total: number; imported: number; duplicates: number; failed: number; pending: number;
        }[]>`
          select count(*)::int as total,
                 count(*) filter (where status = 'imported')::int as imported,
                 count(*) filter (where status = 'duplicate')::int as duplicates,
                 count(*) filter (where status = 'failed')::int as failed,
                 count(*) filter (where status = 'pending')::int as pending
          from fb_lead_imports where source_id = ${sourceId}`
        return { items, summary: sum ?? { total: 0, imported: 0, duplicates: 0, failed: 0, pending: 0 } }
      }),
    )
    if (rows === 'missing') fail(404, 'We could not find that lead source.')
    if (!rows) fail(400, 'We could not load the import log.')
    return c.json({
      items: fbLeadImport.array().parse(rows.items),
      summary: fbImportsSummary.parse(rows.summary),
    })
  })

  // Test Center: push a sample lead through the source's own webhook path.
  .post('/sources/:id/leads/test', edit, async (c) => {
    const sourceId = uuidParam(c)
    const parsed = fbTestImportRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Give the test lead a valid phone number.')
    const t = parsed.data
    const row = await attempt(c, 'crm.source_lead_test', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [src] = await sql<{ id: string; source_key: string; kind: string }[]>`
          select id, source_key, kind from crm_webhook_sources where id = ${sourceId}`
        if (!src) return 'missing' as const
        const l = cleanLead({ name: t.name, phone: t.phone, email: t.email })
        const [lead] = await sql<{ id: string }[]>`select capture_lead(${src.source_key}, ${l.name}, ${l.phone}, ${l.email}, ${sql.json(l.meta as Parameters<typeof sql.json>[0])}) as id`
        if (!lead) return null
        const [imp] = await sql`
          insert into fb_lead_imports (company_id, source_id, page_id, page_name, name, phone, email, status, lead_id)
          values (get_current_company_id(), ${sourceId}, ${t.page_id ?? null}, ${t.page_name ?? null},
                  ${l.name}, ${l.phone}, ${l.email}, 'imported', ${lead.id})
          returning id, source_id, page_id, page_name, leadgen_id, name, phone, email, status, error, lead_id, created_at`
        return imp ?? null
      }),
    )
    if (row === 'missing') fail(404, 'We could not find that lead source.')
    if (!row) fail(400, 'The test lead could not be captured.')
    await audit(c, { action: 'lead_source.test', entityType: 'crm_webhook_source', entityId: sourceId })
    return c.json(fbLeadImport.parse(row), 201)
  })

  .post('/sources/:sourceId/leads/:importId/retry', edit, async (c) => {
    const sourceId = uuidParam(c, 'sourceId')
    const importId = uuidParam(c, 'importId')
    const row = await attempt(c, 'crm.source_lead_retry', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [imp] = await sql<{
          id: string; name: string | null; phone: string | null; email: string | null; source_id: string | null;
        }[]>`
          select id, name, phone, email, source_id from fb_lead_imports
          where id = ${importId} and source_id = ${sourceId} and status = 'failed'`
        if (!imp) return null
        // A lead needs something to call back on. A missing or unusable phone
        // is fine (lib/lead-fields.ts stores it as null) as long as there is
        // an email or a name; with nothing at all, say so rather than "not found".
        const l = cleanLead({ name: imp.name, phone: imp.phone, email: imp.email })
        if (!l.phone && !l.email && !l.name) return 'no-phone' as const
        const [src] = await sql<{ source_key: string }[]>`
          select source_key from crm_webhook_sources where id = ${sourceId}`
        if (!src) return null
        const [lead] = await sql<{ id: string }[]>`select capture_lead(${src.source_key}, ${l.name}, ${l.phone}, ${l.email}, ${sql.json(l.meta as Parameters<typeof sql.json>[0])}) as id`
        if (!lead) return null
        const [out] = await sql`
          update fb_lead_imports set status = 'imported', error = null, lead_id = ${lead.id}
          where id = ${importId}
          returning id, source_id, page_id, page_name, leadgen_id, name, phone, email, status, error, lead_id, created_at`
        return out ?? null
      }),
    )
    if (row === 'no-phone') fail(422, 'That lead arrived with no phone, email or name, so it cannot be imported.')
    if (!row) fail(404, 'That failed import was not found.')
    return c.json(fbLeadImport.parse(row))
  })

  .delete('/sources/:sourceId/leads/:importId', remove, async (c) => {
    const sourceId = uuidParam(c, 'sourceId')
    const importId = uuidParam(c, 'importId')
    const rows = await attempt(c, 'crm.source_lead_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from fb_lead_imports where id = ${importId} and source_id = ${sourceId} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not delete that import row.')
    if (!rows.length) fail(404, 'That import row was not found.')
    return c.body(null, 204)
  })
