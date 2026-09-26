import { describe, expect, it } from 'vitest'
import {
  calendarDays,
  daysInMonth,
  payableDates,
  payWindow,
  proRataNote,
  proratedBase,
  monthLabel,
  netPay,
  payrollBankRows,
  computePayrollLine,
  payrollTotals,
  salaryDeduction,
  unpaidLeaveDays,
  workingDates,
  workingDays,
} from './payroll'

describe('working days', () => {
  it('counts every day when there is no weekly off or holiday', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(workingDays(2026, 9, [], [])).toBe(30)
  })

  it('drops Sundays and holidays (a holiday on a Sunday is not counted twice)', () => {
    // September 2026: Sundays are 6, 13, 20, 27.
    expect(workingDays(2026, 9, [0], [])).toBe(26)
    expect(workingDays(2026, 9, [0], ['2026-09-14', '2026-09-20'])).toBe(25)
    const dates = workingDates(2026, 9, [0, 6], [])
    expect(dates[0]).toBe('2026-09-01')
    expect(dates).not.toContain('2026-09-05') // Saturday
    expect(dates).toHaveLength(22)
  })
})

describe('unpaid leave days', () => {
  const working = workingDates(2026, 9, [0], ['2026-09-14'])

  it('counts working days inside the leave, half days as 0.5', () => {
    expect(
      unpaidLeaveDays(
        [
          { start_date: '2026-09-02', end_date: '2026-09-03', half_day: false },
          { start_date: '2026-09-10', end_date: '2026-09-10', half_day: true },
        ],
        working,
      ),
    ).toBe(2.5)
  })

  it('skips the Sunday and the holiday inside a leave, and next month’s part', () => {
    // 12 Sat, 13 Sun (off), 14 holiday, 15 Tue -> 12 and 15 only
    expect(unpaidLeaveDays([{ start_date: '2026-09-12', end_date: '2026-09-15', half_day: false }], working)).toBe(2)
    expect(unpaidLeaveDays([{ start_date: '2026-09-29', end_date: '2026-10-03', half_day: false }], working)).toBe(2)
  })
})

describe('deduction and net pay', () => {
  it('is base ÷ working days × days not paid, rounded to the rupee', () => {
    // 30000 / 26 × 2.5 = 2884.615… -> 2885
    expect(salaryDeduction(30000, 26, 1.5, 1)).toBe(2885)
    // 25000 / 25 × 1 = 1000 exactly
    expect(salaryDeduction(25000, 25, 0, 1)).toBe(1000)
    // half a rupee rounds up
    expect(salaryDeduction(13, 2, 0, 1)).toBe(7)
  })

  it('never deducts more than the base, and nothing without working days', () => {
    expect(salaryDeduction(10000, 20, 15, 10)).toBe(10000)
    expect(salaryDeduction(10000, 0, 1, 0)).toBe(0)
    expect(salaryDeduction(0, 20, 3, 0)).toBe(0)
  })

  it('adds bonuses, takes off advances, never goes below zero', () => {
    expect(netPay({ base: 30000, deduction: 2885, additions: 2000, otherDeductions: 5000 })).toBe(24115)
    expect(netPay({ base: 1000, deduction: 1000, additions: 0, otherDeductions: 500 })).toBe(0)
    expect(computePayrollLine({ base: 30000, workingDays: 26, unpaidLeaveDays: 1.5, absentDays: 1, additions: 500 })).toEqual({
      prorated: 30000,
      deduction: 2885,
      net: 27615,
    })
  })
})

describe('totals and the bank sheet', () => {
  it('splits paid and pending', () => {
    expect(
      payrollTotals([
        { net_pay: 20000, paid_at: '2026-10-01T10:00:00Z' },
        { net_pay: 15000, paid_at: null },
      ]),
    ).toEqual({ net: 35000, paid: 20000, pending: 15000, people: 2 })
  })

  it('writes one row per person with the amount to two decimals', () => {
    expect(
      payrollBankRows([
        { name: 'Priya', upi_id: 'priya@okhdfc', bank_account_name: 'Priya S', bank_account_number: '1234567890', bank_ifsc: 'HDFC0001234', net_pay: 24115, payable_days: 26 },
        { name: 'Aman', upi_id: null, bank_account_name: null, bank_account_number: null, bank_ifsc: null, net_pay: 999.5, payable_days: 19 },
      ]),
    ).toEqual([
      ['Priya', 'Priya S', '1234567890', 'HDFC0001234', 'priya@okhdfc', '24115.00', '26'],
      ['Aman', '', '', '', '', '999.50', '19'],
    ])
    expect(monthLabel(2026, 9)).toBe('September 2026')
  })
})

describe('pro-rata: joining and leaving part-way through the month', () => {
  // September 2026, Sundays off: 26 working days (Sundays are 6, 13, 20, 27).
  const working = workingDates(2026, 9, [0], [])
  const line = (joined: string | null, left: string | null, extra: { unpaid?: number; absent?: number } = {}) => {
    const w = payWindow(2026, 9, joined, left)
    if (!w) return null
    const payable = payableDates(working, w).length
    return {
      window: w,
      payable,
      ...computePayrollLine({ base: 26000, workingDays: working.length, payableDays: payable, unpaidLeaveDays: extra.unpaid ?? 0, absentDays: extra.absent ?? 0 }),
    }
  }

  it('changes nothing for someone who joined before the month and has not left', () => {
    const facts = { base: 30000, workingDays: 26, unpaidLeaveDays: 1.5, absentDays: 1, additions: 500 }
    const w = payWindow(2026, 9, '2021-04-01', null)!
    expect(w).toEqual({ start: '2026-09-01', end: '2026-09-30', joined: false, left: false })
    expect(payableDates(working, w)).toEqual(working)
    const withWindow = computePayrollLine({ ...facts, payableDays: payableDates(working, w).length })
    expect(withWindow).toEqual(computePayrollLine(facts))
    expect(withWindow).toEqual({ prorated: 30000, deduction: 2885, net: 27615 })
    // Paise in the salary stay as they are (no rounding to the rupee for a full month).
    expect(proratedBase(30000.5, 26, 26)).toBe(30000.5)
    // Joining on the 1st, or leaving on the last day, is a full month too.
    expect(payWindow(2026, 9, '2026-09-01', '2026-09-30')).toEqual({ start: '2026-09-01', end: '2026-09-30', joined: false, left: false })
    expect(proRataNote({ pay_year: 2026, pay_month: 9, period_start: '2026-09-01', period_end: '2026-09-30', payable_days: 26, working_days: 26 })).toBeNull()
  })

  it('pays a joiner from the day they joined', () => {
    // 12 Sep (Sat) to 30 Sep: 19 days, minus Sundays 13, 20, 27 -> 16 working days.
    const l = line('2026-09-12', null)!
    expect(l.window).toEqual({ start: '2026-09-12', end: '2026-09-30', joined: true, left: false })
    expect(l.payable).toBe(16)
    expect(l).toMatchObject({ prorated: 16000, deduction: 0, net: 16000 })
    expect(proRataNote({ pay_year: 2026, pay_month: 9, period_start: '2026-09-12', period_end: '2026-09-30', payable_days: 16, working_days: 26 })).toBe(
      'Joined 12 Sep — pro-rated 16/26 days',
    )
  })

  it('pays a leaver up to the day they left', () => {
    // 1 Sep to 20 Sep (Sun): 20 days, minus Sundays 6, 13, 20 -> 17 working days.
    const l = line(null, '2026-09-20')!
    expect(l.payable).toBe(17)
    expect(l).toMatchObject({ prorated: 17000, net: 17000 })
    expect(proRataNote({ pay_year: 2026, pay_month: 9, period_start: '2026-09-01', period_end: '2026-09-20', payable_days: 17, working_days: 26 })).toBe(
      'Left 20 Sep — pro-rated 17/26 days',
    )
  })

  it('pays someone who joined and left in the same month, and only cuts days inside the window', () => {
    // 3 Sep to 16 Sep: 14 days, minus Sundays 6, 13 -> 12 working days.
    const l = line('2026-09-03', '2026-09-16', { unpaid: 1, absent: 1 })!
    expect(l.payable).toBe(12)
    // 26000 × 12 ÷ 26 = 12000; cut 26000 ÷ 26 × 2 = 2000.
    expect(l).toMatchObject({ prorated: 12000, deduction: 2000, net: 10000 })
    expect(proRataNote({ pay_year: 2026, pay_month: 9, period_start: '2026-09-03', period_end: '2026-09-16', payable_days: 12, working_days: 26 })).toBe(
      'Joined 3 Sep · Left 16 Sep — pro-rated 12/26 days',
    )
    // The cut is never more than the pro-rated salary.
    expect(line('2026-09-28', null, { absent: 3 })).toMatchObject({ payable: 3, prorated: 3000, deduction: 3000, net: 0 })
  })

  it('rounds to the rupee', () => {
    // 30000 × 19 ÷ 26 = 21923.07…
    expect(proratedBase(30000, 19, 26)).toBe(21923)
    // 13 × 1 ÷ 2 = 6.5 rounds up, like Postgres.
    expect(proratedBase(13, 1, 2)).toBe(7)
  })

  it('counts weekly offs and holidays inside the window as not payable, and ones outside do not matter', () => {
    const withHolidays = workingDates(2026, 9, [0], ['2026-09-05', '2026-09-15'])
    expect(withHolidays).toHaveLength(24)
    // Joined 10 Sep: the holiday on the 5th is outside the window, the one on the 15th inside.
    const w = payWindow(2026, 9, '2026-09-10', null)!
    const payable = payableDates(withHolidays, w)
    // 10..30 = 21 days, minus Sundays 13, 20, 27 and the 15th -> 17.
    expect(payable).toHaveLength(17)
    expect(payable).not.toContain('2026-09-15')
    expect(computePayrollLine({ base: 24000, workingDays: 24, payableDays: 17, unpaidLeaveDays: 0, absentDays: 0 }).prorated).toBe(17000)
    // Joining on a Sunday is the same as joining on the Monday after.
    expect(payableDates(working, payWindow(2026, 9, '2026-09-13', null)!)).toEqual(payableDates(working, payWindow(2026, 9, '2026-09-14', null)!))
    // A window that only misses off days is a full salary.
    const missesOnlyOffDays = workingDates(2026, 9, [0, 1, 2, 3], [])
    // Sep 2026: 28, 29, 30 are Mon, Tue, Wed -- all off here (Sun-Wed off), so leaving on the 27th loses nothing.
    const w2 = payWindow(2026, 9, null, '2026-09-27')!
    expect(w2.left).toBe(true)
    expect(proratedBase(26000, payableDates(missesOnlyOffDays, w2).length, missesOnlyOffDays.length)).toBe(26000)
  })

  it('gives no line to someone who was not there that month', () => {
    expect(payWindow(2026, 9, '2026-10-01', null)).toBeNull()
    expect(payWindow(2026, 9, null, '2026-08-31')).toBeNull()
    expect(payWindow(2026, 9, '2026-09-20', '2026-09-10')).toBeNull()
    // Joined on the last day: one day, which may not be a working day.
    expect(payableDates(working, payWindow(2026, 9, '2026-09-27', '2026-09-27')!)).toHaveLength(0)
    expect(proratedBase(26000, 0, 26)).toBe(0)
  })

  it('guards a month with no working days: pays by calendar days, never divides by zero', () => {
    const none = workingDates(2026, 9, [0, 1, 2, 3, 4, 5, 6], [])
    expect(none).toHaveLength(0)
    expect(proratedBase(30000, 0, 0)).toBe(30000)
    expect(proratedBase(30000, 0, 0, { windowDays: 30, monthDays: 30 })).toBe(30000)
    expect(proratedBase(30000, 0, 0, { windowDays: calendarDays('2026-09-16', '2026-09-30'), monthDays: 30 })).toBe(15000)
    expect(computePayrollLine({ base: 30000, workingDays: 0, payableDays: 0, calendar: { windowDays: 10, monthDays: 30 }, unpaidLeaveDays: 2, absentDays: 1 })).toEqual({
      prorated: 10000,
      deduction: 0,
      net: 10000,
    })
    expect(calendarDays('2026-09-01', '2026-09-30')).toBe(30)
  })
})
