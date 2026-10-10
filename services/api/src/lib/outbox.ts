import type { TransactionSql } from 'postgres'
import { renderTemplate } from '@ipc/domain'
import type { Env } from '../context'
import { sendWhatsAppText, whatsappConfigured } from './whatsapp'
import { describeError, log } from './log'

interface OutboxSummary {
  claimed: number
  sent: number
  manual: number
  failed: number
}

interface OutboxRow {
  id: string
  company_id: string
  lead_id: string
  template_id: string
  channel: 'whatsapp' | 'email'
}

/**
 * Deliver what workflows queued (crm_outbox). Runs as the service on the
 * hourly tick. A WhatsApp message goes out through the Cloud API when the
 * deployment has it; anything else becomes a task for the deal's owner —
 * "Send 'Welcome' via email" — so nothing is silently dropped and nothing is
 * pretended sent.
 */
export async function drainOutbox(env: Env, sql: TransactionSql): Promise<OutboxSummary> {
  const rows = await sql<OutboxRow[]>`select * from crm_outbox_claim(100)`
  const out: OutboxSummary = { claimed: rows.length, sent: 0, manual: 0, failed: 0 }
  for (const row of rows) {
    try {
      const [ctx] = await sql<
        { name: string | null; phone: string | null; phone_norm: string | null; email: string | null; assigned_to: string | null; tpl_name: string; body: string; studio: string }[]
      >`
        select l.name, l.phone, l.phone_norm, l.email, l.assigned_to, t.name as tpl_name, t.body, co.name as studio
        from crm_outbox o
        join crm_leads l on l.id = o.lead_id
        join crm_templates t on t.id = o.template_id
        join companies co on co.id = o.company_id
        where o.id = ${row.id}`
      if (!ctx) {
        await sql`update crm_outbox set status = 'failed', error = 'lead or template gone' where id = ${row.id}`
        out.failed += 1
        continue
      }
      const rendered = renderTemplate(ctx.body, { name: ctx.name ?? '', phone: ctx.phone ?? '', email: ctx.email ?? '', studio: ctx.studio })
      if (row.channel === 'whatsapp' && whatsappConfigured(env) && ctx.phone_norm) {
        const sent = await sendWhatsAppText(env, ctx.phone_norm, rendered)
        await sql`
          insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, external_id, started_at)
          values (${row.company_id}, ${row.lead_id}, 'whatsapp', 'out', ${ctx.tpl_name}, ${rendered}, 'whatsapp', ${sent.message_id || null}, now())`
        await sql`update crm_outbox set status = 'sent', sent_at = now() where id = ${row.id}`
        out.sent += 1
      } else {
        await sql`
          insert into crm_activities (company_id, lead_id, type, subject, body, due_at, assigned_to)
          values (${row.company_id}, ${row.lead_id}, 'task', ${`Send "${ctx.tpl_name}" via ${row.channel}`}, ${rendered}, now(), ${ctx.assigned_to})`
        await sql`update crm_outbox set status = 'manual', sent_at = now() where id = ${row.id}`
        out.manual += 1
      }
    } catch (err) {
      const d = describeError(err)
      log.error({ outboxId: row.id, code: d.code, message: d.message }, 'outbox delivery failed')
      await sql`update crm_outbox set status = 'failed', error = ${d.message.slice(0, 300)} where id = ${row.id}`
      out.failed += 1
    }
  }
  return out
}
