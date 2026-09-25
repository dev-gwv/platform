import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money } from './shared/primitives'

/**
 * The three documents a studio hands a client on a link: what it will cost,
 * what has been paid, and where the finished work is.
 *
 * All three read through a token and none of them require an account. The
 * crew-facing equivalent is `team-terms.ts`.
 */
export const quotationLine = z.object({
  title: z.string(),
  chargeable: z.boolean(),
  amount: money,
})
export type QuotationLine = z.infer<typeof quotationLine>

/**
 * Frozen at the moment it was issued. A deliverable added next week must not
 * change the quotation somebody already accepted, so the page reads this
 * snapshot rather than the project.
 */
export const quotationSnapshot = z.object({
  items: z.array(quotationLine),
  package_cost: money,
  add_ons: money,
  total: money,
  project_name: z.string(),
})
export type QuotationSnapshot = z.infer<typeof quotationSnapshot>

export const issueQuotationRequest = z.object({
  project_id: uuid,
  notes: z.string().trim().max(1000).nullish(),
  // Lovable parity (additive): branding/shoots/terms/prefs snapshot extras + link controls.
  branding: z.record(z.string(), z.unknown()).nullish(),
  shoots_schedule: z.array(z.record(z.string(), z.unknown())).nullish(),
  terms_text: z.string().trim().max(8000).nullish(),
  display_prefs: z.record(z.string(), z.unknown()).nullish(),
  show_quotation: z.boolean().nullish(),
  expiry_days: z.number().int().min(1).max(3650).nullish(),
})
export type IssueQuotationRequest = z.infer<typeof issueQuotationRequest>

export const issuedLink = z.object({ link: z.string() })
export type IssuedLink = z.infer<typeof issuedLink>

export const issueReceiptRequest = z.object({
  payment_id: uuid,
  // Lovable parity: configurable TTL + rotate/revoke controls.
  expiry_days: z.number().int().min(1).max(3650).nullish(),
  rotate: z.boolean().nullish(),
  revoke: z.boolean().nullish(),
})
export type IssueReceiptRequest = z.infer<typeof issueReceiptRequest>

export const sendReceiptEmailRequest = z.object({
  to_email: z.string().trim().max(200).nullish(),
  /** Lovable parity: the Email dialog collects several recipients at once. */
  to_emails: z.array(z.string().trim().max(200)).max(10).nullish(),
})
export type SendReceiptEmailRequest = z.infer<typeof sendReceiptEmailRequest>

export const sendReceiptEmailResponse = z.object({
  status: z.enum(['sent', 'provider_missing', 'failed']),
  error: z.string().nullable(),
  url: z.string(),
  sent_to: z.array(z.string()).nullish(),
  failed_to: z.array(z.object({ email: z.string(), error: z.string() })).nullish(),
})
export type SendReceiptEmailResponse = z.infer<typeof sendReceiptEmailResponse>

export const sendQuotationEmailRequest = z.object({ to_email: z.string().trim().max(200).nullish() })
export type SendQuotationEmailRequest = z.infer<typeof sendQuotationEmailRequest>

/** Default quotation terms shared by admin preview, edit reset and public render. */
export const DEFAULT_QUOTATION_TERMS: readonly string[] = [
  'This quotation is subject to final confirmation of event dates, locations, and deliverables.',
  'Additional deliverables or extended coverage may change the final quote.',
  'Booking is confirmed only after the agreed advance payment is received.',
  'Travel, accommodation, and special production requirements may be charged separately where applicable.',
  'Quotation is valid for 30 days from the date of issue. All amounts in INR unless stated otherwise.',
]
export const DEFAULT_QUOTATION_TERMS_TEXT = DEFAULT_QUOTATION_TERMS.join('\n')
export function parseQuotationTerms(raw: string | null | undefined): string[] {
  const text = (raw ?? '').trim()
  if (!text) return [...DEFAULT_QUOTATION_TERMS]
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
}

/** Client-side share helpers (mailto:/wa.me fallbacks mirror Lovable receiptShare.ts). */
export function normalizePhoneForWhatsApp(v: string | null | undefined): string {
  const raw = (v ?? '').trim()
  if (!raw) return ''
  const hadPlus = raw.startsWith('+')
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return ''
  if (hadPlus) return digits
  if (digits.length === 12 && digits.startsWith('91')) return digits
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`
  if (digits.length === 10) return `91${digits}`
  return digits
}
export function buildWhatsAppUrl(phone: string | null | undefined, text: string): string {
  const to = normalizePhoneForWhatsApp(phone)
  const encoded = encodeURIComponent(text)
  return to ? `https://wa.me/${to}?text=${encoded}` : `https://wa.me/?text=${encoded}`
}
export function buildMailtoUrl(to: string | null | undefined, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export const publicQuotation = z.object({
  snapshot: quotationSnapshot,
  notes: z.string().nullable(),
  accepted_at: isoDateTime.nullable(),
  accepted_by_name: z.string().nullable(),
  declined_at: isoDateTime.nullable(),
  client_name: z.string().nullable(),
  company_name: z.string().nullable(),
  // Lovable parity (all optional so old rows still parse).
  logo_url: z.string().nullable().nullish(),
  company_phone: z.string().nullable().nullish(),
  company_email: z.string().nullable().nullish(),
  company_address: z.string().nullable().nullish(),
  gstin: z.string().nullable().nullish(),
  shoots_schedule: z.array(z.record(z.string(), z.unknown())).nullish(),
  terms_text: z.string().nullable().nullish(),
  display_prefs: z.record(z.string(), z.unknown()).nullish(),
  show_quotation: z.boolean().nullish(),
  expires_at: isoDateTime.nullable().nullish(),
  revoked: z.boolean().nullish(),
  access_count: z.number().nullish(),
  // Lovable parity round 2: second deliverables list, cost summary, ack receipt.
  deliverables_2: z.array(z.record(z.string(), z.unknown())).nullish(),
  total_received: money.nullish(),
  balance_due: money.nullish(),
  quotation_id: z.string().nullish(),
  /**
   * Letterhead. A document a client keeps has to say who issued it and how to
   * reach them; these come from the studio's branding settings.
   */
  company_legal_name: z.string().nullable().nullish(),
  company_website: z.string().nullable().nullish(),
  document_footer_note: z.string().nullable().nullish(),
  client_phone: z.string().nullable().nullish(),
  client_email: z.string().nullable().nullish(),
  client_address: z.string().nullable().nullish(),
  project_status: z.string().nullable().nullish(),
  /** Shown on the document and quoted back in any conversation about it. */
  quotation_number: z.string().nullable().nullish(),
  issued_at: isoDateTime.nullable().nullish(),
  /**
   * The real deliverable rows, so the document can show an estimated date and
   * mark which items carry an extra charge instead of a flat "Included".
   */
  deliverables: z.array(z.record(z.string(), z.unknown())).nullish(),
})
export type PublicQuotation = z.infer<typeof publicQuotation>

export const respondToQuotationRequest = z.object({
  accept: z.boolean(),
  /** Required to accept — a name is the signature. Declining needs nothing. */
  name: z.string().trim().max(160).nullish(),
})
export type RespondToQuotationRequest = z.infer<typeof respondToQuotationRequest>

export const publicReceipt = z.object({
  amount: money,
  paid_on: isoDate,
  mode: z.string().nullable(),
  reference: z.string().nullable(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  company_name: z.string().nullable(),
  total_cost: money,
  received_total: money,
  // Lovable parity (all optional so old rows still parse).
  logo_url: z.string().nullable().nullish(),
  gstin: z.string().nullable().nullish(),
  company_phone: z.string().nullable().nullish(),
  company_email: z.string().nullable().nullish(),
  company_address: z.string().nullable().nullish(),
  description: z.string().nullable().nullish(),
  status: z.string().nullable().nullish(),
  access_count: z.number().nullish(),
  revoked: z.boolean().nullish(),
  expires_at: isoDateTime.nullable().nullish(),
  /**
   * Letterhead. A document a client keeps has to say who issued it and how to
   * reach them; these come from the studio's branding settings.
   */
  company_legal_name: z.string().nullable().nullish(),
  company_website: z.string().nullable().nullish(),
  document_footer_note: z.string().nullable().nullish(),
  client_phone: z.string().nullable().nullish(),
  client_email: z.string().nullable().nullish(),
  client_address: z.string().nullable().nullish(),
  receipt_number: z.string().nullable().nullish(),
  is_gst: z.boolean().nullish(),
  payment_gst_number: z.string().nullable().nullish(),
  // Lovable parity round 2: line-items table (invoice lines snapshot).
  line_items: z
    .array(
      z.object({
        description: z.string(),
        subtext: z.string().nullable().nullish(),
        quantity: z.number().nullish(),
        rate: money.nullish(),
        amount: money.nullish(),
      }),
    )
    .nullish(),
  invoice_number: z.string().nullable().nullish(),
})
export type PublicReceipt = z.infer<typeof publicReceipt>

/**
 * The same receipt, read inside the app by the studio: everything the client
 * sees plus the ids the toolbar needs (the project to open, the payment to
 * edit). Read under the user's own access, so no link is minted to look.
 */
export const paymentReceipt = publicReceipt.extend({
  id: uuid,
  project_id: uuid.nullable(),
  invoice_id: uuid.nullable(),
  created_at: isoDateTime,
  project_status: z.string().nullable(),
})
export type PaymentReceipt = z.infer<typeof paymentReceipt>

export const publicDelivery = z.object({
  submission_link: z.string().nullable(),
  notes: z.string().nullable(),
  delivered_at: isoDateTime.nullable(),
  project_name: z.string().nullable(),
  client_name: z.string().nullable(),
  company_name: z.string().nullable(),
  // Lovable parity (all optional).
  title: z.string().nullable().nullish(),
  delivery_type: z.string().nullable().nullish(),
  delivery_label: z.string().nullable().nullish(),
  logo_url: z.string().nullable().nullish(),
  ready_at: isoDateTime.nullable().nullish(),
  revoked: z.boolean().nullish(),
  expires_at: isoDateTime.nullable().nullish(),
  access_count: z.number().nullish(),
  // Lovable parity round 2: CTA label + channel log.
  link_label: z.string().nullable().nullish(),
  channel: z.string().nullable().nullish(),
  sent_via: z.array(z.string()).nullish(),
  /**
   * Letterhead. A document a client keeps has to say who issued it and how to
   * reach them; these come from the studio's branding settings.
   */
  company_legal_name: z.string().nullable().nullish(),
  company_website: z.string().nullable().nullish(),
  document_footer_note: z.string().nullable().nullish(),
  company_phone: z.string().nullable().nullish(),
  company_email: z.string().nullable().nullish(),
})
export type PublicDelivery = z.infer<typeof publicDelivery>
