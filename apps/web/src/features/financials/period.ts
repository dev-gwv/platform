/**
 * The periods a studio actually reads its books by. India's financial year
 * runs April to March, and so do its quarters: Q1 is April-June.
 */
export type PeriodKey = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_fy' | 'last_fy' | 'custom'

interface Period {
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

const PERIOD_LABEL: Record<Exclude<PeriodKey, 'custom'>, string> = {
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

/**
 * What the money pages' period switch can hold: a preset, All time, or a
 * custom range. One choice is shared by Invoices, Payments received,
 * Expenses, Profit & Loss and Reports (`?period=`, remembered per studio).
 */
export type PeriodChoice = Exclude<PeriodKey, 'custom'> | 'all' | 'custom'

export const PERIOD_CHOICES: readonly Exclude<PeriodChoice, 'custom'>[] = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_fy',
  'last_fy',
  'all',
]

export function parsePeriodChoice(v: string | null | undefined): PeriodChoice | null {
  if (!v) return null
  if (v === 'all' || v === 'custom') return v
  return v in PERIOD_LABEL ? (v as PeriodChoice) : null
}

export function choiceLabel(c: Exclude<PeriodChoice, 'custom'>): string {
  return c === 'all' ? 'All time' : PERIOD_LABEL[c]
}

/** The dates a choice covers. All time is the widest range the books can hold. */
export function resolvePeriod(
  choice: PeriodChoice,
  custom: { from: string; to: string },
  today = new Date(),
): { from: string; to: string; label: string } {
  if (choice === 'all') return { from: '2000-01-01', to: '2099-12-31', label: 'All time' }
  if (choice === 'custom') {
    if (custom.from && custom.to) return { ...custom, label: rangeLabel(custom.from, custom.to) }
    const p = periodFor('this_month', today)
    return { from: custom.from || p.from, to: custom.to || p.to, label: 'Pick the dates' }
  }
  return periodFor(choice, today)
}
