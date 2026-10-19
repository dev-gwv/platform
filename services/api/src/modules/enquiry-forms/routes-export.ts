import { Hono } from 'hono'
import { leadsExportQuery, leadsExportResponse } from '@ipc/contracts'
import { CSV_TYPE, XLSX_TYPE, leadsCsv, leadsFileName, leadsXlsx, type LeadExportRow } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { todayInIndia } from '../../lib/dates'

/**
 * Leads as Excel or CSV (0270; spec 3.12): one partner's, the main form's
 * own, every partner's, or whatever the Leads list shows. CRM Export is the
 * gate (a sensitive module the owner grants), and what a person can read is
 * still what the database lets them read.
 */
const MAX_ROWS = 20000

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

export const leadsExportRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('crm'))
  .use('*', requireModule('crm_export'))

  .get('/', async (c) => {
    const parsed = leadsExportQuery.safeParse(c.req.query())
    if (!parsed.success) fail(400, 'Pick Excel or CSV.')
    const { format, partner_id: partnerId, from, source, q } = parsed.data
    const auth = c.get('auth')
    const out = await attempt(c, 'leads.export', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [main] = await sql<{ source_key: string | null }[]>`
          select s.source_key from enquiry_forms f join crm_webhook_sources s on s.id = f.source_id
           where f.company_id = get_current_company_id() and f.is_main`
        const [names] = await sql<{ studio: string; partner: string | null }[]>`
          select c.name as studio, (select p.name from enquiry_partners p where p.id = ${partnerId ?? null}) as partner
            from companies c where c.id = get_current_company_id()`
        const like = q ? `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null
        const rows = await sql<LeadExportRow[]>`
          select l.created_at, l.name, l.phone, l.email, l.event_type, l.event_date::text as event_date, l.city,
                 l.event_location as venue,
                 (select f.guests from crm_lead_functions f where f.lead_id = l.id order by f.sort, f.created_at limit 1) as guests,
                 l.deal_value::float8 as budget, l.notes as said,
                 case when l.partner_id is not null then 'Partner QR'
                      when l.source = 'enquiry' then 'Enquiry form'
                      else initcap(replace(coalesce(l.source, ''), '_', ' ')) end as came_from,
                 p.name as partner, coalesce(st.name, initcap(replace(l.status, '_', ' '))) as stage,
                 u.name as handled_by, l.follow_up_at
            from crm_leads l
            left join enquiry_partners p on p.id = l.partner_id
            left join crm_pipeline_stages st on st.id = l.stage_id
            left join users u on u.user_id = l.assigned_to and u.company_id = l.company_id
           where l.merged_into is null
             and coalesce(l.is_archived, false) = false
             and (${partnerId ?? null}::uuid is null or l.partner_id = ${partnerId ?? null}::uuid)
             and (${from ?? null}::text is null
                  or (${from ?? null} = 'partner' and l.partner_id is not null)
                  or (${from ?? null} = 'form' and l.partner_id is null and l.source_key = ${main?.source_key ?? ''}))
             and (${source ?? null}::text is null or l.source = ${source ?? null})
             and (${like}::text is null or l.name ilike ${like} or l.phone ilike ${like} or l.email ilike ${like})
           order by l.created_at desc
           limit ${MAX_ROWS}`
        return { rows, studio: names?.studio ?? 'studio', partner: names?.partner ?? null }
      }),
    )
    if (!out) fail(400, 'We could not make the file. Please try again.')
    const part = out.partner ?? (from === 'partner' ? 'partners' : from === 'form' ? 'enquiry-form' : source ?? null)
    const filename = leadsFileName(out.studio, part, todayInIndia(), format)
    const data = format === 'xlsx' ? toBase64(leadsXlsx(out.rows)) : Buffer.from(leadsCsv(out.rows), 'utf8').toString('base64')
    await audit(c, { action: 'leads.export', entityType: 'crm_lead', after: { format, rows: out.rows.length, partner_id: partnerId, from, source } })
    c.header('Cache-Control', 'no-store')
    return c.json(
      leadsExportResponse.parse({ filename, content_type: format === 'xlsx' ? XLSX_TYPE : CSV_TYPE, data, rows: out.rows.length }),
    )
  })
