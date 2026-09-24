/**
 * How an invoice stands, in the words and colour a studio uses: paid, part
 * paid, overdue, sent, draft or cancelled. "Overdue" is not a stored status --
 * it is a sent invoice with money still owed after its due date.
 */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

interface InvoiceLike {
  status: string
  balance_due: number
  due_date: string | null
}

const today = () => new Date().toISOString().slice(0, 10)

export function isOverdue(inv: InvoiceLike, on = today()): boolean {
  return inv.balance_due > 0 && inv.status !== 'cancelled' && inv.status !== 'draft' && !!inv.due_date && inv.due_date < on
}

export function invoiceBadge(inv: InvoiceLike, on = today()): { label: string; tone: Tone } {
  if (inv.status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' }
  if (inv.status === 'paid' || (inv.balance_due <= 0 && inv.status !== 'draft')) return { label: 'Paid', tone: 'success' }
  if (isOverdue(inv, on)) return { label: 'Overdue', tone: 'danger' }
  if (inv.status === 'partial') return { label: 'Part paid', tone: 'warning' }
  if (inv.status === 'draft') return { label: 'Draft', tone: 'neutral' }
  return { label: 'Sent', tone: 'info' }
}

const DAY = 86_400_000

/** "Due in 3 days", "Due today", "12 days late", or null when there is nothing to say. */
export function dueText(inv: InvoiceLike, on = today()): string | null {
  if (!inv.due_date || inv.balance_due <= 0 || inv.status === 'cancelled') return null
  const days = Math.round((Date.parse(`${inv.due_date}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / DAY)
  if (days === 0) return 'Due today'
  if (days > 0) return days === 1 ? 'Due tomorrow' : `Due in ${days} days`
  return -days === 1 ? '1 day late' : `${-days} days late`
}

/** "12 Sep 2026" from an ISO date. */
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
