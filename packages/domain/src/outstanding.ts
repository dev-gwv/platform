import { roundINR } from './money'

/** An invoice on the project that is live (not a draft, not cancelled). */
export interface OutstandingInvoice {
  /** The invoice total, GST included. */
  total: number
  /** The GST on it. */
  tax: number
  /** What is still unpaid on it. */
  balance: number
}

/**
 * What a project still owes -- the one rule every screen, document and the
 * database (`project_outstanding()`, 0315) use.
 *
 * The project's value is before GST; money received includes the GST on the
 * invoices it paid. So "value - received" under-counts by that GST (₹1,00,000
 * project, a ₹50,000 + 18% invoice paid: ₹41,000 "left" while ₹50,000 is still
 * to bill). Instead:
 *
 *   open invoice balances (GST included)
 * + the part of the value no invoice covers yet, less money received that
 *   sits on no invoice.
 *
 * With no invoices it is max(0, value - received); without GST it equals the
 * older max(0, value - received, open invoice balances) that Home and
 * Payments used, and it is never below that rule.
 */
export function projectOutstanding(input: {
  value: number
  received: number
  invoices?: ReadonlyArray<OutstandingInvoice>
}): number {
  const invoices = input.invoices ?? []
  const open = invoices.reduce((n, i) => n + Math.max(0, i.balance), 0)
  const invoiced = invoices.reduce((n, i) => n + i.total, 0)
  const invoicedBeforeGst = invoices.reduce((n, i) => n + i.total - i.tax, 0)
  // Money in that is not on any invoice (an advance, a part payment).
  const paidOnInvoices = invoiced - open
  const loose = Math.max(0, input.received - paidOnInvoices)
  const notInvoiced = Math.max(0, input.value - invoicedBeforeGst - loose)
  return roundINR(Math.max(0, open + notInvoiced))
}
