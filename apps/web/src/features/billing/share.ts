import { buildMailtoUrl, buildWhatsAppUrl } from '@ipc/contracts'
import { toast } from 'sonner'
import { formatINR } from '@/shared/ui/format'
import { issueInvoiceLink } from './api'
import { shortDate } from './status'

/** What a message about an invoice needs to say. */
export interface InvoiceForShare {
  id: string
  invoice_number: string
  total: number
  balance_due: number
  due_date: string | null
  client_name: string | null
  client_phone?: string | null | undefined
  client_email?: string | null | undefined
  project_name?: string | null | undefined
}

/**
 * The message sent with an invoice. A reminder says what is still due and
 * since when; a first send just says here is the invoice.
 */
export function invoiceMessage(inv: InvoiceForShare, link: string, reminder: boolean): string {
  const hi = `Hi ${inv.client_name?.split(' ')[0] || 'there'},`
  const what = `invoice ${inv.invoice_number}${inv.project_name ? ` for ${inv.project_name}` : ''}`
  if (reminder) {
    const since = inv.due_date ? ` (due ${shortDate(inv.due_date)})` : ''
    return `${hi} a gentle reminder that ${formatINR(inv.balance_due)} is still due on ${what}${since}.\nYou can see the invoice and payment details here: ${link}\nThank you!`
  }
  const due = inv.balance_due > 0 && inv.balance_due < inv.total ? ` ${formatINR(inv.balance_due)} is still due.` : ''
  return `${hi} here is your ${what}, for ${formatINR(inv.total)}.${due}\nView and download it here: ${link}\nThank you!`
}

/** Copy the client's link to the clipboard. */
export async function copyInvoiceLink(invoiceId: string): Promise<void> {
  const link = await issueInvoiceLink(invoiceId)
  if (!link) return
  try {
    await navigator.clipboard.writeText(link)
    toast.success('Link copied. The client can open it without logging in.')
  } catch {
    toast.message(link)
  }
}

/**
 * Open WhatsApp with the message ready. The tab is opened straight away (a
 * browser blocks a window opened after waiting on the network) and pointed
 * at WhatsApp once the link is made.
 */
export async function whatsappInvoice(inv: InvoiceForShare, reminder = false): Promise<void> {
  const tab = window.open('', '_blank')
  const link = await issueInvoiceLink(inv.id)
  if (!link) {
    tab?.close()
    return
  }
  const url = buildWhatsAppUrl(inv.client_phone, invoiceMessage(inv, link, reminder))
  if (tab) tab.location.href = url
  else window.location.href = url
}

/** Open the email app with the message ready. */
export async function emailInvoice(inv: InvoiceForShare, reminder = false): Promise<void> {
  const link = await issueInvoiceLink(inv.id)
  if (!link) return
  const subject = reminder
    ? `Reminder: ${formatINR(inv.balance_due)} due on invoice ${inv.invoice_number}`
    : `Invoice ${inv.invoice_number} — ${formatINR(inv.total)}`
  window.location.href = buildMailtoUrl(inv.client_email ?? null, subject, invoiceMessage(inv, link, reminder))
}
