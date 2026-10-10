import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  createLeadRequest,
  createLeadResponse,
  crmLead,
  leadsQuery,
  normalizePhone,
  updateLeadRequest,
  type LeadFunctionInput,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { edit } from './shared'

const list = crmLead.array()

/** The one projection every lead read uses, so the wire shape cannot drift. */
const selectLead = (sql: TransactionSql) => sql`
  select l.id, l.name, l.phone, l.email, l.source, l.status, l.assigned_to, l.notes,
         l.follow_up_at, l.last_contacted_at, l.converted_at, l.is_hot, l.is_archived,
         l.merged_into, l.converted_project_id, l.converted_client_id, l.deal_value, l.probability, l.lost_reason, l.lost_competitor,
         l.sla_due_at, l.pipeline_id, l.stage_id, s.name as stage_name, l.contact_id, l.crm_company_id,
         co.name as crm_company_name, l.title, l.close_date, l.currency, l.score, l.created_at,
         l.event_type, l.event_date, l.event_location, l.alternate_phone, l.city, l.group_name,
         l.quality, l.contacted_status, l.archive_reason,
         u.name as assignee_name,
         arch.name as archived_by_name,
         -- The booked project's name, for "Booked — project X" on the lead.
         (select p.name from projects p where p.id = l.converted_project_id) as converted_project_name,
         -- Which lead source (a vendor's QR, say) brought this lead in.
         (select ws.label from crm_webhook_sources ws where ws.source_key = l.source_key) as source_label,
         -- Is the studio free on this lead's date? Derived in one pass by
         -- 0193 rather than per row, and joined here so the list and the
         -- single-lead read can never disagree about it.
         coalesce(av.status, 'unknown') as date_status,
         coalesce(av.wanted_by, 0)::int as date_wanted_by,
         -- Tags as one aggregate rather than a join, so a lead with four tags
         -- stays one row and the list does not quietly multiply (0197).
         coalesce((
           select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
                            order by lower(t.name))
             from crm_lead_tags lt
             join crm_tags t on t.id = lt.tag_id
            where lt.lead_id = l.id
         ), '[]'::jsonb) as tags,
         -- Every function the lead is asking for, earliest first (0212).
         coalesce((
           select jsonb_agg(jsonb_build_object('id', f.id, 'event_type', f.event_type,
                                               'event_date', f.event_date, 'location', f.location,
                                               'guests', f.guests)
                            order by f.event_date nulls last, f.sort, f.created_at)
             from crm_lead_functions f
            where f.lead_id = l.id
         ), '[]'::jsonb) as functions
  from crm_leads l
  left join users u on u.user_id = l.assigned_to
  left join users arch on arch.user_id = l.archived_by
  left join crm_pipeline_stages s on s.id = l.stage_id
  left join crm_companies co on co.id = l.crm_company_id
  left join crm_date_availability() av on av.on_date = l.event_date`

/**
 * Replace a lead's list of functions (0212). The trigger on the table keeps
 * the lead's own event_type / event_date / event_location equal to the first.
 */
async function writeFunctions(sql: TransactionSql, leadId: string, list: readonly LeadFunctionInput[]) {
  await sql`delete from crm_lead_functions where lead_id = ${leadId}`
  for (const [i, f] of list.entries()) {
    await sql`
      insert into crm_lead_functions (company_id, lead_id, event_type, event_date, location, guests, sort)
      select l.company_id, l.id, ${f.event_type?.trim() || null}, ${f.event_date ?? null},
             ${f.location?.trim() || null}, ${f.guests ?? null}, ${i}
        from crm_leads l where l.id = ${leadId}`
  }
}

export const crmLeadRoutes = new Hono<AppEnv>()
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
      tag_id: c.req.query('tag_id'),
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
            and ${v.tag_id ? sql`exists (select 1 from crm_lead_tags lt where lt.lead_id = l.id and lt.tag_id = ${v.tag_id})` : sql`true`}
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
    const norm = v.phone ? normalizePhone(v.phone) : null
    const row = await attempt(c, 'crm.lead_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [known] = norm
          ? await sql<{ id: string }[]>`select id from crm_leads where phone_norm = ${norm} limit 1`
          : []
        const [created] = await sql<{ id: string }[]>`
          select add_lead(
            ${v.name ?? null}, ${v.phone ?? null}, ${v.email ?? null},
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
        // A lead that was already known keeps its own functions and labels;
        // only a fresh one takes what this form sent.
        if (!known && v.functions?.length) await writeFunctions(sql, id, v.functions)
        if (!known && v.tag_ids?.length) await sql`select crm_set_lead_tags(${id}, ${sql.array(v.tag_ids)}::uuid[])`
        const [lead] = await sql`${selectLead(sql)} where l.id = ${id}`
        return lead ? { lead, created: !known } : null
      }),
    )
    if (!row) fail(400, 'We could not add this lead.')
    const body = createLeadResponse.parse(row)
    if (body.created) {
      await audit(c, { action: 'lead.create', entityType: 'crm_lead', entityId: body.lead.id, after: { phone: v.phone ?? null, source: v.source } })
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
    const { functions, ...rest } = parsed.data
    // The list wins: the three event columns follow its first row by trigger.
    const patch = functions
      ? Object.fromEntries(
          Object.entries(rest).filter(([k]) => !['event_type', 'event_date', 'event_location'].includes(k)),
        )
      : rest
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
        const cols = { ...patch, ...stamps }
        if (Object.keys(cols).length) await sql`update crm_leads set ${sql(cols)} where id = ${id}`
        if (functions) await writeFunctions(sql, id, functions)
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
