import { renderTemplate } from '@ipc/domain'
import type { Env } from '../context'
import { sendWhatsAppText, whatsappConfigured } from './whatsapp'
import { describeError, log } from './log'
import { withService } from './db'

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

interface OutboxContext {
  name: string | null
  phone: string | null
  phone_norm: string | null
  email: string | null
  assigned_to: string | null
  tpl_name: string
  body: string
  studio: string
}

/** Left on a row while it is being sent; if it stays, the send was cut off. */
const INTERRUPTED = 'Interrupted while sending: not retried, so it can never go twice. Check the chat before sending again.'

/**
 * Deliver what workflows queued (crm_outbox). Runs as the service on the
 * hourly tick. A WhatsApp message goes out through the Cloud API when the
 * deployment has it; anything else becomes a task for the deal's owner —
 * "Send 'Welcome' via email" — so nothing is silently dropped and nothing is
 * pretended sent.
 *
 * Claim, then commit, per message (the way sequence-sender does it): each row
 * is taken out of 'pending' in a transaction of its own BEFORE the message
 * goes, and its result is written in another one after. It used to run inside
 * the hourly job's single transaction, so a failure later in the hour rolled
 * the 'sent' marks back and the next tick sent the same WhatsApp again. Now a
 * crash between sending and recording leaves the row 'failed' with
 * INTERRUPTED (visible, never resent) — a missed message, never a doubled one.
 * The table allows no 'sending' status, so 'failed' carries that meaning.
 */
export async function drainOutbox(env: Env): Promise<OutboxSummary> {
  const rows = await withService(env, (sql) => sql<OutboxRow[]>`select * from crm_outbox_claim(100)`)
  const out: OutboxSummary = { claimed: rows.length, sent: 0, manual: 0, failed: 0 }
  for (const row of rows) {
    try {
      // Claim: only one tick can move a row out of 'pending'.
      const claimed = await withService(env, async (sql) => {
        const [mine] = await sql<{ id: string }[]>`
          update crm_outbox set status = 'failed', error = ${INTERRUPTED}
          where id = ${row.id} and status = 'pending'
          returning id`
        if (!mine) return { state: 'taken' as const }
        const [ctx] = await sql<OutboxContext[]>`
          select l.name, l.phone, l.phone_norm, l.email, l.assigned_to, t.name as tpl_name, t.body, co.name as studio
          from crm_outbox o
          join crm_leads l on l.id = o.lead_id
          join crm_templates t on t.id = o.template_id
          join companies co on co.id = o.company_id
          where o.id = ${row.id}`
        if (!ctx) {
          await sql`update crm_outbox set error = 'lead or template gone' where id = ${row.id}`
          return { state: 'gone' as const }
        }
        const rendered = renderTemplate(ctx.body, { name: ctx.name ?? '', phone: ctx.phone ?? '', email: ctx.email ?? '', studio: ctx.studio })
        if (row.channel === 'whatsapp' && whatsappConfigured(env) && ctx.phone_norm) {
          return { state: 'send' as const, ctx, rendered, phone: ctx.phone_norm }
        }
        // Nothing leaves the building: the task and the mark commit together.
        await sql`
          insert into crm_activities (company_id, lead_id, type, subject, body, due_at, assigned_to)
          values (${row.company_id}, ${row.lead_id}, 'task', ${`Send "${ctx.tpl_name}" via ${row.channel}`}, ${rendered}, now(), ${ctx.assigned_to})`
        await sql`update crm_outbox set status = 'manual', error = null, sent_at = now() where id = ${row.id}`
        return { state: 'manual' as const }
      })
      if (claimed.state === 'taken') {
        out.claimed -= 1
        continue
      }
      if (claimed.state === 'gone') {
        out.failed += 1
        continue
      }
      if (claimed.state === 'manual') {
        out.manual += 1
        continue
      }

      let sent: { message_id?: string | null }
      try {
        sent = await sendWhatsAppText(env, claimed.phone, claimed.rendered)
      } catch (err) {
        const d = describeError(err)
        log.error({ outboxId: row.id, code: d.code, message: d.message }, 'outbox delivery failed')
        await withService(env, (sql) => sql`
          update crm_outbox set status = 'failed', error = ${d.message.slice(0, 300)} where id = ${row.id}`)
        out.failed += 1
        continue
      }
      // Sent. If recording it fails, the row stays INTERRUPTED: never resent.
      await withService(env, async (sql) => {
        await sql`
          insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, external_id, started_at)
          values (${row.company_id}, ${row.lead_id}, 'whatsapp', 'out', ${claimed.ctx.tpl_name}, ${claimed.rendered}, 'whatsapp', ${sent.message_id || null}, now())`
        await sql`update crm_outbox set status = 'sent', error = null, sent_at = now() where id = ${row.id}`
      })
      out.sent += 1
    } catch (err) {
      const d = describeError(err)
      log.error({ outboxId: row.id, code: d.code, message: d.message }, 'outbox delivery failed')
      out.failed += 1
    }
  }
  return out
}
