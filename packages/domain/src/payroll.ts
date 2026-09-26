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

/** Rupees, whole: base ÷ working days × days not paid for, never above the base. */
export function salaryDeduction(base: number, working: number, unpaidLeave: number, absent: number): number {
  if (base <= 0 || working <= 0) return 0
  const days = Math.max(0, unpaidLeave) + Math.max(0, absent)
  if (days <= 0) return 0
  // A hair of epsilon so 0.5 in binary float still rounds up, like Postgres.
  const raw = Math.round((base * days) / working + 1e-9)
  return Math.min(base, raw)
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
  unpaidLeaveDays: number
  absentDays: number
  additions?: number
  otherDeductions?: number
}

/** One person's month, start to finish. */
export function computePayrollLine(f: PayrollLineFacts): { deduction: number; net: number } {
  const deduction = salaryDeduction(f.base, f.workingDays, f.unpaidLeaveDays, f.absentDays)
  return {
    deduction,
    net: netPay({ base: f.base, deduction, additions: f.additions ?? 0, otherDeductions: f.otherDeductions ?? 0 }),
  }
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
}

export const PAYROLL_BANK_HEADERS = ['Name', 'Account holder', 'Account number', 'IFSC', 'UPI ID', 'Amount'] as const

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
  ])
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export const monthLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1] ?? ''} ${year}`
