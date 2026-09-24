/**
 * The periods a studio actually reads its books by. India's financial year
 * runs April to March, and so do its quarters: Q1 is April-June.
 */
export type PeriodKey = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_fy' | 'last_fy' | 'custom'

export interface Period {
  key: PeriodKey
  from: string
  to: string
  label: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
const monthName = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

/** The first month (0-based) of the financial year a date falls in, and that year. */
function fyStart(d: Date): { y: number; m: number } {
  return d.getMonth() >= 3 ? { y: d.getFullYear(), m: 3 } : { y: d.getFullYear() - 1, m: 3 }
}

export const PERIOD_LABEL: Record<Exclude<PeriodKey, 'custom'>, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
}

export function periodFor(key: Exclude<PeriodKey, 'custom'>, today = new Date()): Period {
  const y = today.getFullYear()
  const m = today.getMonth()
  switch (key) {
    case 'this_month':
      return { key, from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)), label: monthName(y, m) }
    case 'last_month': {
      const d = new Date(y, m - 1, 1)
      const [ly, lm] = [d.getFullYear(), d.getMonth()]
      return { key, from: iso(ly, lm, 1), to: iso(ly, lm, lastDay(ly, lm)), label: monthName(ly, lm) }
    }
    case 'this_quarter':
    case 'last_quarter': {
      // Quarters of the April-March year: Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar.
      const start = new Date(y, m - ((m - 3 + 12) % 3), 1)
      if (key === 'last_quarter') start.setMonth(start.getMonth() - 3)
      const end = new Date(start.getFullYear(), start.getMonth() + 3, 0)
      const q = Math.floor(((start.getMonth() - 3 + 12) % 12) / 3) + 1
      const fy = fyStart(start)
      return {
        key,
        from: iso(start.getFullYear(), start.getMonth(), 1),
        to: iso(end.getFullYear(), end.getMonth(), end.getDate()),
        label: `Q${q} FY ${fy.y}-${String(fy.y + 1).slice(2)}`,
      }
    }
    case 'this_fy':
    case 'last_fy': {
      const s = fyStart(today)
      const sy = key === 'this_fy' ? s.y : s.y - 1
      return { key, from: iso(sy, 3, 1), to: iso(sy + 1, 2, 31), label: `FY ${sy}-${String(sy + 1).slice(2)}` }
    }
  }
}

/** "1 Jun – 30 Jun 2026" for a custom range. */
export function rangeLabel(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00`)
  const t = new Date(`${to}T00:00:00`)
  const sameYear = f.getFullYear() === t.getFullYear()
  const a = f.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
  const b = t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${a} – ${b}`
}
