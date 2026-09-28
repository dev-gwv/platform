import { dueText, isOverdue } from './status'

/**
 * What on a project's money needs a look, in words, each with the one thing
 * that fixes it. The Billing tab shows the first two.
 *
 * The case behind this: a ₹50,000 payment recorded on the project but not
 * against its invoice leaves the invoice saying ₹1,50,000 unpaid while the
 * project says ₹50,000 received -- two true numbers that read as a
 * contradiction, with nothing on screen saying why.
 */
export interface MoneyInvoice {
  id: string
  invoice_number: string
  status: string
  due_date: string | null
  total: number
  taxable: number
  balance_due: number
}

export interface MoneyPayment {
  id: string
  amount: number
  status?: string | null | undefined
  invoice_id?: string | null | undefined
}

export type MoneyCheck =
  | { kind: 'unlinked'; paymentId: string; amount: number; invoiceId: string; invoiceNumber: string }
  | { kind: 'over_invoiced'; invoiced: number; agreed: number; invoiceId: string; invoiceNumber: string }
  | { kind: 'overdue'; invoiceId: string; invoiceNumber: string; balance: number; late: string }

const live = (i: MoneyInvoice) => i.status !== 'draft' && i.status !== 'cancelled'

export function projectMoneyChecks(
  agreed: number,
  invoices: readonly MoneyInvoice[],
  payments: readonly MoneyPayment[],
  today?: string,
): MoneyCheck[] {
  const out: MoneyCheck[] = []
  const open = invoices.filter((i) => live(i) && i.balance_due > 0)

  // Received money not against any invoice, while an invoice still waits for
  // it: the biggest such payment, on the oldest invoice it fits.
  const loose = payments
    .filter((p) => (p.status ?? 'paid') !== 'pending' && !p.invoice_id)
    .sort((a, b) => b.amount - a.amount)
  for (const p of loose) {
    const inv = open.find((i) => i.balance_due >= p.amount - 0.5)
    if (inv) {
      out.push({ kind: 'unlinked', paymentId: p.id, amount: p.amount, invoiceId: inv.id, invoiceNumber: inv.invoice_number })
      break
    }
  }

  // Invoices (before GST) adding up to more than the project is worth.
  const billed = invoices.filter(live)
  const invoiced = billed.reduce((n, i) => n + i.taxable, 0)
  if (agreed > 0 && invoiced > agreed + 0.5) {
    const last = [...billed].sort((a, b) => b.taxable - a.taxable)[0]!
    out.push({ kind: 'over_invoiced', invoiced, agreed, invoiceId: last.id, invoiceNumber: last.invoice_number })
  }

  for (const i of open) {
    if (isOverdue(i, today)) {
      out.push({ kind: 'overdue', invoiceId: i.id, invoiceNumber: i.invoice_number, balance: i.balance_due, late: dueText(i, today) ?? 'late' })
      break
    }
  }
  return out
}
