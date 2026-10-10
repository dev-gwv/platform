import { z, buildMailtoUrl, buildWhatsAppUrl } from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi } from '@/shared/api/client'

const linkSchema = z.object({ link: z.string() })
const emailResult = z.object({
  status: z.string(),
  error: z.string().nullable(),
  url: z.string(),
  sent_to: z.array(z.string()).nullish(),
  failed_to: z.array(z.object({ email: z.string(), error: z.string() })).nullish(),
})

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export interface ReceiptShareSummary {
  clientName?: string | null
  projectName?: string | null
  amountFormatted: string
  paymentDate: string
}

/** Mint (or re-mint) the public receipt link for a received payment. */
export async function issueReceiptLink(paymentId: string): Promise<string | null> {
  try {
    const r = await callApi('/documents/receipts', {
      method: 'POST',
      body: { payment_id: paymentId },
      responseSchema: linkSchema,
    })
    return r.link
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not generate the receipt link.')
    return null
  }
}

export async function copyReceiptLink(paymentId: string): Promise<void> {
  const link = await issueReceiptLink(paymentId)
  if (!link) return
  const ok = await copyToClipboard(link)
  toast[ok ? 'success' : 'error'](ok ? 'Public receipt link copied.' : 'Could not copy the link.')
}

/**
 * Send the receipt to several recipients. Mirrors Lovable receiptShareActions:
 * sent → toast, provider_missing → mailto fallback (or copy when no email),
 * failed → surface the server error.
 */
export async function sendReceiptEmails(
  paymentId: string,
  emails: string[],
  fallback?: { clientEmail?: string | null; subject: string; text: string },
): Promise<boolean> {
  const toSend = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  try {
    const r = await callApi('/documents/receipts/send-email', {
      method: 'POST',
      body: { payment_id: paymentId, to_emails: toSend.length > 0 ? toSend : undefined },
      responseSchema: emailResult,
    })
    if (r.status === 'sent') {
      const n = r.sent_to?.length ?? toSend.length
      toast.success(n > 1 ? `Receipt sent to ${n} recipients.` : 'Receipt emailed successfully.')
      if (r.failed_to?.length) {
        toast.warning(`Could not reach: ${r.failed_to.map((f) => f.email).join(', ')}`)
      }
      return true
    }
    if (r.status === 'provider_missing') {
      const to = toSend[0] ?? fallback?.clientEmail ?? ''
      if (to && fallback) {
        window.location.href = buildMailtoUrl(to, fallback.subject, `${fallback.text}\n\n${r.url}`)
        toast.message('Email provider not configured — opened your email client.')
      } else {
        const ok = await copyToClipboard(r.url)
        toast[ok ? 'success' : 'error'](
          ok ? 'Email provider not configured — receipt link copied.' : 'Email provider not configured.',
        )
      }
      return false
    }
    toast.error(r.error ?? 'Email failed to send.')
    return false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Email failed to send.')
    return false
  }
}

export function openReceiptWhatsApp(phone: string | null | undefined, text: string): void {
  const url = buildWhatsAppUrl(phone, text)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened) {
    void copyToClipboard(text).then((ok) => {
      toast[ok ? 'success' : 'error'](ok ? 'Message copied — paste into WhatsApp.' : 'Unable to open WhatsApp.')
    })
  }
}

export function receiptShareText(summary: ReceiptShareSummary, link: string): string {
  const who = summary.clientName?.trim() || 'there'
  const proj = summary.projectName?.trim() ? ` for ${summary.projectName}` : ''
  return `Hi ${who}, we have received your payment of ${summary.amountFormatted}${proj} on ${summary.paymentDate}. You can view/download your payment receipt here: ${link}`
}
