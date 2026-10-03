import { formatINR } from '@/shared/ui/format'

/**
 * Hide amounts: one switch, per person, that turns every rupee on the
 * studio's own screens into "₹ ••••" -- for a phone held up in front of a
 * client or the team. It lives in `users.hints.hide_amounts` (closed = hidden)
 * so it follows the person to every device; this module holds the live value
 * for the page.
 *
 * Documents (quotation, invoice, receipt, payslip, terms), public pages and
 * the messages sent to clients always use `formatINR` and are never masked.
 */
export const MASK = '₹ ••••'

let hidden = false
const listeners = new Set<() => void>()

export function amountsHidden(): boolean {
  return hidden
}

export function setAmountsHidden(next: boolean): void {
  if (next === hidden) return
  hidden = next
  for (const l of listeners) l()
}

export function subscribeAmounts(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Rupees as the studio's screens show them: masked while amounts are hidden. */
export function screenINR(amount: number, isHidden: boolean = hidden): string {
  return isHidden ? MASK : formatINR(amount)
}
