import type { TransactionSql } from 'postgres'
import type { Env } from '../context'
import type { ReplyActivity, ReplyLead, ReplyStudio } from './lead-writer'
import { loadStudioBrand } from './studio-brand'
import { open } from './secret-box'
import { sendWhatsAppText } from './whatsapp'

/**
 * What "Reply with AI" reads about one lead, and how a written reply is kept
 * and sent. The same for the CRM (RLS) and for a team member's own lead
 * (service, checked by owner): the caller decides which `sql` and passes
 * `assignedTo` for the staff side.
 */
export interface ReplyData {
  lead: ReplyLead
  studio: ReplyStudio
  acts: ReplyActivity[]
  phoneNorm: string | null
  canDirect: boolean
}

export async function loadReplyData(
  sql: TransactionSql,
  companyId: string,
  leadId: string,
  opts: { assignedTo?: string; dateStatus?: boolean } = {},
): Promise<ReplyData | null> {
  const [l] = await sql<
    (ReplyLead & { phone_norm: string | null })[]
  >`
    select l.name, l.status, s.name as stage_name, l.event_type, l.event_date, l.city, l.deal_value,
           l.source, l.phone_norm, l.enquiry_occasion, l.enquiry_answers, l.notes,
           (select pt.name from enquiry_partners pt where pt.id = l.partner_id) as partner_name,
           coalesce((select jsonb_agg(jsonb_build_object('event_type', f.event_type, 'event_date', f.event_date,
                                                         'location', f.location, 'guests', f.guests)
                                      order by f.event_date nulls last)
                       from crm_lead_functions f where f.lead_id = l.id), '[]'::jsonb) as functions
      from crm_leads l
      left join crm_pipeline_stages s on s.id = l.stage_id
     where l.id = ${leadId} and l.company_id = ${companyId}
       ${opts.assignedTo ? sql`and l.assigned_to = ${opts.assignedTo}` : sql``}`
  if (!l) return null

  let date_status: string | null = null
  if (opts.dateStatus && l.event_date) {
    const [av] = await sql<{ status: string }[]>`
      select status from crm_date_availability() where on_date = ${l.event_date}`
    date_status = av?.status ?? null
  }

  const acts = await sql<ReplyActivity[]>`
    select a.type, a.direction, a.subject, a.body,
           to_char(coalesce(a.started_at, a.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
      from crm_activities a
     where a.lead_id = ${leadId} and a.type in ('whatsapp', 'note', 'call', 'email', 'sms', 'meeting')
     order by coalesce(a.started_at, a.created_at) desc
     limit 12`

  const brand = await loadStudioBrand(sql, companyId)
  const [co] = await sql<{ phone: string | null }[]>`
    select nullif(trim(invoice_phone), '') as phone from companies where id = ${companyId}`
  const packages = await sql<{ name: string; rate: number }[]>`
    select name, rate::float8 as rate from invoice_item_presets
     where company_id = ${companyId} and rate > 0
     order by rate desc limit 8`
  const [can] = await sql<{ ok: boolean }[]>`
    select crm_whatsapp_can_send(${companyId}::uuid, ${leadId}::uuid, false) as ok`

  return {
    lead: { ...l, date_status },
    studio: { name: brand.name, website: brand.website, phone: co?.phone ?? null, packages },
    acts,
    phoneNorm: l.phone_norm,
    canDirect: !!can?.ok && !!l.phone_norm,
  }
}

/** A reply that went out: on the timeline, and the lead counts as contacted. */
export async function recordReply(
  sql: TransactionSql,
  companyId: string,
  leadId: string,
  actorId: string,
  text: string,
  provider: 'manual' | 'whatsapp',
): Promise<void> {
  await sql`
    update crm_leads set last_contacted_at = coalesce(last_contacted_at, now()),
                         contacted_status = 'contacted'
     where id = ${leadId} and company_id = ${companyId}`
  await sql`
    insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, started_at, actor_id)
    values (${companyId}, ${leadId}, 'whatsapp', 'out', 'Reply written with AI', ${text}, ${provider}, now(), ${actorId})`
}

/**
 * Send from the studio's own WhatsApp number, only while WhatsApp allows a
 * free message (the client wrote in the last 24 hours) -- the same rule the
 * sequence sender follows.
 */
export async function sendFromStudioNumber(
  env: Env,
  sql: TransactionSql,
  companyId: string,
  leadId: string,
  phoneNorm: string,
  text: string,
): Promise<'sent' | 'closed' | 'not_connected'> {
  const [can] = await sql<{ ok: boolean }[]>`select crm_whatsapp_can_send(${companyId}::uuid, ${leadId}::uuid, false) as ok`
  if (!can?.ok) return 'closed'
  const [conn] = await sql<{ phone_number_id: string; access_token_enc: string }[]>`
    select phone_number_id, access_token_enc from company_whatsapp where company_id = ${companyId}`
  if (!conn) return 'not_connected'
  const number = { WHATSAPP_PHONE_NUMBER_ID: conn.phone_number_id, WHATSAPP_ACCESS_TOKEN: await open(env, conn.access_token_enc) }
  await sendWhatsAppText(number, phoneNorm, text)
  return 'sent'
}
