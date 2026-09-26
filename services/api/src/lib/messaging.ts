import { templateParams } from '@ipc/domain'
import type { Env } from '../context'
import { withService } from './db'
import { sendMessageEmail } from './email'
import { describeError, log } from './log'
import { sendWhatsAppTemplate, whatsappConfigured } from './whatsapp'

export interface MessagesSummary {
  claimed: number
  sent: number
  failed: number
}

interface ClaimedRow {
  id: string
  company_id: string
  channel: 'whatsapp' | 'email'
  to_address: string
  template_key: string | null
  meta_template_name: string | null
  language: string | null
  template_body: string | null
  vars: unknown
  subject: string | null
  body: string | null
  link: string | null
  studio_name: string
}

type Outcome = { ok: true; providerId: string } | { ok: false; error: string }

/** Send one claimed row. Never throws: every failure becomes a reason. */
export async function deliver(env: Env, row: ClaimedRow): Promise<Outcome> {
  try {
    if (row.channel === 'whatsapp') {
      if (!whatsappConfigured(env)) return { ok: false, error: 'WhatsApp not configured' }
      if (!row.meta_template_name || !row.template_body) return { ok: false, error: 'Template not found' }
      const vars = Array.isArray(row.vars) ? row.vars.map((v) => String(v ?? '')) : []
      const sent = await sendWhatsAppTemplate(
        env,
        row.to_address,
        { name: row.meta_template_name, language: row.language ?? 'en' },
        templateParams(row.template_body, vars),
      )
      return { ok: true, providerId: sent.message_id }
    }
    const r = await sendMessageEmail(env, {
      to: row.to_address,
      subject: row.subject ?? `${row.studio_name}: a message`,
      body: row.body,
      link: row.link,
      studio: row.studio_name,
      toClient: row.template_key === 'client_payment_due',
    })
    if (r.status === 'provider_missing') return { ok: false, error: 'Email not configured' }
    if (r.status === 'failed') return { ok: false, error: r.error ?? 'Email could not be sent.' }
    return { ok: true, providerId: r.id ?? '' }
  } catch (err) {
    return { ok: false, error: describeError(err).message.slice(0, 300) || 'Could not send.' }
  }
}

/**
 * Send what enqueue_message() queued. The claim commits on its own (rows move
 * to 'sending'), then each result commits on its own, so a crash half way
 * never rolls a sent message back to 'queued' and sends it twice. A failure
 * refunds the charge inside message_outbox_result().
 *
 * Without WhatsApp / Resend credentials (dev, CI) every row fails with
 * "… not configured" and is refunded. Nothing here throws for a single row.
 */
export async function drainMessages(env: Env, limit = 50): Promise<MessagesSummary> {
  const rows = await withService(env, (sql) => sql<ClaimedRow[]>`select * from message_outbox_claim(${limit})`)
  const out: MessagesSummary = { claimed: rows.length, sent: 0, failed: 0 }
  for (const row of rows) {
    const outcome = await deliver(env, row)
    try {
      await withService(env, (sql) =>
        outcome.ok
          ? sql`select message_outbox_result(${row.id}, true, ${outcome.providerId}, null)`
          : sql`select message_outbox_result(${row.id}, false, null, ${outcome.error})`,
      )
    } catch (err) {
      // The row stays 'sending'; the claim sweep refunds it after 30 minutes.
      const d = describeError(err)
      log.error({ messageId: row.id, code: d.code, message: d.message }, 'message result could not be saved')
    }
    if (outcome.ok) out.sent += 1
    else {
      out.failed += 1
      log.warn({ messageId: row.id, channel: row.channel, error: outcome.error }, 'message not sent')
    }
  }
  return out
}
