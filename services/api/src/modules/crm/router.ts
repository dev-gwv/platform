import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  bulkLeadPatch,
  bulkPatchResponse,
  bulkUndoRequest,
  bulkUndoResponse,
  cadence,
  cadenceStartResponse,
  convertLeadRequest,
  convertLeadResponse,
  createCadenceRequest,
  createSavedViewRequest,
  createDistributionRequest,
  createLeadRequest,
  createLeadResponse,
  createLeadSourceRequest,
  createTemplateRequest,
  updateTemplateRequest,
  crmLead,
  crmSettings,
  crmStats,
  crmStatsQuery,
  crmTeamStatsRow,
  crmTemplate,
  csvImportCommitRequest,
  csvImportCommitResponse,
  csvImportPreviewRequest,
  csvImportPreviewResponse,
  distributionRule,
  duplicateGroup,
  idResponse,
  leadCadence,
  leadSourceRow,
  leadsQuery,
  mergeLeadsRequest,
  mergeLeadsResponse,
  markCadenceSentRequest,
  normalizePhone,
  resolveDuplicateRequest,
  resolveDuplicateResponse,
  savedView,
  sendTemplateRequest,
  sendTemplateResponse,
  unmergeLeadsRequest,
  startCadenceRequest,
  unmergeLeadsResponse,
  updateCadenceRequest,
  updateCrmSettingsRequest,
  updateDistributionRequest,
  updateLeadRequest,
  updateLeadSourceRequest,
  updateSavedViewRequest,
  fbImportsQuery,
  fbImportsSummary,
  fbLeadImport,
  fbTestImportRequest,
  type CsvImportRow,
} from '@ipc/contracts'
import { leadsFromCsv, parseCsv, renderTemplate, crmTemplateVars } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { sendWhatsAppText, whatsappConfigured, whatsappLink } from '../../lib/whatsapp'
import { crmObjectsRouter } from './objects'
import { crmActivitiesRouter } from './activities'
import { crmWorkflowsRouter } from './workflows'
import { crmQuotesRouter } from './quotes'

const list = crmLead.array()
const edit = requireAction('crm', 'edit')
const remove = requireAction('crm', 'delete')

/** The one projection every lead read uses, so the wire shape cannot drift. */
const selectLead = (sql: TransactionSql) => sql`
  select l.id, l.name, l.phone, l.email, l.source, l.status, l.assigned_to, l.notes,
         l.follow_up_at, l.last_contacted_at, l.converted_at, l.is_hot, l.is_archived,
         l.merged_into, l.converted_project_id, l.converted_client_id, l.deal_value, l.probability, l.lost_reason, l.lost_competitor,
         l.sla_due_at, l.pipeline_id, l.stage_id, s.name as stage_name, l.contact_id, l.crm_company_id,
         co.name as crm_company_name, l.title, l.close_date, l.currency, l.score, l.created_at,
         l.event_type, l.event_date, l.event_location, l.alternate_phone, l.city, l.group_name,
         l.quality, l.contacted_status,
         u.name as assignee_name,
         -- Is the studio free on this lead's date? Derived in one pass by
         -- 0193 rather than per row, and joined here so the list and the
         -- single-lead read can never disagree about it.
         coalesce(av.status, 'unknown') as date_status,
         coalesce(av.wanted_by, 0)::int as date_wanted_by
  from crm_leads l
  left join users u on u.user_id = l.assigned_to
  left join crm_pipeline_stages s on s.id = l.stage_id
  left join crm_companies co on co.id = l.crm_company_id
  left join crm_date_availability() av on av.on_date = l.event_date`

const dateRange = (c: { req: { query: (k: string) => string | undefined } }) => {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - 29)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const parsed = crmStatsQuery.safeParse({
    from: c.req.query('from') ?? iso(from),
    to: c.req.query('to') ?? iso(today),
    source: c.req.query('source') || undefined,
    assignee: c.req.query('assignee') || undefined,
  })
  if (!parsed.success || parsed.data.to < parsed.data.from) fail(422, 'Pick a valid date range.')
  return parsed.data
}

export const crmRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('crm'))

  // ── Leads ───────────────────────────────────────────────────
  .get('/leads', async (c) => {
    const q = leadsQuery.safeParse({
      include_archived: c.req.query('include_archived'),
      limit: c.req.query('limit'),
      pipeline_id: c.req.query('pipeline_id'),
      stage_id: c.req.query('stage_id'),
      contact_id: c.req.query('contact_id'),
      crm_company_id: c.req.query('crm_company_id'),
      q: c.req.query('q'),
      source: c.req.query('source'),
      stage: c.req.query('stage'),
      quality: c.req.query('quality'),
      contacted: c.req.query('contacted'),
      group: c.req.query('group'),
      budget_min: c.req.query('budget_min'),
      budget_max: c.req.query('budget_max'),
      city: c.req.query('city'),
      event_date: c.req.query('event_date'),
      event_date_from: c.req.query('event_date_from'),
      event_date_to: c.req.query('event_date_to'),
      date_created: c.req.query('date_created'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
      follow_up: c.req.query('follow_up'),
      assigned: c.req.query('assigned'),
      unassigned: c.req.query('unassigned'),
    })
    if (!q.success) fail(422, 'Invalid query.')
    const v = q.data
    const { include_archived, limit, pipeline_id, stage_id, contact_id, crm_company_id, q: text } = v
    const needle = text ? `%${text.replace(/[%_]/g, '')}%` : null
    const groupNeedle = v.group ? `%${v.group.replace(/[%_]/g, '')}%` : null
    const cityNeedle = v.city ? `%${v.city.replace(/[%_]/g, '')}%` : null
    const rows = await attempt(c, 'crm.leads', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          ${selectLead(sql)}
          where ${include_archived ? sql`true` : sql`l.is_archived = false`}
            and ${pipeline_id ? sql`l.pipeline_id = ${pipeline_id}` : sql`true`}
            and ${stage_id ? sql`l.stage_id = ${stage_id}` : sql`true`}
            and ${contact_id ? sql`l.contact_id = ${contact_id}` : sql`true`}
            and ${crm_company_id ? sql`l.crm_company_id = ${crm_company_id}` : sql`true`}
            and ${v.source ? sql`l.source = ${v.source}` : sql`true`}
            and ${v.stage ? sql`l.status = ${v.stage}` : sql`true`}
            and ${v.quality ? sql`l.quality = ${v.quality}` : sql`true`}
            and ${v.contacted ? sql`l.contacted_status = ${v.contacted}` : sql`true`}
            and ${groupNeedle ? sql`l.group_name ilike ${groupNeedle}` : sql`true`}
            and ${v.budget_min !== undefined ? sql`coalesce(l.deal_value, 0) >= ${v.budget_min}` : sql`true`}
            and ${v.budget_max !== undefined ? sql`coalesce(l.deal_value, 0) <= ${v.budget_max}` : sql`true`}
            and ${cityNeedle ? sql`l.city ilike ${cityNeedle}` : sql`true`}
            and ${v.event_date ? sql`l.event_date = ${v.event_date}` : sql`true`}
            and ${v.event_date_from ? sql`l.event_date >= ${v.event_date_from}` : sql`true`}
            and ${v.event_date_to ? sql`l.event_date <= ${v.event_date_to}` : sql`true`}
            and ${v.date_created === 'today' ? sql`l.created_at >= date_trunc('day', now())` : sql`true`}
            and ${v.date_created === 'last7' ? sql`l.created_at >= now() - interval '7 days'` : sql`true`}
            and ${v.date_created === 'this_month' ? sql`l.created_at >= date_trunc('month', now())` : sql`true`}
            and ${v.date_from ? sql`l.created_at >= ${v.date_from}::timestamptz` : sql`true`}
            and ${v.date_to ? sql`l.created_at < (${v.date_to}::date + 1)::timestamptz` : sql`true`}
            and ${v.follow_up === 'today' ? sql`l.follow_up_at >= date_trunc('day', now()) and l.follow_up_at < date_trunc('day', now()) + interval '1 day'` : sql`true`}
            and ${v.follow_up === 'upcoming' ? sql`l.follow_up_at >= date_trunc('day', now()) + interval '1 day'` : sql`true`}
            and ${v.follow_up === 'overdue' ? sql`l.follow_up_at < now()` : sql`true`}
            and ${v.follow_up === 'none' ? sql`l.follow_up_at is null` : sql`true`}
            and ${v.assigned ? sql`l.assigned_to = ${v.assigned}` : sql`true`}
            and ${v.unassigned ? sql`l.assigned_to is null` : sql`true`}
            and ${needle ? sql`(l.name ilike ${needle} or l.phone ilike ${needle} or l.email ilike ${needle} or l.title ilike ${needle})` : sql`true`}
          order by l.created_at desc
          limit ${limit}`,
      ),
    )
    if (!rows) fail(400, 'We could not load leads.')
    return c.json(list.parse(rows))
  })

  // Manual entry. add_lead carries the dedupe and round-robin the webhook path
  // uses, so a lead typed in by hand behaves like one that arrived by itself —
  // including handing back the existing row when the number is already known.
  .post('/leads', requireAction('crm', 'create'), async (c) => {
    const parsed = createLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the lead details.')
    const v = parsed.data

    // add_lead() dedupes on the normalised number and returns the row that
    // already exists, so ask first — otherwise the client cannot tell a new
    // lead from one it just re-opened.
    const norm = normalizePhone(v.phone)
    const row = await attempt(c, 'crm.lead_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [known] = norm
          ? await sql<{ id: string }[]>`select id from crm_leads where phone_norm = ${norm} limit 1`
          : []
        const [created] = await sql<{ id: string }[]>`
          select add_lead(
            ${v.name ?? null}, ${v.phone}, ${v.email ?? null},
            ${v.source}, ${v.notes ?? null}, ${v.assigned_to ?? null}
          ) as id`
        const id = created?.id
        if (!id) return null
        const extra: Record<string, unknown> = {}
        if (v.follow_up_at) extra.follow_up_at = v.follow_up_at
        if (v.deal_value !== undefined) extra.deal_value = v.deal_value
        if (v.probability !== undefined) extra.probability = v.probability
        if (v.title !== undefined) extra.title = v.title
        if (v.close_date !== undefined) extra.close_date = v.close_date
        if (v.event_type !== undefined) extra.event_type = v.event_type
        if (v.event_date !== undefined) extra.event_date = v.event_date
        if (v.event_location !== undefined) extra.event_location = v.event_location
        if (v.alternate_phone !== undefined) extra.alternate_phone = v.alternate_phone
        if (v.city !== undefined) extra.city = v.city
        if (v.crm_company_id !== undefined) extra.crm_company_id = v.crm_company_id
        if (v.group_name !== undefined) extra.group_name = v.group_name
        if (v.quality !== undefined) extra.quality = v.quality
        if (v.contacted_status !== undefined) extra.contacted_status = v.contacted_status
        // lost_reason only sticks on a lost lead; anything else is cleared by
        // the sync trigger. Accept it here so a lost-at-birth lead is possible.
        if (v.lost_reason !== undefined) extra.lost_reason = v.lost_reason
        // A known number hands back the existing row; only a fresh one is
        // placed in the pipeline the caller asked for.
        if (!known && v.pipeline_id !== undefined) extra.pipeline_id = v.pipeline_id
        if (!known && v.stage_id !== undefined) extra.stage_id = v.stage_id
        if (Object.keys(extra).length) await sql`update crm_leads set ${sql(extra)} where id = ${id}`
        const [lead] = await sql`${selectLead(sql)} where l.id = ${id}`
        return lead ? { lead, created: !known } : null
      }),
    )
    if (!row) fail(400, 'We could not add this lead.')
    const body = createLeadResponse.parse(row)
    if (body.created) {
      await audit(c, { action: 'lead.create', entityType: 'crm_lead', entityId: body.lead.id, after: { phone: v.phone, source: v.source } })
    }
    return c.json(body, body.created ? 201 : 200)
  })

  // Stage moves carry timestamps with them: leaving 'new' is the moment someone
  // was contacted, and reaching 'converted' is the moment it was won. Deriving
  // either from updated_at later would be a guess that a subsequent edit breaks.
  .patch('/leads/:id', edit, async (c) => {
    const parsed = updateLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    // lost must carry a reason, otherwise 400 would leak DB 22023 raw text
    if (parsed.data.status === 'lost' && !parsed.data.lost_reason) fail(422, 'Tell us why it was lost (3+ chars).')
    const patch = parsed.data
    const id = uuidParam(c)

    const result = await attempt(c, 'crm.lead_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [current] = await sql<{ status: string; last_contacted_at: string | null }[]>`
          select status, last_contacted_at from crm_leads where id = ${id}`
        if (!current) return 'missing' as const

        const stamps: Record<string, string | null> = {}
        if (patch.status && patch.status !== 'new' && !current.last_contacted_at) {
          stamps.last_contacted_at = new Date().toISOString()
        }
        if (patch.status === 'converted') stamps.converted_at = new Date().toISOString()
        // Moving back out of 'converted' un-wins it, or the month's total counts
        // a sale that is no longer one.
        if (patch.status && patch.status !== 'converted' && current.status === 'converted') {
          stamps.converted_at = null
        }
        await sql`update crm_leads set ${sql({ ...patch, ...stamps })} where id = ${id}`
        return { from: current.status }
      }),
      { onCode: (code) => (code === '22023' ? ('rule' as const) : undefined) },
    )
    if (result === 'rule') fail(422, 'Tell us why it was lost (3+ chars).')
    if (result === 'missing') fail(404, 'That lead was not found.')
    if (!result) fail(400, 'We could not update the lead.')
    // Money, reason and notes are material to the story; follow-up shuffles
    // already live in the events trail, so they stay out of the audit log.
    if (
      patch.status ||
      patch.assigned_to !== undefined ||
      patch.is_archived !== undefined ||
      patch.lost_reason !== undefined ||
      patch.deal_value !== undefined ||
      patch.probability !== undefined ||
      patch.notes !== undefined
    ) {
      await audit(c, { action: 'lead.update', entityType: 'crm_lead', entityId: id, before: { status: result.from }, after: patch })
    }
    return c.body(null, 204)
  })

  // ── Bulk edits, with undo ───────────────────────────────────
  .post('/leads/bulk', edit, async (c) => {
    const parsed = bulkLeadPatch.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid bulk patch.')
    const { ids, patch } = parsed.data
    if (patch.status === 'lost' && !patch.lost_reason) fail(422, 'Moving to Lost needs a reason.')
    const previous = await attempt(
      c,
      'crm.bulk',
      () =>
        withUser(
          c.env,
          c.get('auth').userId,
          (sql) => sql`select * from crm_bulk_patch(${sql.array(ids)}::uuid[], ${sql.json(patch)})`,
        ),
      { onCode: (code) => (code === '22023' ? ('rule' as const) : undefined) },
    )
    if (previous === 'rule') fail(422, 'Moving to Lost needs a reason.')
    if (!previous) fail(400, 'Bulk update failed.')
    await audit(c, { action: 'lead.bulk_update', entityType: 'crm_lead', after: { ids: ids.length, patch } })
    return c.json(bulkPatchResponse.parse({ updated: previous.length, previous }))
  })

  .post('/leads/bulk/undo', edit, async (c) => {
    const parsed = bulkUndoRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Nothing to undo.')
    const rows = await attempt(c, 'crm.bulk_undo', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ n: number }[]>`select crm_restore_leads(${sql.json(parsed.data.previous)}) as n`,
      ),
    )
    if (!rows) fail(400, 'We could not undo that change.')
    await audit(c, { action: 'lead.bulk_undo', entityType: 'crm_lead', after: { restored: rows[0]?.n ?? 0 } })
    return c.json(bulkUndoResponse.parse({ restored: rows[0]?.n ?? 0 }))
  })

  // ── Duplicates ──────────────────────────────────────────────
  .get('/duplicates', async (c) => {
    const rows = await attempt(c, 'crm.duplicates', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from crm_duplicate_groups()`),
    )
    if (!rows) fail(400, 'We could not load duplicates.')
    return c.json(duplicateGroup.array().parse(rows))
  })

  .post('/leads/merge', edit, async (c) => {
    const parsed = mergeLeadsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a survivor and at least one duplicate.')
    const { survivor_id, duplicate_ids } = parsed.data
    const rows = await attempt(c, 'crm.merge', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ merged: number }[]>`
          select merge_leads(${survivor_id}, ${sql.array(duplicate_ids)}::uuid[]) as merged`,
      ),
    )
    if (!rows) fail(400, 'Merge failed.')
    await audit(c, { action: 'lead.merge', entityType: 'crm_lead', entityId: survivor_id, after: { duplicate_ids } })
    return c.json(mergeLeadsResponse.parse({ merged: rows[0]?.merged ?? 0 }))
  })

  .post('/leads/unmerge', edit, async (c) => {
    const parsed = unmergeLeadsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick the lead to unmerge.')
    const rows = await attempt(c, 'crm.unmerge', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ restored: number }[]>`select unmerge_leads(${parsed.data.survivor_id}) as restored`,
      ),
    )
    if (!rows) fail(400, 'Unmerge failed.')
    await audit(c, { action: 'lead.unmerge', entityType: 'crm_lead', entityId: parsed.data.survivor_id })
    return c.json(unmergeLeadsResponse.parse({ restored: rows[0]?.restored ?? 0 }))
  })

  // Lovable parity: keep_separate / archive without merging notes.
  .post('/duplicates/resolve', edit, async (c) => {
    const parsed = resolveDuplicateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a lead and at least one duplicate.')
    const { survivor_id, duplicate_ids, action } = parsed.data
    const rows = await attempt(c, 'crm.duplicates_resolve', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ resolved: number }[]>`
          select resolve_crm_duplicates(${survivor_id}, ${sql.array(duplicate_ids)}::uuid[], ${action}) as resolved`,
      ),
    )
    if (!rows) fail(400, 'We could not resolve those duplicates.')
    await audit(c, { action: 'lead.duplicates_resolve', entityType: 'crm_lead', entityId: survivor_id, after: { duplicate_ids, action } })
    return c.json(resolveDuplicateResponse.parse({ resolved: rows[0]?.resolved ?? 0 }))
  })

  // ── CSV import ──────────────────────────────────────────────
  // Preview parses on the API with the same RFC 4180 parser the tests cover,
  // then asks the database one question per distinct number: is it known?
  .post('/imports/preview', requireAction('crm', 'create'), async (c) => {
    const parsed = csvImportPreviewRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Paste or upload a CSV first.')
    const { columns, records } = leadsFromCsv(parseCsv(parsed.data.csv))
    if (records.length === 0) fail(422, 'That file has no rows.')
    if (records.length > 500) fail(422, 'Up to 500 rows per import. Split the file and try again.')

    const norms = [...new Set(records.map((r) => (r.phone ? normalizePhone(r.phone) : null)).filter((n): n is string => !!n))]
    const known = await attempt(c, 'crm.import_preview', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        if (norms.length === 0) return new Set<string>()
        const rows = await sql<{ phone_norm: string }[]>`
          select distinct phone_norm from crm_leads
          where is_archived = false and phone_norm in ${sql(norms)}`
        return new Set(rows.map((r) => r.phone_norm))
      }),
    )
    if (!known) fail(400, 'Preview failed.')

    const seen = new Set<string>()
    const rows: CsvImportRow[] = records.map((r) => {
      const norm = r.phone ? normalizePhone(r.phone) : null
      let error: string | null = null
      if (!r.phone) error = 'Phone is required'
      else if (!norm) error = 'Not a valid phone number'
      const inFile = !!norm && seen.has(norm)
      if (norm) seen.add(norm)
      const source = r.source && ['facebook', 'webform', 'referral', 'manual', 'enquiry'].includes(r.source.toLowerCase())
        ? (r.source.toLowerCase() as CsvImportRow['source'])
        : 'manual'
      return {
        row: r.row,
        name: r.name,
        phone: r.phone,
        email: r.email,
        source,
        notes: r.notes,
        valid: !error,
        error: error ?? (inFile ? 'Repeated in this file' : null),
        phone_norm: norm,
        is_duplicate: !!norm && (known.has(norm) || inFile),
      }
    })
    return c.json(
      csvImportPreviewResponse.parse({
        columns,
        rows,
        total: rows.length,
        valid: rows.filter((r) => r.valid).length,
        duplicates: rows.filter((r) => r.is_duplicate).length,
      }),
    )
  })

  .post('/imports/commit', requireAction('crm', 'create'), async (c) => {
    const parsed = csvImportCommitRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid import rows.')
    const { rows, skip_duplicates, mode } = parsed.data
    const result = await attempt(c, 'crm.import_commit', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const out = await sql<{ r: unknown }[]>`
          select crm_import_leads(${sql.json(rows)}, ${skip_duplicates}, ${mode}) as r`
        return out[0]?.r ?? null
      }),
    )
    if (!result) fail(400, 'Import failed. Nothing was saved.')
    const summary = csvImportCommitResponse.parse(result)
    await audit(c, { action: 'lead.import', entityType: 'crm_lead', after: { rows: rows.length, mode, ...summary, ids: undefined } })
    return c.json(summary, 201)
  })

  // ── Reports ─────────────────────────────────────────────────
  .get('/stats', async (c) => {
    const range = dateRange(c)
    const rows = await attempt(c, 'crm.stats', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ stats: unknown }[]>`select crm_stats(
          ${range.from}::date, ${range.to}::date,
          ${range.source ?? null}::text, ${range.assignee ?? null}::uuid) as stats`,
      ),
    )
    if (!rows) fail(400, 'Stats failed.')
    const base = crmStats.parse(rows[0]?.stats ?? {})
    // Lovable parity extras: pipeline value, quality split, 5-way
    // follow-up health, activity + won/lost trends, proposal KPI, warnings.
    const extras = await attempt(c, 'crm.stats_extras', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [q] = await sql<{
          pipeline_value: number;
          overdue: number; due_today: number; due_tomorrow: number; upcoming_7d: number; no_follow_up: number;
          proposal_count: number; proposal_value: number;
        }[]>`
          select coalesce(sum(l.deal_value) filter (where l.status not in ('converted', 'lost')), 0) as pipeline_value,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at is not null and l.follow_up_at < now())::int as overdue,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at >= date_trunc('day', now()) and l.follow_up_at < date_trunc('day', now()) + interval '1 day')::int as due_today,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at >= date_trunc('day', now()) + interval '1 day' and l.follow_up_at < date_trunc('day', now()) + interval '2 days')::int as due_tomorrow,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at >= date_trunc('day', now()) + interval '2 days' and l.follow_up_at < date_trunc('day', now()) + interval '8 days')::int as upcoming_7d,
                 count(*) filter (where l.status not in ('converted', 'lost') and l.follow_up_at is null)::int as no_follow_up,
                 count(*) filter (where l.status = 'proposal_sent')::int as proposal_count,
                 coalesce(sum(l.deal_value) filter (where l.status = 'proposal_sent'), 0) as proposal_value
          from crm_leads l
          where l.company_id = get_current_company_id() and l.is_archived = false`
        const qb = await sql<{ quality: string | null; count: number }[]>`
          select l.quality, count(*)::int as count from crm_leads l
          where l.company_id = get_current_company_id() and l.is_archived = false
          group by l.quality`
        const quality_breakdown: Record<string, number> = {}
        for (const r of qb) quality_breakdown[r.quality ?? 'unset'] = r.count
        const trend = await sql<{ day: string; count: number }[]>`
          select to_char(d, 'YYYY-MM-DD') as day, count(a.id)::int as count
          from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') d
          left join crm_activities a on a.created_at::date = d::date
            and a.company_id = get_current_company_id()
          group by d order by d`
        const wl = await sql<{ day: string; won: number; lost: number }[]>`
          select to_char(d, 'YYYY-MM-DD') as day,
                 count(l.id) filter (where l.status = 'converted')::int as won,
                 count(l.id) filter (where l.status = 'lost')::int as lost
          from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') d
          left join crm_leads l on l.company_id = get_current_company_id()
            and coalesce(l.converted_at, l.stage_changed_at, l.updated_at)::date = d::date
          group by d order by d`
        return { q: q ?? null, quality_breakdown, trend, wl }
      }),
    )
    const warnings: string[] = []
    if ((extras?.q?.no_follow_up ?? 0) > 0) warnings.push(`${extras?.q?.no_follow_up} open leads have no follow-up set.`)
    if ((extras?.q?.overdue ?? 0) > 0) warnings.push(`${extras?.q?.overdue} follow-ups are overdue.`)
    if (base.uncontacted > 0) warnings.push(`${base.uncontacted} new leads were never contacted.`)
    return c.json(
      crmStats.parse({
        ...base,
        pipeline_value: extras?.q?.pipeline_value ?? 0,
        quality_breakdown: extras?.quality_breakdown ?? {},
        follow_up_health: {
          overdue: extras?.q?.overdue ?? 0,
          due_today: extras?.q?.due_today ?? 0,
          due_tomorrow: extras?.q?.due_tomorrow ?? 0,
          upcoming_7d: extras?.q?.upcoming_7d ?? 0,
          no_follow_up: extras?.q?.no_follow_up ?? 0,
        },
        activity_trend: extras?.trend ?? [],
        won_lost_trend: extras?.wl ?? [],
        proposal_count: extras?.q?.proposal_count ?? 0,
        proposal_value: extras?.q?.proposal_value ?? 0,
        warnings,
      }),
    )
  })

  .get('/team-stats', async (c) => {
    const range = dateRange(c)
    const rows = await attempt(c, 'crm.team_stats', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select * from crm_team_stats(${range.from}::date, ${range.to}::date)`,
      ),
    )
    if (!rows) fail(400, 'We could not load the team view.')
    const base = crmTeamStatsRow.array().parse(rows)
    // Lovable parity: per-member outreach (whatsapp / messages / notes) +
    // pipeline value + warnings.
    const extra = await attempt(c, 'crm.team_stats_extras', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        return sql<{
          user_id: string; whatsapp: number; messages: number; notes: number; pipeline_value: number;
        }[]>`
          select m.user_id,
                 count(a.id) filter (where a.type = 'whatsapp')::int as whatsapp,
                 count(a.id) filter (where a.type in ('whatsapp', 'sms', 'email'))::int as messages,
                 count(a.id) filter (where a.type = 'note')::int as notes,
                 coalesce(sum(l.deal_value) filter (where l.status not in ('converted', 'lost')), 0) as pipeline_value
          from users m
          left join crm_activities a on a.actor_id = m.user_id
            and a.created_at >= ${range.from}::timestamptz and a.created_at < (${range.to}::date + 1)::timestamptz
          left join crm_leads l on l.assigned_to = m.user_id
            and l.company_id = get_current_company_id() and l.is_archived = false
          where m.company_id = get_current_company_id() and m.deleted_at is null
          group by m.user_id`
      }),
    )
    const byId = new Map((extra ?? []).map((e) => [e.user_id, e]))
    return c.json(
      crmTeamStatsRow.array().parse(
        base.map((r) => {
          const e = byId.get(r.user_id)
          const warn: string[] = []
          if (r.overdue > 0) warn.push(`${r.overdue} overdue follow-ups.`)
          if (r.uncontacted > 0) warn.push(`${r.uncontacted} leads never contacted.`)
          if (r.open > 0 && (e?.messages ?? 0) === 0) warn.push('No outreach logged in range.')
          return {
            ...r,
            whatsapp: e?.whatsapp ?? 0,
            messages: e?.messages ?? 0,
            notes: e?.notes ?? 0,
            pipeline_value: e?.pipeline_value ?? 0,
            warnings: warn,
          }
        }),
      ),
    )
  })

  // ── Templates ───────────────────────────────────────────────
  .get('/templates', async (c) => {
    const includeInactive = c.req.query('include_inactive') === '1'
    const rows = await attempt(c, 'crm.templates', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, name, body, kind, category, usage_count, is_active, created_at
          from crm_templates
          where ${includeInactive ? sql`true` : sql`is_active = true`}
          order by usage_count desc, created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load templates.')
    return c.json(crmTemplate.array().parse(rows))
  })

  .post('/templates', edit, async (c) => {
    const parsed = createTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Check template fields.')
    const { name, body, kind, category } = parsed.data
    const row = await attempt(c, 'crm.template_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql`
          insert into crm_templates (company_id, name, body, kind, category)
          values (get_current_company_id(), ${name}, ${body}, ${kind}, ${category ?? null})
          returning id, name, body, kind, category, usage_count, is_active, created_at`
        return r ?? null
      }),
    )
    if (!row) fail(400, 'Could not create template.')
    const created = crmTemplate.parse(row)
    await audit(c, { action: 'template.create', entityType: 'crm_template', entityId: created.id, after: { name, kind } })
    return c.json(created, 201)
  })

  // A new studio starts with an empty template list and retypes the same
  // WhatsApp message all season. This gives it a starting set; re-running adds
  // only what is missing, so an edited template is never overwritten.
  .post('/templates/seed', edit, async (c) => {
    const n = await attempt(c, 'crm.templates_seed', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ n: number }[]>`
          select seed_crm_message_templates(get_current_company_id()) as n`
        return r?.n ?? 0
      }),
    )
    if (n === null) fail(400, 'We could not add the starter templates.')
    await audit(c, { action: 'template.seed', entityType: 'crm_template', after: { added: n } })
    return c.json({ added: n })
  })

  .patch('/templates/:id', edit, async (c) => {
    const parsed = updateTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Check template fields.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'crm.template_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          update crm_templates set ${sql(parsed.data)} where id = ${id}
          returning id, name, body, kind, category, usage_count, is_active, created_at`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That template was not found.')
    const updated = crmTemplate.parse(row)
    await audit(c, { action: 'template.update', entityType: 'crm_template', entityId: id, after: parsed.data })
    return c.json(updated)
  })

  // Lovable parity: archive keeps the template (and its usage history) without deleting it.
  .post('/templates/:id/archive', edit, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.template_archive', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`update crm_templates set is_active = false where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not archive this template.')
    if (!rows.length) fail(404, 'That template was not found.')
    await audit(c, { action: 'template.archive', entityType: 'crm_template', entityId: id })
    return c.body(null, 204)
  })

  .delete('/templates/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.template_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from crm_templates where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'Delete failed.')
    if (!rows.length) fail(404, 'That template was not found.')
    await audit(c, { action: 'template.delete', entityType: 'crm_template', entityId: id })
    return c.body(null, 204)
  })

  // Render a template for one lead and hand back the link that opens WhatsApp
  // or the mail client with it filled in. The contact is stamped on the lead's
  // history here, because pressing "send" IS the contact.
  .post('/leads/:id/send-template', edit, async (c) => {
    const parsed = sendTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a template and a channel.')
    const leadId = uuidParam(c)
    const { template_id, channel } = parsed.data

    const result = await attempt(c, 'crm.send_template', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [lead] = await sql<{
          name: string | null; phone: string | null; phone_norm: string | null; email: string | null;
          follow_up_at: string | null; city: string | null; group_name: string | null;
          event_type: string | null; event_date: string | null; deal_value: number | null;
          usage_bump: null;
        }[]>`
          select name, phone, phone_norm, email, follow_up_at, city, group_name,
                 event_type, event_date, deal_value
          from crm_leads where id = ${leadId}`
        if (!lead) return 'no_lead' as const
        const [tpl] = await sql<{ id: string; name: string; body: string }[]>`
          select id, name, body from crm_templates where id = ${template_id}`
        if (!tpl) return 'no_template' as const
        const [studio] = await sql<{ name: string }[]>`select name from companies where id = get_current_company_id()`

        const rendered = renderTemplate(tpl.body, {
          ...crmTemplateVars(
            {
              name: lead.name, phone: lead.phone, email: lead.email,
              follow_up_at: lead.follow_up_at, city: lead.city, group_name: lead.group_name,
              event_type: lead.event_type, event_date: lead.event_date, deal_value: lead.deal_value,
            },
            studio?.name ?? '',
          ),
          // Back-compat: the old call only filled these four.
          studio: studio?.name ?? '',
        })
        if (channel === 'whatsapp' && !lead.phone_norm) return 'no_phone' as const
        if (channel === 'email' && !lead.email) return 'no_email' as const
        return { rendered, templateId: tpl.id, templateName: tpl.name, phoneNorm: lead.phone_norm, email: lead.email }
      }),
    )
    if (result === 'no_lead') fail(404, 'That lead was not found.')
    if (result === 'no_template') fail(404, 'That template was not found.')
    if (result === 'no_phone') fail(422, 'This lead has no phone number to message.')
    if (result === 'no_email') fail(422, 'This lead has no email address.')
    if (!result) fail(400, 'We could not prepare the message.')

    // Deliver: through the Cloud API when the studio has it, else hand back a
    // link that opens the person's own WhatsApp or mail app with the text in.
    let url: string | null
    let delivery: 'api' | 'link' = 'link'
    if (channel === 'whatsapp') {
      if (whatsappConfigured(c.env)) {
        const sent = await attempt(c, 'crm.whatsapp_send', () => sendWhatsAppText(c.env, result.phoneNorm!, result.rendered))
        if (!sent) fail(400, 'WhatsApp did not accept the message. Please try again.')
        url = null
        delivery = 'api'
      } else {
        url = whatsappLink(result.phoneNorm!, result.rendered)
      }
    } else {
      url = `mailto:${result.email}?subject=${encodeURIComponent(result.templateName)}&body=${encodeURIComponent(result.rendered)}`
    }

    // Pressing send IS the contact, whichever way it went out.
    await attempt(c, 'crm.send_template_record', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`
          update crm_leads set last_contacted_at = coalesce(last_contacted_at, now()),
                               contacted_status = 'contacted',
                               quality = coalesce(quality, case when is_hot then 'hot'::text else null end)
          where id = ${leadId}`
        await sql`
          update crm_templates set usage_count = usage_count + 1 where id = ${result.templateId}`
        await sql`
          insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
          values (get_current_company_id(), ${leadId}, null, null, ${c.get('auth').userId},
                  ${`sent "${result.templateName}" via ${channel}${delivery === 'api' ? ' (delivered)' : ''}`})`
        // The message itself is an activity on the timeline.
        await sql`
          insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, started_at)
          values (get_current_company_id(), ${leadId}, ${channel}, 'out', ${result.templateName}, ${result.rendered},
                  ${delivery === 'api' ? 'whatsapp' : 'manual'}, now())`
      }),
    )
    await audit(c, { action: 'lead.send_template', entityType: 'crm_lead', entityId: leadId, after: { template_id, channel, delivery } })
    return c.json(sendTemplateResponse.parse({ url, rendered: result.rendered, delivery }))
  })

  // ── Lead → project ──────────────────────────────────────────
  // Winning a lead should leave a project behind, not just a status.
  // Client-only convert (no project): the lead is won and linked to the
  // client; converted_project_id stays null until the project comes later.
  .post('/leads/:id/convert', requireAction('crm', 'edit'), async (c) => {
    const parsed = convertLeadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the project details.')
    const leadId = uuidParam(c)
    const v = parsed.data
    const row = await attempt(
      c,
      'crm.convert',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ client_id: string; project_id: string | null }[]>`
            select * from convert_lead_to_project(
              ${leadId}, ${v.client_id ?? null}, ${sql.json(v.client ?? {})}, ${v.project ? sql.json(v.project) : null}, ${v.quote_id ?? null})`
          return rows[0] ?? null
        }),
      { onCode: (code, err) => (code === '22023' && String((err as { message?: string })?.message ?? '').includes('already') ? ('done' as const) : undefined) },
    )
    if (row === 'done') fail(409, 'This lead has already been converted.')
    if (!row) fail(400, 'We could not convert this lead.')
    await audit(c, { action: 'lead.convert', entityType: 'crm_lead', entityId: leadId, after: { ...row, client_only: !v.project && !v.quote_id } })
    return c.json(convertLeadResponse.parse(row), 201)
  })

  // ── Cadences ────────────────────────────────────────────────
  .get('/cadences', async (c) => {
    const stageFilter = c.req.query('stage_filter') || null
    const rows = await attempt(c, 'crm.cadences', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select ca.id, ca.name, ca.is_active, ca.created_at,
                  ca.description, ca.stage_filter, ca.source_filter,
                  coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'id', s.id, 'step_no', s.step_no, 'day_offset', s.day_offset,
                      'template_id', s.template_id, 'template_name', t.name, 'note', s.note,
                      'recommended_delay_days', s.recommended_delay_days,
                      'next_stage', s.next_stage, 'next_follow_up_days', s.next_follow_up_days) order by s.step_no)
                    from crm_cadence_steps s left join crm_templates t on t.id = s.template_id
                    where s.cadence_id = ca.id
                  ), '[]'::jsonb) as steps,
                  (select count(*) from crm_lead_cadences lc
                    where lc.cadence_id = ca.id and lc.completed_at is null and lc.stopped_at is null)::int as active_leads
           from crm_cadences ca
           where ${stageFilter ? sql`ca.stage_filter = ${stageFilter}` : sql`true`}
           order by ca.created_at`,
      ),
    )
    if (!rows) fail(400, 'We could not load cadences.')
    return c.json(cadence.array().parse(rows))
  })

  .post('/cadences', edit, async (c) => {
    const parsed = createCadenceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the cadence.')
    const v = parsed.data
    const id = await attempt(c, 'crm.cadence_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [ca] = await sql<{ id: string }[]>`
          insert into crm_cadences (company_id, name, description, stage_filter, source_filter)
          values (get_current_company_id(), ${v.name}, ${v.description ?? null}, ${v.stage_filter ?? null}, ${v.source_filter ?? null})
          returning id`
        if (!ca) return null
        for (const [i, step] of v.steps.entries()) {
          await sql`
            insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, template_id, note,
                                           recommended_delay_days, next_stage, next_follow_up_days)
            values (${ca.id}, get_current_company_id(), ${i + 1}, ${step.day_offset}, ${step.template_id ?? null}, ${step.note ?? null},
                    ${step.recommended_delay_days ?? null}, ${step.next_stage ?? null}, ${step.next_follow_up_days ?? null})`
        }
        return ca.id
      }),
    )
    if (!id) fail(400, 'We could not save this cadence.')
    await audit(c, { action: 'cadence.create', entityType: 'crm_cadence', entityId: id, after: { name: v.name, steps: v.steps.length } })
    return c.json(idResponse.parse({ id }), 201)
  })

  .patch('/cadences/:id', edit, async (c) => {
    const parsed = updateCadenceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.cadence_update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update crm_cadences set ${sql(parsed.data)} where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not update this cadence.')
    if (!rows.length) fail(404, 'That cadence was not found.')
    await audit(c, { action: 'cadence.update', entityType: 'crm_cadence', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/cadences/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.cadence_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from crm_cadences where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this cadence.')
    if (!rows.length) fail(404, 'That cadence was not found.')
    await audit(c, { action: 'cadence.delete', entityType: 'crm_cadence', entityId: id })
    return c.body(null, 204)
  })

  .get('/leads/:id/cadence', async (c) => {
    const leadId = uuidParam(c)
    const rows = await attempt(c, 'crm.lead_cadence', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select lc.cadence_id, ca.name as cadence_name, lc.step_no,
                 (select count(*) from crm_cadence_steps s where s.cadence_id = lc.cadence_id)::int as total_steps,
                 lc.next_at, lc.started_at, lc.completed_at, lc.stopped_at
          from crm_lead_cadences lc join crm_cadences ca on ca.id = lc.cadence_id
          where lc.lead_id = ${leadId}`,
      ),
    )
    if (!rows) fail(400, 'We could not load the cadence.')
    return c.json(rows[0] ? leadCadence.parse(rows[0]) : null)
  })

  .post('/leads/:id/cadence', edit, async (c) => {
    const parsed = startCadenceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a cadence.')
    const leadId = uuidParam(c)
    const rows = await attempt(c, 'crm.cadence_start', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ next_at: string }[]>`
        select start_lead_cadence(${leadId}, ${parsed.data.cadence_id}) as next_at`),
    )
    if (!rows) fail(400, 'We could not start the cadence.')
    await audit(c, { action: 'lead.cadence_start', entityType: 'crm_lead', entityId: leadId, after: parsed.data })
    return c.json(cadenceStartResponse.parse({ next_at: rows[0]?.next_at ?? null }))
  })

  .delete('/leads/:id/cadence', edit, async (c) => {
    const leadId = uuidParam(c)
    const rows = await attempt(c, 'crm.cadence_stop', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ ok: boolean }[]>`
        select stop_lead_cadence(${leadId}) as ok`),
    )
    if (!rows) fail(400, 'We could not stop the cadence.')
    if (!rows[0]?.ok) fail(404, 'This lead is not on a cadence.')
    await audit(c, { action: 'lead.cadence_stop', entityType: 'crm_lead', entityId: leadId })
    return c.body(null, 204)
  })

  // Lovable parity: Mark-as-Sent — the step went out (by hand or on a call),
  // so log the activity, stamp the contact, move the follow-up and the stage.
  .post('/leads/:id/cadence/sent', edit, async (c) => {
    const parsed = markCadenceSentRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid mark-as-sent.')
    const leadId = uuidParam(c)
    const { next_follow_up_days, next_stage_id, note } = parsed.data
    const followUpAt =
      next_follow_up_days === null || next_follow_up_days === undefined
        ? null
        : new Date(Date.now() + next_follow_up_days * 86_400_000).toISOString()
    const ok = await attempt(c, 'crm.cadence_sent', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [lead] = await sql<{ id: string; name: string | null }[]>`
          select id, name from crm_leads where id = ${leadId}`
        if (!lead) return 'no_lead' as const
        if (next_stage_id) {
          const [stage] = await sql<{ id: string }[]>`
            select id from crm_pipeline_stages where id = ${next_stage_id}`
          if (!stage) return 'no_stage' as const
        }
        await sql`
          update crm_leads
             set last_contacted_at = coalesce(last_contacted_at, now()),
                 contacted_status = 'contacted',
                 follow_up_at = coalesce(${followUpAt}::timestamptz, follow_up_at)
           where id = ${leadId}`
        if (next_stage_id) {
          await sql`select crm_move_stage(${leadId}, ${next_stage_id})`
        }
        await sql`
          insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, started_at)
          values (get_current_company_id(), ${leadId}, 'note', 'out',
                  'Marked as sent', ${note ?? 'Cadence step marked as sent.'}, 'manual', now())`
        await sql`
          insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
          values (get_current_company_id(), ${leadId}, null, null, ${c.get('auth').userId},
                  ${`marked cadence step as sent${note ? `: ${note}` : ''}`})`
        return true
      }),
    )
    if (ok === 'no_lead') fail(404, 'That lead was not found.')
    if (ok === 'no_stage') fail(422, 'That stage was not found.')
    if (!ok) fail(400, 'We could not record that send.')
    await audit(c, { action: 'lead.cadence_sent', entityType: 'crm_lead', entityId: leadId, after: parsed.data })
    return c.body(null, 204)
  })

  // ── Saved views: mine, plus the ones shared with the studio ─
  // A private view is anyone's to keep; publishing one to the team is an
  // edit on the shared workspace and is gated like one. RLS lets only the
  // creator or the owner change or remove a view.
  .get('/views', async (c) => {
    const rows = await attempt(c, 'crm.views', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select v.id, v.name, v.query, v.visibility, v.user_id, u.name as owner_name, v.created_at
        from crm_saved_views v
        left join users u on u.user_id = v.user_id
        order by (v.visibility = 'private') desc, v.created_at`),
    )
    if (!rows) fail(400, 'We could not load your views.')
    return c.json(savedView.array().parse(rows))
  })

  .post('/views', async (c) => {
    const parsed = createSavedViewRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Name the view.')
    const auth = c.get('auth')
    const v = parsed.data
    if (v.visibility !== 'private' && !auth.access.hasAction('crm', 'edit')) fail(403, 'You cannot publish views to the team.')
    const row = await attempt(
      c,
      'crm.view_save',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const [existing] = await sql<{ id: string }[]>`
            select id from crm_saved_views
            where name = ${v.name} and ((${v.visibility} = 'private' and user_id = ${auth.userId} and visibility = 'private')
                                       or (${v.visibility} <> 'private' and visibility <> 'private'))`
          const rows = existing
            ? await sql`
                update crm_saved_views set query = ${sql.json(v.query)}, visibility = ${v.visibility}
                where id = ${existing.id}
                returning id, name, query, visibility, user_id, created_at`
            : await sql`
                insert into crm_saved_views (company_id, user_id, created_by, name, query, visibility)
                values (get_current_company_id(), ${auth.userId}, ${auth.userId}, ${v.name}, ${sql.json(v.query)}, ${v.visibility})
                returning id, name, query, visibility, user_id, created_at`
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '23505' ? ('taken' as const) : undefined) },
    )
    if (row === 'taken') fail(409, 'A shared view with that name already exists.')
    if (!row) fail(400, 'We could not save this view.')
    const saved = savedView.parse({ ...row, owner_name: null })
    await audit(c, { action: 'view.save', entityType: 'crm_saved_view', entityId: saved.id, after: { name: v.name, visibility: v.visibility } })
    return c.json(saved, 201)
  })

  .patch('/views/:id', async (c) => {
    const parsed = updateSavedViewRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const auth = c.get('auth')
    const v = parsed.data
    if (v.visibility && v.visibility !== 'private' && !auth.access.hasAction('crm', 'edit')) fail(403, 'You cannot publish views to the team.')
    const rows = await attempt(
      c,
      'crm.view_update',
      () =>
        withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`
          update crm_saved_views set ${sql({ ...v, ...(v.query ? { query: sql.json(v.query) } : {}) })} where id = ${id} returning id`),
      { onCode: (code) => (code === '23505' ? ('taken' as const) : undefined) },
    )
    if (rows === 'taken') fail(409, 'A view with that name already exists.')
    if (!rows) fail(400, 'We could not update this view.')
    if (!rows.length) fail(404, 'That view was not found, or it is not yours to change.')
    await audit(c, { action: 'view.update', entityType: 'crm_saved_view', entityId: id, after: v })
    return c.body(null, 204)
  })

  .delete('/views/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.view_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from crm_saved_views where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this view.')
    if (!rows.length) fail(404, 'That view was not found, or it is not yours to remove.')
    await audit(c, { action: 'view.delete', entityType: 'crm_saved_view', entityId: id })
    return c.body(null, 204)
  })

  // ── Settings ────────────────────────────────────────────────
  .get('/settings', async (c) => {
    const rows = await attempt(c, 'crm.settings', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ sla_hours: number; hot_score: number }[]>`
        select crm_sla_hours() as sla_hours,
               coalesce((select s.hot_score from crm_settings s where s.company_id = get_current_company_id()), 60) as hot_score`),
    )
    if (!rows) fail(400, 'We could not load CRM settings.')
    return c.json(crmSettings.parse(rows[0] ?? { sla_hours: 24, hot_score: 60 }))
  })

  .patch('/settings', edit, async (c) => {
    const parsed = updateCrmSettingsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'The SLA must be between 1 and 720 hours, the hot score between 1 and 1000.')
    if (parsed.data.sla_hours === undefined && parsed.data.hot_score === undefined) return c.body(null, 204)
    const auth = c.get('auth')
    if (!auth.isOwner) fail(403, 'Only the studio owner can change CRM settings.')
    const { sla_hours: sla, hot_score: hot } = parsed.data
    // crm_set_sla_hours() also moves sla_due_at on every lead still waiting,
    // so a tighter target shows up on the board the same minute.
    const row = await attempt(c, 'crm.settings_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (sla !== undefined) await sql`select crm_set_sla_hours(${sla})`
        if (hot !== undefined) {
          await sql`
            insert into crm_settings (company_id, hot_score) values (get_current_company_id(), ${hot})
            on conflict (company_id) do update set hot_score = excluded.hot_score`
        }
        const rows = await sql<{ sla_hours: number; hot_score: number }[]>`
          select crm_sla_hours() as sla_hours,
                 coalesce((select s.hot_score from crm_settings s where s.company_id = get_current_company_id()), 60) as hot_score`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save CRM settings.')
    await audit(c, { action: 'crm.settings_update', entityType: 'crm_settings', entityId: auth.companyId, after: parsed.data })
    return c.json(crmSettings.parse(row))
  })

  // ── Distribution rota ───────────────────────────────────────
  // The rota new leads are shared out on, with what each person is carrying.
  .get('/distribution', async (c) => {
    const rows = await attempt(c, 'crm.distribution', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select r.id, r.user_id, r.priority, r.is_active, u.name as user_name,
                  r.name, r.source_filter, r.strategy, r.last_assigned_at, r.assigned_count,
                  (
                    select count(*) from crm_leads l
                    where l.assigned_to = r.user_id and l.status not in ('converted', 'lost') and l.is_archived = false
                  )::int as lead_count
           from crm_distribution_rules r
           left join users u on u.user_id = r.user_id
           order by r.is_active desc, r.priority, u.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load the distribution rota.')
    return c.json(distributionRule.array().parse(rows))
  })

  .post('/distribution', edit, async (c) => {
    const parsed = createDistributionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a team member.')
    const { user_id, priority, name, source_filter, strategy } = parsed.data
    const row = await attempt(
      c,
      'crm.distribution_add',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [exists] = await sql<{ id: string }[]>`
            select id from crm_distribution_rules where user_id = ${user_id}`
          if (exists) return 'exists' as const
          const [r] = await sql<{ id: string }[]>`
            insert into crm_distribution_rules (company_id, user_id, priority, name, source_filter, strategy)
            select get_current_company_id(), ${user_id}, ${priority}, ${name ?? null},
                   ${sql.array(source_filter ?? [])}::text[], ${strategy}
            where exists (select 1 from users where user_id = ${user_id} and deleted_at is null)
            returning id`
          return r ?? null
        }),
    )
    if (row === 'exists') fail(409, 'They are already on the rota.')
    if (!row) fail(404, 'We could not find that team member.')
    await audit(c, { action: 'distribution.add', entityType: 'crm_distribution_rule', entityId: row.id, after: parsed.data })
    return c.json(idResponse.parse({ id: row.id }), 201)
  })

  .patch('/distribution/:id', edit, async (c) => {
    const parsed = updateDistributionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid distribution patch.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const { source_filter, ...rest } = parsed.data
    const rows = await attempt(c, 'crm.distribution_update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update crm_distribution_rules
             set ${sql({ ...rest, ...(source_filter ? { source_filter: sql.array(source_filter) } : {}) })}
           where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update the rota.')
    if (!rows.length) fail(404, 'Not found.')
    await audit(c, { action: 'distribution.update', entityType: 'crm_distribution_rule', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/distribution/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.distribution_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from crm_distribution_rules where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not remove them from the rota.')
    if (!rows.length) fail(404, 'Not found.')
    await audit(c, { action: 'distribution.remove', entityType: 'crm_distribution_rule', entityId: id })
    return c.body(null, 204)
  })

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
        const [lead] = await sql<{ id: string }[]>`select capture_lead(${src.source_key}, ${t.name ?? null}, ${t.phone}, ${t.email ?? null}) as id`
        if (!lead) return null
        const [imp] = await sql`
          insert into fb_lead_imports (company_id, source_id, page_id, page_name, name, phone, email, status, lead_id)
          values (get_current_company_id(), ${sourceId}, ${t.page_id ?? null}, ${t.page_name ?? null},
                  ${t.name ?? null}, ${t.phone}, ${t.email ?? null}, 'imported', ${lead.id})
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
        // A Facebook lead with no phone can never become a lead — capture_lead
        // needs one. Saying "not found" sends the studio hunting for a row
        // that is right there on the screen; say what is actually wrong.
        if (!imp.phone) return 'no-phone' as const
        const [src] = await sql<{ source_key: string }[]>`
          select source_key from crm_webhook_sources where id = ${sourceId}`
        if (!src) return null
        const [lead] = await sql<{ id: string }[]>`select capture_lead(${src.source_key}, ${imp.name}, ${imp.phone}, ${imp.email}) as id`
        if (!lead) return null
        const [out] = await sql`
          update fb_lead_imports set status = 'imported', error = null, lead_id = ${lead.id}
          where id = ${importId}
          returning id, source_id, page_id, page_name, leadgen_id, name, phone, email, status, error, lead_id, created_at`
        return out ?? null
      }),
    )
    if (row === 'no-phone') fail(422, 'That lead arrived without a phone number, so it cannot be imported.')
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

  // Pipelines, stages, contacts, companies, lost reasons, forecast.
  .route('/', crmObjectsRouter)
  // Activities, timeline, calls, meetings, mailbox sync, integrations.
  .route('/', crmActivitiesRouter)
  // Workflows, enrollments, scoring.
  .route('/', crmWorkflowsRouter)
  // Quotes and per-person preferences.
  .route('/', crmQuotesRouter)
