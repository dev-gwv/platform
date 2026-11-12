import type { LeadOutcome } from '@ipc/contracts'

/**
 * The Leads page's slim reads, as plain SQL text so a database test runs the
 * very same statements the route does (supabase/tests/crm-lead-reads.test.ts).
 *
 * Nothing here takes a value from the request: the route adds its filters with
 * bound parameters, and these strings are fixed.
 */

/**
 * Open is "not booked and not lost", exactly `isOpen` in
 * apps/web/src/features/crm/leads.ts. A lead's status follows its stage's kind
 * (won -> converted, lost -> lost), so the status is the one place to ask.
 */
export function outcomeWhere(outcome: LeadOutcome | undefined): string {
  if (outcome === 'open') return `l.status not in ('converted', 'lost')`
  if (outcome === 'won') return `l.status = 'converted'`
  if (outcome === 'lost') return `l.status = 'lost'`
  return 'true'
}

/**
 * What a card, a row and a filter read (`crmLeadCard`), and nothing else.
 * crm_date_availability() is one set-returning call in FROM, so it is worked
 * out once for the whole list, not once per lead.
 */
export const CARD_SELECT = `
  select l.id, l.name, l.title, l.phone, l.email, l.source, ws.label as source_label, l.status,
         l.pipeline_id, l.stage_id, s.name as stage_name, l.quality, l.is_hot, l.score, l.probability,
         l.deal_value, l.event_type, l.event_date, l.city,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', f.id, 'event_type', f.event_type,
                                               'event_date', f.event_date, 'location', f.location,
                                               'guests', f.guests)
                            order by f.event_date nulls last, f.sort, f.created_at)
             from crm_lead_functions f
            where f.lead_id = l.id
         ), '[]'::jsonb) as functions,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
                            order by lower(t.name))
             from crm_lead_tags lt
             join crm_tags t on t.id = lt.tag_id
            where lt.lead_id = l.id
         ), '[]'::jsonb) as tags,
         l.partner_id, pt.name as partner_name, pt.kind as partner_kind,
         l.assigned_to, u.name as assignee_name,
         l.follow_up_at, l.last_contacted_at, l.converted_at, l.contacted_status, l.created_at,
         l.close_date, co.name as crm_company_name,
         coalesce(av.status, 'unknown') as date_status,
         coalesce(av.wanted_by, 0)::int as date_wanted_by,
         l.is_archived, left(l.lost_reason, 140) as lost_reason, left(l.notes, 140) as notes_preview
    from crm_leads l
    left join users u on u.user_id = l.assigned_to
    left join crm_pipeline_stages s on s.id = l.stage_id
    left join crm_companies co on co.id = l.crm_company_id
    left join enquiry_partners pt on pt.id = l.partner_id
    left join crm_webhook_sources ws on ws.source_key = l.source_key
    left join crm_date_availability() av on av.on_date = l.event_date`

/**
 * The pipeline's columns for open, live leads: per stage how many and how
 * much, the pipeline's total, and how many nobody has rung yet. `$1` is the
 * pipeline (null = the default); a lead with no pipeline sits in the default
 * one, as PipelineTab draws it.
 */
export const SUMMARY_SQL = `
  with pipe as (
    select coalesce($1::uuid, d.id) as id, d.id as default_id
      from (select (select p.id from crm_pipelines p where p.is_default limit 1) as id) d
  ), open_leads as (
    select l.stage_id, l.deal_value
      from crm_leads l, pipe
     where l.is_archived = false
       and l.status not in ('converted', 'lost')
       and (l.pipeline_id = pipe.id or (l.pipeline_id is null and pipe.id = pipe.default_id))
  )
  select coalesce((
           select jsonb_agg(jsonb_build_object('stage_id', g.stage_id, 'count', g.n, 'value', g.v))
             from (select stage_id, count(*)::int as n, coalesce(sum(deal_value), 0)::float8 as v
                     from open_leads group by stage_id) g
         ), '[]'::jsonb) as stages,
         (select count(*)::int from open_leads) as open_total,
         (select coalesce(sum(deal_value), 0)::float8 from open_leads) as open_value,
         (select count(*)::int from crm_leads l
           where l.is_archived = false and l.status = 'new' and l.last_contacted_at is null) as not_contacted`
