import type { CreateReceivedPaymentRequest, ReceivedPayment, UpdateReceivedPaymentRequest } from '@ipc/contracts'

/**
 * What the one payment form holds, wherever it is opened from. Every place
 * that records or changes a payment received asks these, in this order:
 * (client, project when it starts from nothing) · received or promised ·
 * amount and date · against which invoice · how · then reference, note, GST
 * and receipt link under "More".
 */
export interface PaymentForm {
  clientId: string
  projectId: string
  invoiceId: string
  amount: string
  paidOn: string
  mode: string
  received: boolean
  reference: string
  description: string
  isGst: boolean
  gstNumber: string
  fileUrl: string
}

/** Where the form saves, which decides what it can keep. */
export type PaymentFormKind = 'project' | 'invoice' | 'pick'

export function blankPaymentForm(today: string, start: Partial<PaymentForm> = {}): PaymentForm {
  return {
    clientId: '',
    projectId: '',
    invoiceId: '',
    amount: '',
    paidOn: today,
    mode: 'UPI',
    received: true,
    reference: '',
    description: '',
    isGst: false,
    gstNumber: '',
    fileUrl: '',
    ...start,
  }
}

/** A payment from the Payments list (or the invoice page) as the form starts. */
export function formFromReceived(p: ReceivedPayment, today: string): PaymentForm {
  return blankPaymentForm(today, {
    clientId: p.client_id ?? '',
    projectId: p.project_id ?? '',
    invoiceId: p.invoice_id ?? '',
    amount: String(p.amount ?? ''),
    paidOn: (p.date_received ?? today).slice(0, 10),
    mode: p.mode ?? '',
    received: p.status !== 'pending',
    reference: p.reference ?? '',
    description: p.description ?? '',
    isGst: !!p.is_gst,
    gstNumber: p.gst_number ?? '',
    fileUrl: p.file_url ?? '',
  })
}

/**
 * The questions each save path can keep. One form, one order; a field is
 * left out only where the endpoint behind it has nowhere to put it:
 * /billing/payments takes no reference, the project's and the invoice's
 * payment routes take no receipt link, and money recorded on an invoice is
 * always received, never GST-flagged here.
 */
export function paymentQuestions(kind: PaymentFormKind) {
  return {
    place: kind === 'pick',
    status: kind !== 'invoice',
    invoice: kind !== 'invoice',
    reference: kind !== 'pick',
    gst: kind !== 'invoice',
    receiptLink: kind === 'pick',
  }
}

/** The words on the "More" link: only what this form can keep. */
export function moreLabel(q: ReturnType<typeof paymentQuestions>): string {
  const parts = [q.reference && 'reference', 'note', q.gst && 'GST', q.receiptLink && 'receipt link'].filter((p): p is string => !!p)
  const words = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}` : (parts[0] ?? 'note')
  return `+ ${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** The first thing wrong with the form, in words, or null. */
export function checkPaymentForm(form: PaymentForm, { needsLink }: { needsLink: boolean }): string | null {
  const amount = Number(form.amount)
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter the amount.'
  // Since 0145 a payment may be against an invoice instead of a project, but
  // it must be against something, or nothing can ever reconcile it.
  if (needsLink && !form.projectId && !form.invoiceId) return 'Pick the project or the invoice this payment is against.'
  if (form.isGst && form.gstNumber.trim().length < 5) return 'That GST number looks too short.'
  return null
}

/** POST /billing/payments: a payment started from + New or the Payments list. */
export function ledgerCreateBody(form: PaymentForm): CreateReceivedPaymentRequest {
  return {
    ...(form.projectId ? { project_id: form.projectId } : {}),
    ...(form.invoiceId ? { invoice_id: form.invoiceId } : {}),
    ...(form.clientId ? { client_id: form.clientId } : {}),
    amount: Number(form.amount),
    description: form.description.trim() || null,
    status: form.received ? 'paid' : 'pending',
    is_gst: form.isGst,
    gst_number: form.isGst ? form.gstNumber.trim() || null : null,
    ...(form.paidOn ? { date_received: form.paidOn } : {}),
    file_url: form.fileUrl.trim() || null,
    // A draft saved before the mode chips has no mode at all.
    mode: (form.mode || '').trim() || null,
  }
}

/**
 * PATCH /billing/payments/:id. That route keeps the project and the client
 * when given none (it cannot unlink them) and never moves the invoice, so
 * those are only sent when there is a new one to set.
 */
export function ledgerPatchBody(form: PaymentForm, was: Pick<ReceivedPayment, 'project_id' | 'client_id'>): UpdateReceivedPaymentRequest {
  return {
    ...(form.projectId && form.projectId !== was.project_id ? { project_id: form.projectId } : {}),
    ...(form.clientId && form.clientId !== was.client_id ? { client_id: form.clientId } : {}),
    amount: Number(form.amount),
    description: form.description.trim() || null,
    status: form.received ? 'paid' : 'pending',
    is_gst: form.isGst,
    gst_number: form.isGst ? form.gstNumber.trim() || null : null,
    ...(form.paidOn ? { date_received: form.paidOn } : {}),
    file_url: form.fileUrl.trim() || null,
    mode: (form.mode || '').trim() || null,
  }
}

/** An invoice row as the + New form sees it (from GET /billing/invoices). */
export interface InvoiceRow {
  id: string
  invoice_number: string
  balance_due: number
  due_date?: string | null | undefined
  status: string
  project_id?: string | null | undefined
}

/**
 * The invoices a payment can be put against once a client is picked: the
 * ones still owed (not drafts, not cancelled), narrowed to the picked
 * project's -- the same rule as the project's Billing tab. The invoice a
 * payment is already against always stays in the list.
 */
export function invoiceChoices<T extends InvoiceRow>(rows: T[], projectId: string, keepId: string): T[] {
  return rows.filter((i) => {
    if (i.id === keepId) return true
    if (i.status === 'cancelled' || i.status === 'draft' || !(i.balance_due > 0)) return false
    return !projectId || i.project_id === projectId
  })
}
