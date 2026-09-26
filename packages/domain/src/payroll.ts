/**
 * Monthly payroll: the arithmetic behind "pay everyone this month".
 *
 * The database does the counting (who was present, on unpaid leave, absent)
 * in `payroll_generate()` and applies the same formula written here; the
 * screen uses these to show the net pay change while an addition or a
 * deduction is typed, and the DB test checks both sides agree.
 *
 *   working days  = days in the month − weekly off days − holidays
 *   deduction     = round(base ÷ working days × (unpaid leave days + absent days))
 *                   never more than the base
 *   net pay       = base − deduction + additions − other deductions, never below 0
 *
 * Someone who joins or leaves part-way through the month (0188) is paid for
 * the working days they were with the studio:
 *
 *   payable days   = working days of the month between joining and leaving
 *   pro-rated base = round(base × payable days ÷ working days)
 *                    (the full base when every working day is covered)
 *   deduction      = as above, counting only days inside that window,
 *                    never more than the pro-rated base
 *   net pay        = pro-rated base − deduction + additions − other deductions
 *
 * A month with no working days pays by calendar days instead. Everyone else
 * (joined before the month, not left) is paid exactly as before.
 *
 * Lateness is shown, never deducted.
 */

/** "YYYY-MM-DD" for a calendar day, without time zones getting involved. */
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * The days someone is expected in: every day of the month except the weekly
 * off days (0 = Sunday … 6 = Saturday) and the studio's holidays.
 */
export function workingDates(year: number, month: number, weeklyOff: readonly number[], holidays: readonly string[]): string[] {
  const off = new Set(weeklyOff)
  const hol = new Set(holidays)
  const out: string[] = []
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay()
    const day = iso(year, month, d)
    if (!off.has(dow) && !hol.has(day)) out.push(day)
  }
  return out
}

export function workingDays(year: number, month: number, weeklyOff: readonly number[], holidays: readonly string[]): number {
  return workingDates(year, month, weeklyOff, holidays).length
}

export interface LeaveSpan {
  start_date: string
  end_date: string
  half_day: boolean
}

/**
 * Unpaid leave days that fall on working days of the month. A half day
 * counts 0.5; a leave that spills into the next month counts only this
 * month's part; a weekly off or a holiday inside a leave is not a leave day.
 */
export function unpaidLeaveDays(leave: readonly LeaveSpan[], working: readonly string[]): number {
  const set = new Set(working)
  let days = 0
  for (const l of leave) {
    for (const d of set) {
      if (d >= l.start_date && d <= l.end_date) days += l.half_day ? 0.5 : 1
    }
  }
  return days
}

/**
 * Rupees, whole: base ÷ working days × days not paid for, never above the
 * cap (the base, or the pro-rated base for part of a month).
 */
export function salaryDeduction(base: number, working: number, unpaidLeave: number, absent: number, cap = base): number {
  if (base <= 0 || working <= 0) return 0
  const days = Math.max(0, unpaidLeave) + Math.max(0, absent)
  if (days <= 0) return 0
  // A hair of epsilon so 0.5 in binary float still rounds up, like Postgres.
  const raw = Math.round((base * days) / working + 1e-9)
  return Math.min(cap, raw)
}

export interface PayWindow {
  /** First day paid for, inside the month ("YYYY-MM-DD"). */
  start: string
  /** Last day paid for, inside the month. */
  end: string
  /** Joined after the 1st. */
  joined: boolean
  /** Left before the last day. */
  left: boolean
}

/**
 * The days of the month someone was with the studio: from joining to
 * leaving, clamped to the month. Null when they were not there at all.
 */
export function payWindow(year: number, month: number, joinedOn: string | null, leftOn: string | null): PayWindow | null {
  const first = iso(year, month, 1)
  const last = iso(year, month, daysInMonth(year, month))
  const start = joinedOn && joinedOn > first ? joinedOn : first
  const end = leftOn && leftOn < last ? leftOn : last
  if (start > end) return null
  return { start, end, joined: start > first, left: end < last }
}

/** The working days that fall inside the window. */
export function payableDates(working: readonly string[], window: Pick<PayWindow, 'start' | 'end'>): string[] {
  return working.filter((d) => d >= window.start && d <= window.end)
}

/** Whole days from start to end, both counted. */
export function calendarDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
}

/**
 * The salary for part of a month: base × payable days ÷ working days, to
 * the rupee. The full base when every working day is covered. A month with
 * no working days at all pays by calendar days (window ÷ month) instead.
 */
export function proratedBase(
  base: number,
  payable: number,
  working: number,
  calendar?: { windowDays: number; monthDays: number },
): number {
  if (base <= 0) return 0
  if (working <= 0) {
    if (!calendar || calendar.windowDays >= calendar.monthDays) return base
    return Math.round((base * Math.max(0, calendar.windowDays)) / calendar.monthDays + 1e-9)
  }
  if (payable >= working) return base
  return Math.round((base * Math.max(0, payable)) / working + 1e-9)
}

export interface PayLineInput {
  base: number
  deduction: number
  additions: number
  otherDeductions: number
}

export function netPay({ base, deduction, additions, otherDeductions }: PayLineInput): number {
  const n = base - deduction + additions - otherDeductions
  return Math.max(0, Math.round(n * 100) / 100)
}

export interface PayrollLineFacts {
  base: number
  workingDays: number
  /** Working days inside the joining–leaving window; leave out for the whole month. */
  payableDays?: number
  /** Only for a month with no working days: the window and the month, in calendar days. */
  calendar?: { windowDays: number; monthDays: number }
  /** Counted inside the window only. */
  unpaidLeaveDays: number
  absentDays: number
  additions?: number
  otherDeductions?: number
}

/** One person's month, start to finish. */
export function computePayrollLine(f: PayrollLineFacts): { prorated: number; deduction: number; net: number } {
  const prorated = proratedBase(f.base, f.payableDays ?? f.workingDays, f.workingDays, f.calendar)
  const deduction = salaryDeduction(f.base, f.workingDays, f.unpaidLeaveDays, f.absentDays, prorated)
  return {
    prorated,
    deduction,
    net: netPay({ base: prorated, deduction, additions: f.additions ?? 0, otherDeductions: f.otherDeductions ?? 0 }),
  }
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** "12 Sep" from "2026-09-12". */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${d} ${SHORT_MONTHS[(m ?? 1) - 1] ?? ''}`
}

export interface ProRataLine {
  pay_year: number
  pay_month: number
  period_start: string
  period_end: string
  payable_days: number
  working_days: number
}

/**
 * The one-line reason a salary is part of a month -- "Joined 12 Sep —
 * pro-rated 19/26 days" -- or null for a full month.
 */
export function proRataNote(l: ProRataLine): string | null {
  const first = iso(l.pay_year, l.pay_month, 1)
  const last = iso(l.pay_year, l.pay_month, daysInMonth(l.pay_year, l.pay_month))
  const parts: string[] = []
  if (l.period_start > first) parts.push(`Joined ${shortDay(l.period_start)}`)
  if (l.period_end < last) parts.push(`Left ${shortDay(l.period_end)}`)
  if (parts.length === 0) return null
  return `${parts.join(' · ')} — pro-rated ${l.payable_days}/${l.working_days} days`
}

export interface PayrollTotals {
  net: number
  paid: number
  pending: number
  people: number
}

export function payrollTotals(lines: readonly { net_pay: number; paid_at: string | null }[]): PayrollTotals {
  let net = 0
  let paid = 0
  for (const l of lines) {
    net += l.net_pay
    if (l.paid_at) paid += l.net_pay
  }
  return { net, paid, pending: Math.max(0, net - paid), people: lines.length }
}

export interface BankRowInput {
  name: string
  upi_id: string | null
  bank_account_name: string | null
  bank_account_number: string | null
  bank_ifsc: string | null
  net_pay: number
  payable_days: number
}

export const PAYROLL_BANK_HEADERS = ['Name', 'Account holder', 'Account number', 'IFSC', 'UPI ID', 'Amount', 'Payable days'] as const

/**
 * Rows for a bank's bulk-transfer sheet: who, where, how much. A blank
 * account or UPI stays blank so the gap is visible in the sheet, not hidden.
 */
export function payrollBankRows(rows: readonly BankRowInput[]): string[][] {
  return rows.map((r) => [
    r.name,
    r.bank_account_name ?? '',
    r.bank_account_number ?? '',
    r.bank_ifsc ?? '',
    r.upi_id ?? '',
    r.net_pay.toFixed(2),
    String(r.payable_days),
  ])
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export const monthLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1] ?? ''} ${year}`
