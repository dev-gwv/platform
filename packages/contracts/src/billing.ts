import { z } from 'zod'
import { uuid, isoDate, isoDateTime, money, gstRate } from './shared/primitives'
import { invoiceTemplateLayout } from './invoice-templates'

export const invoiceStatus = z.enum(['draft', 'sent', 'partial', 'paid', 'cancelled'])
export type InvoiceStatus = z.infer<typeof invoiceStatus>

export const invoiceListItem = z.object({
  id: uuid,
  invoice_number: z.string(),
  client_name: z.string().nullable(),
  invoice_date: isoDate,
  total: money,
  balance_due: money,
  status: invoiceStatus,
  // Which project it belongs to and when it falls due, so a list row can link
  // back to the project and say "overdue" -- defaulted for older servers.
  project_id: uuid.nullable().default(null),
  project_name: z.string().nullable().default(null),
  due_date: isoDate.nullable().default(null),
  client_phone: z.string().nullable().default(null),
  /** The value before GST; a payment plan instalment is counted against this. */
  taxable: money.nullable().default(null),
})
export type InvoiceListItem = z.infer<typeof invoiceListItem>

export const invoiceLineInput = z.object({
  /** The short, bold label a client sees -- e.g. "Wedding Photography Package". */
  description: z.string().trim().min(1).max(200),
  /** The subtext line underneath it -- e.g. "Haldi + Wedding + Reception coverage". Optional. */
  subtext: z.string().trim().max(200).optional(),
  quantity: z.number().positive(),
  rate: money,
  gst_rate: gstRate,
})
export type InvoiceLineInput = z.infer<typeof invoiceLineInput>

export const invoiceDiscountType = z.enum(['flat', 'percent', 'none'])
export type InvoiceDiscountType = z.infer<typeof invoiceDiscountType>

export const invoiceDocStatus = z.enum(['draft', 'sent'])
export type InvoiceDocStatus = z.infer<typeof invoiceDocStatus>

export const createInvoiceRequest = z.object({
  client_id: uuid.nullable().default(null),
  project_id: uuid.nullable().default(null),
  place_of_supply: z.string(),
  /** True when the studio and place of supply are the same state (CGST+SGST). */
  intra_state: z.boolean().default(true),
  invoice_date: isoDate.optional(),
  due_date: isoDate.optional(),
  discount: money.default(0),
  /** Whether `discount` is a flat rupee amount or a percent of the subtotal. Only the flat figure it resolves to is ever persisted. */
  discount_type: invoiceDiscountType.default('flat'),
  /** Draft invoices stay editable; sent invoices are client-facing. Defaults to sent for backward compat. */
  status: invoiceDocStatus.default('sent'),
  /** Per-invoice GSTIN snapshot (Lovable parity) — validated against GSTIN_REGEX when present. */
  gst_number: z.string().trim().max(20).nullish(),
  notes: z.string().max(1000).optional(),
  /** Per-invoice free-text snapshot — falls back to the print layout when blank. */
  bank_details: z.string().trim().max(1000).optional(),
  terms: z.string().trim().max(2000).optional(),
  /** Which saved layout this invoice prints with — omitted or null means the company's default (if any). */
  template_id: uuid.nullable().optional(),
  /** Overrides the auto-numbered sequence, which is left untouched when this is blank. Create only -- a number never changes on edit. */
  invoice_number: z.string().trim().max(40).optional(),
  lines: z.array(invoiceLineInput).min(1),
})
export type CreateInvoiceRequest = z.infer<typeof createInvoiceRequest>

/** Same shape as creation minus the number override, which only ever applies once, at creation. */
export const updateInvoiceRequest = createInvoiceRequest.omit({ invoice_number: true })
export type UpdateInvoiceRequest = z.infer<typeof updateInvoiceRequest>

export const recordPaymentRequest = z.object({
  amount: money.refine((v) => v > 0, 'amount must be positive'),
  paid_on: isoDate.optional(),
  mode: z.string().max(40).optional(),
  reference: z.string().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
})
export type RecordPaymentRequest = z.infer<typeof recordPaymentRequest>

export const gstState = z.object({ code: z.string(), name: z.string() })
export type GstState = z.infer<typeof gstState>

export const invoiceDetail = z.object({
  id: uuid,
  invoice_number: z.string(),
  invoice_date: isoDate,
  due_date: isoDate.nullable(),
  status: invoiceStatus,
  gst_number: z.string().nullable().default(null),
  place_of_supply: z.string().nullable(),
  intra_state: z.boolean(),
  client_id: uuid.nullable(),
  project_id: uuid.nullable(),
  client_name: z.string().nullable(),
  client_gstin: z.string().nullable(),
  client_address: z.string().nullable(),
  client_phone: z.string().nullable().default(null),
  client_email: z.string().nullable().default(null),
  project_name: z.string().nullable().default(null),
  notes: z.string().nullable(),
  /** Per-invoice snapshot; when null the print layout's bank_details/terms apply. */
  bank_details: z.string().nullable().default(null),
  terms: z.string().nullable().default(null),
  template_id: uuid.nullable(),
  /** Resolved server-side: the invoice's own template, else the company's default, else null. */
  template_layout: invoiceTemplateLayout.nullable(),
  subtotal: money,
  discount: money,
  /** How `discount` was entered — persisted so an edit keeps the original type. */
  discount_type: invoiceDiscountType.default('flat'),
  taxable: money,
  tax: money,
  total: money,
  amount_paid: money,
  balance_due: money,
  created_at: isoDateTime,
  items: z.array(
    z.object({
      id: uuid,
      description: z.string(),
      subtext: z.string().nullable(),
      quantity: z.number(),
      rate: money,
      amount: money,
      gst_rate: z.number(),
      cgst: money,
      sgst: money,
      igst: money,
    }),
  ),
  payments: z.array(
    z.object({
      id: uuid,
      amount: money,
      paid_on: isoDate,
      mode: z.string().nullable(),
      reference: z.string().nullable().default(null),
      notes: z.string().nullable().default(null),
      /** 'pending' is promised money; it does not reduce the balance. */
      status: z.string().nullable().default('paid'),
    }),
  ),
})
export type InvoiceDetail = z.infer<typeof invoiceDetail>

/** Server-side list filters — every field optional for backward compat. */
export const invoiceListQuery = z.object({
  search: z.string().trim().max(160).optional(),
  status: z.string().trim().max(20).optional(),
  client_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
})
export type InvoiceListQuery = z.infer<typeof invoiceListQuery>

export const invoiceListSummary = z.object({
  total_invoices: z.number().int().nonnegative(),
  billed: money,
  paid: money,
  pending: money,
})
export type InvoiceListSummary = z.infer<typeof invoiceListSummary>

export const invoiceListResponse = z.object({
  items: z.array(invoiceListItem),
  summary: invoiceListSummary,
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
})
export type InvoiceListResponse = z.infer<typeof invoiceListResponse>

/** One line of the Billing overview's "due" list. */
export const billingDueInvoice = z.object({
  id: uuid,
  invoice_number: z.string(),
  invoice_date: isoDate,
  due_date: isoDate.nullable(),
  total: money,
  balance_due: money,
  status: invoiceStatus,
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
})
export type BillingDueInvoice = z.infer<typeof billingDueInvoice>

/** A project with money still to come in. */
export const billingToCollect = z.object({
  project_id: uuid,
  project_name: z.string(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  total_cost: money,
  received: money,
  due: money,
  invoiced_open: money,
})
export type BillingToCollect = z.infer<typeof billingToCollect>

/** The Billing overview: what is owed, what is late, what came in. */
export const billingOverview = z.object({
  to_collect: money,
  overdue: z.object({ count: z.number().int(), amount: money }),
  due_soon: z.object({ count: z.number().int(), amount: money }),
  received_this_month: money,
  invoiced_this_month: money,
  monthly: z.array(z.object({ month: z.string(), invoiced: money, received: money })),
  due_invoices: z.array(billingDueInvoice),
  projects_to_collect: z.array(billingToCollect),
  recent_payments: z.array(
    z.object({
      id: uuid,
      amount: money,
      paid_on: isoDate,
      mode: z.string().nullable(),
      client_name: z.string().nullable(),
      project_id: uuid.nullable(),
      project_name: z.string().nullable(),
      invoice_id: uuid.nullable(),
      invoice_number: z.string().nullable(),
    }),
  ),
})
export type BillingOverview = z.infer<typeof billingOverview>

/** What a client sees at an invoice link: the invoice and who it is from. */
export const publicInvoice = z.object({
  invoice: invoiceDetail,
  company: z.object({
    name: z.string().nullable(),
    legal_name: z.string().nullable().default(null),
    city: z.string().nullable().default(null),
    state: z.string().nullable().default(null),
    country: z.string().nullable().default(null),
    invoice_gst_number: z.string().nullable().default(null),
    invoice_address: z.string().nullable().default(null),
    invoice_phone: z.string().nullable().default(null),
    invoice_email: z.string().nullable().default(null),
    invoice_upi_id: z.string().nullable().default(null),
    logo_url: z.string().nullable().default(null),
    document_footer_note: z.string().nullable().default(null),
  }),
})
export type PublicInvoice = z.infer<typeof publicInvoice>

/** Map a technical save failure to copy a studio owner can act on. */
export function friendlyInvoiceError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  if (!raw) return 'Something went wrong while saving. Please try again.'
  if (raw.includes('network') || raw.includes('failed to fetch')) return 'Network issue — check your connection and try again.'
  if (raw.includes('duplicate') || raw.includes('23505') || raw.includes('already exists') || raw.includes('taken'))
    return 'An invoice with this number already exists. Use a different invoice number.'
  if (raw.includes('discount') || raw.includes('over-discount') || raw.includes('exceeds'))
    return 'Discount cannot exceed the invoice subtotal. Lower the discount and try again.'
  if (raw.includes('gst')) return 'GST details look invalid. Check GSTIN and place of supply.'
  if (raw.includes('permission') || raw.includes('forbidden') || raw.includes('not allowed') || raw.includes('access'))
    return "You don't have permission to do that."
  if (raw.includes('payment') && raw.includes('edit')) return 'A payment has already been recorded against this invoice — it can no longer be edited.'
  const cleaned = (err instanceof Error ? err.message : String(err)).replace(/^(error:?|pgrst\w*:?|postgres\w*:?)\s*/i, '').trim()
  return cleaned || 'Unable to save. Please try again.'
}

/** Indian GSTIN: 2-digit state + 10-char PAN + entity + Z + checksum. */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

// ── Bank accounts (reusable invoice bank/UPI snapshots) ──────────
export const invoiceBankAccount = z.object({
  id: uuid,
  company_id: uuid,
  label: z.string(),
  holder: z.string().nullable(),
  bank: z.string().nullable(),
  number: z.string().nullable(),
  ifsc: z.string().nullable(),
  upi: z.string().nullable(),
  branch: z.string().nullable(),
  notes: z.string().nullable(),
  is_default: z.boolean(),
  is_active: z.boolean(),
  created_at: isoDateTime,
})
export type InvoiceBankAccount = z.infer<typeof invoiceBankAccount>

export const invoiceBankAccountList = z.object({ items: z.array(invoiceBankAccount) })
export type InvoiceBankAccountList = z.infer<typeof invoiceBankAccountList>

export const createInvoiceBankAccountRequest = z.object({
  label: z.string().trim().min(1).max(120),
  holder: z.string().trim().max(160).nullish(),
  bank: z.string().trim().max(160).nullish(),
  number: z.string().trim().max(60).nullish(),
  ifsc: z.string().trim().toUpperCase().max(20).nullish(),
  upi: z.string().trim().max(120).nullish(),
  branch: z.string().trim().max(160).nullish(),
  notes: z.string().trim().max(500).nullish(),
  is_default: z.boolean().default(false),
})
export type CreateInvoiceBankAccountRequest = z.infer<typeof createInvoiceBankAccountRequest>

// ── Standalone received_payments module (Lovable billing parity) ──
export const receivedPaymentStatus = z.enum(['paid', 'pending'])
export type ReceivedPaymentStatus = z.infer<typeof receivedPaymentStatus>

export const receivedPaymentSortBy = z.enum([
  'date_received',
  'created_at',
  'amount',
  'project_name',
  'client_name',
  'status',
])
export type ReceivedPaymentSortBy = z.infer<typeof receivedPaymentSortBy>

export const receivedPayment = z.object({
  id: uuid,
  /**
   * Nullable since 0145: a payment can be against an invoice that has no
   * project. One of project_id / invoice_id is always set — the database
   * refuses money that belongs to nothing.
   */
  project_id: uuid.nullable(),
  project_name: z.string().nullable(),
  invoice_id: uuid.nullable().default(null),
  invoice_number: z.string().nullable().default(null),
  client_id: uuid.nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  client_email: z.string().nullable(),
  amount: money,
  description: z.string().nullable(),
  status: receivedPaymentStatus,
  is_gst: z.boolean(),
  gst_number: z.string().nullable(),
  date_received: isoDate.nullable(),
  file_url: z.string().nullable(),
  /**
   * When a person confirmed this money reached the bank. Not a statement
   * import — `received` is what the studio recorded, `banked` is what it has
   * confirmed, and the gap between them is the point.
   */
  cleared_at: isoDateTime.nullable().default(null),
  created_at: isoDateTime,
})
export type ReceivedPayment = z.infer<typeof receivedPayment>

export const setPaymentClearedRequest = z.object({
  /** True marks it confirmed in the bank; false takes the confirmation back. */
  cleared: z.boolean(),
})
export type SetPaymentClearedRequest = z.infer<typeof setPaymentClearedRequest>

const booleanFromQuery = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === '') return undefined
    if (typeof v === 'boolean') return v
    const s = String(v).trim().toLowerCase()
    if (['true', '1', 'yes'].includes(s)) return true
    if (['false', '0', 'no'].includes(s)) return false
    return v
  },
  z.boolean().optional(),
)

export const receivedPaymentListQuery = z.object({
  search: z.string().trim().max(160).optional(),
  /** all | paid | pending | gst (gst = is_gst only, any status). */
  status: z.string().trim().max(20).optional(),
  client_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  is_gst: booleanFromQuery,
  amount_min: z.coerce.number().finite().nonnegative().optional(),
  amount_max: z.coerce.number().finite().nonnegative().optional(),
  sort_by: receivedPaymentSortBy.default('date_received'),
  sort_direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
})
export type ReceivedPaymentListQuery = z.infer<typeof receivedPaymentListQuery>

export const receivedPaymentListSummary = z.object({
  total_received_amount: money,
  pending_amount: money,
  paid_count: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  gst_count: z.number().int().nonnegative(),
})
export type ReceivedPaymentListSummary = z.infer<typeof receivedPaymentListSummary>

export const receivedPaymentListResponse = z.object({
  items: z.array(receivedPayment),
  summary: receivedPaymentListSummary,
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
})
export type ReceivedPaymentListResponse = z.infer<typeof receivedPaymentListResponse>

export const createReceivedPaymentRequest = z
  .object({
    /** Optional since 0145 — but see the refine below: one link is required. */
    project_id: uuid.nullable().optional(),
    invoice_id: uuid.nullable().optional(),
    client_id: uuid.nullable().optional(),
    amount: money.refine((v) => v > 0, 'amount must be greater than zero'),
    description: z.string().trim().max(500).nullish(),
    status: receivedPaymentStatus.default('paid'),
    is_gst: z.boolean().default(false),
    gst_number: z.string().trim().max(20).nullish(),
    date_received: isoDate.optional(),
    file_url: z.string().trim().max(1000).nullish(),
  })
  .superRefine((v, ctx) => {
    // Money has to belong to something, or it can never be reconciled. The
    // database says the same thing (received_payments_linked_check); this is
    // so the person gets a sentence instead of a constraint name.
    if (!v.project_id && !v.invoice_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['project_id'],
        message: 'Choose the project or the invoice this payment is against.',
      })
    }
    if (v.is_gst) {
      const g = (v.gst_number ?? '').trim()
      if (!g) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gst_number'], message: 'GST number is required when GST applies.' })
      } else if (g.length < 5) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gst_number'], message: 'Invalid GST number.' })
      }
    }
  })
export type CreateReceivedPaymentRequest = z.infer<typeof createReceivedPaymentRequest>

export const updateReceivedPaymentRequest = z.object({
  project_id: uuid.optional(),
  client_id: uuid.nullable().optional(),
  amount: money.refine((v) => v > 0, 'amount must be greater than zero').optional(),
  description: z.string().trim().max(500).nullish(),
  status: receivedPaymentStatus.optional(),
  is_gst: z.boolean().optional(),
  gst_number: z.string().trim().max(20).nullish(),
  date_received: isoDate.optional(),
  file_url: z.string().trim().max(1000).nullish(),
})
export type UpdateReceivedPaymentRequest = z.infer<typeof updateReceivedPaymentRequest>

/** Snapshot text stamped onto an invoice — mirrors the Lovable format. */
export function formatBankSnapshot(b: {
  label?: string | null
  holder?: string | null
  bank?: string | null
  number?: string | null
  ifsc?: string | null
  upi?: string | null
  branch?: string | null
  notes?: string | null
}): string {
  const lines: string[] = []
  if (b.label) lines.push(b.label)
  if (b.holder) lines.push(`A/c Holder: ${b.holder}`)
  if (b.bank) lines.push(`Bank: ${b.bank}${b.branch ? ` (${b.branch})` : ''}`)
  if (b.number) lines.push(`A/c No: ${b.number}`)
  if (b.ifsc) lines.push(`IFSC: ${b.ifsc}`)
  if (b.upi) lines.push(`UPI: ${b.upi}`)
  if (b.notes) lines.push(b.notes)
  return lines.join('\n')
}
