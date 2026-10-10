import { fillSequenceText } from '@ipc/domain'
import type { Env } from '../context'
import { withService } from './db'
import { sendStudioEmail } from './email'
import { loadStudioBrand } from './studio-brand'
import { open } from './secret-box'
import { sendWhatsAppTemplate, sendWhatsAppText } from './whatsapp'
import { describeError, log } from './log'

interface SequenceSendSummary {
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
  wa_template_name: string | null
  wa_template_lang: string | null
  wa_params: string[] | null
}

type Result =
  | { ok: true; id: string | null; subject: string | null; text: string }
  | { ok: false; error: string; final?: boolean }
  | { manual: true; reason: string }

interface LeadRow {
  name: string | null
  email: string | null
  phone_norm: string | null
  city: string | null
  event_type: string | null
  event_date: string | null
}

const MAX_ATTEMPTS = 3

/**
 * Send what sequences queued (0202). The claim commits on its own, marking
 * each row 'sending', and each result commits on its own -- so a crash half
 * way can leave a row stuck in 'sending' (visible, never resent) but can
 * never send one twice. A provider failure goes back to the queue for the
 * next tick, three tries in all.
 *
 * WhatsApp (0203) goes from the studio's own number: with the step's
 * approved template, or as plain text while the client's 24 hours are open.
 * If the window closed between queueing and sending, the message goes back
 * to "Send now" for a tap rather than failing.
 */
export async function runSequenceSends(env: Env, dryRun: boolean): Promise<SequenceSendSummary> {
  if (dryRun) return { claimed: 0, sent: 0, failed: 0 }
  const rows = await withService(env, (sql) => sql<Claimed[]>`
    select id, company_id, lead_id, channel, subject, body, attempts, wa_template_name, wa_template_lang, wa_params
      from crm_sequence_sends_claim(50)`)
  const out: SequenceSendSummary = { claimed: rows.length, sent: 0, failed: 0 }
  for (const row of rows) {
    let result: Result
    try {
      result = await withService(env, async (sql) => {
        const [lead] = await sql<LeadRow[]>`
          select name, email, phone_norm, city, event_type, event_date::text as event_date from crm_leads where id = ${row.lead_id}`
        if (!lead) return { ok: false as const, error: 'The lead is gone', final: true }
        const brand = await loadStudioBrand(sql, row.company_id)
        const studio = { name: brand.name, website: brand.website }
        const text = fillSequenceText(row.body, lead, studio)

        if (row.channel === 'whatsapp') {
          if (!lead.phone_norm) return { ok: false as const, error: 'No phone number', final: true }
          const template = row.wa_template_name
          const [can] = await sql<{ ok: boolean }[]>`select crm_whatsapp_can_send(${row.company_id}, ${row.lead_id}, ${!!template}) as ok`
          if (!can?.ok) return { manual: true as const, reason: 'WhatsApp only allows a template after 24 hours' }
          const [conn] = await sql<{ phone_number_id: string; access_token_enc: string }[]>`
            select phone_number_id, access_token_enc from company_whatsapp where company_id = ${row.company_id}`
          if (!conn) return { manual: true as const, reason: 'WhatsApp is not connected' }
          const number = { WHATSAPP_PHONE_NUMBER_ID: conn.phone_number_id, WHATSAPP_ACCESS_TOKEN: await open(env, conn.access_token_enc) }
          // A template's {{1}}.. are filled from our words; WhatsApp refuses a blank one.
          const sent = template
            ? await sendWhatsAppTemplate(
                number,
                lead.phone_norm,
                { name: template, language: row.wa_template_lang ?? 'en' },
                (row.wa_params ?? []).map((k) => fillSequenceText(`{{${k}}}`, lead, studio) || '-'),
              )
            : await sendWhatsAppText(number, lead.phone_norm, text)
          return { ok: true as const, id: sent.message_id || null, subject: null, text }
        }

        if (!lead.email) return { ok: false as const, error: 'No email address', final: true }
        const subject = fillSequenceText(row.subject ?? `A note from ${brand.name}`, lead, studio)
        const r = await sendStudioEmail(env, { to: lead.email, subject, text, brand })
        if (r.status === 'sent') return { ok: true as const, id: r.id ?? null, subject, text }
        return { ok: false as const, error: r.status === 'provider_missing' ? 'Email is not set up on the server' : (r.error ?? 'Email could not be sent') }
      })
    } catch (err) {
      result = { ok: false, error: describeError(err).message.slice(0, 300) || 'Could not send' }
    }

    // The outcome first, on its own: whatever happens to the timeline entry
    // below, a sent message is never left looking unsent (and resent).
    try {
      await withService(env, async (sql) => {
        if ('manual' in result) {
          await sql`update crm_sequence_sends set status = 'manual', error = ${result.reason} where id = ${row.id}`
        } else if (result.ok) {
          await sql`
            update crm_sequence_sends
               set status = 'sent', sent_at = now(), provider_id = ${result.id}, error = null,
                   delivery = case when channel = 'whatsapp' then 'sent' end
             where id = ${row.id}`
        } else {
          // A missing address will not fix itself; a provider hiccup might.
          const final = result.final === true || row.attempts >= MAX_ATTEMPTS
          await sql`
            update crm_sequence_sends
               set status = ${final ? 'failed' : 'queued'}, error = ${result.error},
                   due_at = case when ${final} then due_at else now() + interval '50 minutes' end
             where id = ${row.id}`
        }
      })
      if ('manual' in result) continue
      if (result.ok) out.sent += 1
      else out.failed += 1
    } catch (err) {
      const d = describeError(err)
      log.error({ sendId: row.id, code: d.code, message: d.message }, 'sequence send result not recorded')
      out.failed += 1
      continue
    }

    if ('ok' in result && result.ok) {
      const sent = result
      await withService(env, (sql) => sql`
        insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, external_id, started_at)
        values (${row.company_id}, ${row.lead_id}, ${row.channel}, 'out', ${sent.subject}, ${sent.text},
                ${row.channel === 'whatsapp' ? 'whatsapp' : 'manual'}, ${sent.id}, now())
        on conflict do nothing`).catch((err: unknown) => {
        const d = describeError(err)
        log.warn({ sendId: row.id, code: d.code, message: d.message }, 'sequence send not added to the timeline')
      })
    }
  }
  return out
}
