import { screenINR } from '@/shared/money/hide'

/**
 * The plain line under each money figure at the top of a project, so a
 * number says what share it is: "20% collected", "80% to come · 10% promised",
 * "32% margin".
 */

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

export function collectedLine(m: { total: number; received: number }): string | undefined {
  if (!(m.total > 0)) return undefined
  return `${Math.min(100, pctOf(m.received, m.total))}% collected`
}

export function toCollectLine(m: { total: number; due: number; promised: number }): string | undefined {
  if (!(m.total > 0) || m.due <= 0) return m.total > 0 ? 'All collected' : undefined
  const promised = Math.min(m.promised, m.due)
  return promised > 0 ? `${pctOf(m.due, m.total)}% to come · ${screenINR(promised)} promised` : `${pctOf(m.due, m.total)}% to come`
}

/** The margin tile, from the same booked profit as Billing > Profit & Loss. */
export function marginOf(f: { income: number; profit: number; margin?: number | null | undefined } | null | undefined): {
  value: string
  sub: string
  negative: boolean
} | null {
  if (!f) return null
  if (!(f.income > 0)) return { value: '—', sub: 'No value set yet', negative: false }
  const m = f.margin != null ? Math.round(f.margin) : pctOf(f.profit, f.income)
  return { value: `${m}%`, sub: f.profit < 0 ? 'Costs are over the value' : 'after crew & expenses', negative: f.profit < 0 }
}
