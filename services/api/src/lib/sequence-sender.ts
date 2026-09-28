import { fillSequenceText } from '@ipc/domain'
import type { Env } from '../context'
import { withService } from './db'
import { sendStudioEmail } from './email'
import { loadStudioBrand } from './studio-brand'
import { describeError, log } from './log'

export interface SequenceSendSummary {
  claimed: number
  sent: number
  failed: number
}

interface Claimed {
  id: string
  company_id: string
  lead_id: string
  channel: 'whatsapp' | 'email'
  subject: string | null
  body: string
  attempts: number
}

const MAX_ATTEMPTS = 3

/**
 * Send what sequences queued (0202). The claim commits on its own, marking
 * each row 'sending', and each result commits on its own -- so a crash half
 * way can leave a row stuck in 'sending' (visible, never resent) but can
 * never send one twice. A provider failure goes back to the queue for the
 * next tick, three tries in all.
 *
 * WhatsApp rows only exist here once the studio has connected its own
 * number (0203); until then they wait in "Send now" as 'manual'.
 */
export async function runSequenceSends(env: Env, dryRun: boolean): Promise<SequenceSendSummary> {
  if (dryRun) return { claimed: 0, sent: 0, failed: 0 }
  const rows = await withService(env, (sql) => sql<Claimed[]>`
    select id, company_id, lead_id, channel, subject, body, attempts from crm_sequence_sends_claim(50)`)
  const out: SequenceSendSummary = { claimed: rows.length, sent: 0, failed: 0 }
  for (const row of rows) {
    let result: { ok: true; id: string | null; subject: string; text: string } | { ok: false; error: string }
    try {
      result = await withService(env, async (sql) => {
        const [lead] = await sql<{ name: string | null; email: string | null; city: string | null; event_type: string | null; event_date: string | null }[]>`
          select name, email, city, event_type, event_date::text as event_date from crm_leads where id = ${row.lead_id}`
        if (!lead?.email) return { ok: false as const, error: 'No email address' }
        if (row.channel !== 'email') return { ok: false as const, error: 'WhatsApp is not connected' }
        const brand = await loadStudioBrand(sql, row.company_id)
        const studio = { name: brand.name, website: brand.website }
        const subject = fillSequenceText(row.subject ?? `A note from ${brand.name}`, lead, studio)
        const text = fillSequenceText(row.body, lead, studio)
        const r = await sendStudioEmail(env, { to: lead.email, subject, text, brand })
        if (r.status === 'sent') return { ok: true as const, id: r.id ?? null, subject, text }
        return { ok: false as const, error: r.status === 'provider_missing' ? 'Email is not set up on the server' : (r.error ?? 'Email could not be sent') }
      })
    } catch (err) {
      result = { ok: false, error: describeError(err).message.slice(0, 300) || 'Could not send' }
    }

    try {
      await withService(env, async (sql) => {
        if (result.ok) {
          await sql`update crm_sequence_sends set status = 'sent', sent_at = now(), provider_id = ${result.id}, error = null where id = ${row.id}`
          await sql`
            insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, external_id, started_at)
            values (${row.company_id}, ${row.lead_id}, 'email', 'out', ${result.subject}, ${result.text}, 'resend', ${result.id}, now())`
        } else {
          // A missing address will not fix itself; a provider hiccup might.
          const final = row.attempts >= MAX_ATTEMPTS || result.error === 'No email address'
          await sql`
            update crm_sequence_sends
               set status = ${final ? 'failed' : 'queued'}, error = ${result.error},
                   due_at = case when ${final} then due_at else now() + interval '50 minutes' end
             where id = ${row.id}`
        }
      })
      if (result.ok) out.sent += 1
      else out.failed += 1
    } catch (err) {
      const d = describeError(err)
      log.error({ sendId: row.id, code: d.code, message: d.message }, 'sequence send result not recorded')
      out.failed += 1
    }
  }
  return out
}
