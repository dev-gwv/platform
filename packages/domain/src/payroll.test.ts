import { describe, expect, it } from 'vitest'
import {
  daysInMonth,
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
        { name: 'Priya', upi_id: 'priya@okhdfc', bank_account_name: 'Priya S', bank_account_number: '1234567890', bank_ifsc: 'HDFC0001234', net_pay: 24115 },
        { name: 'Aman', upi_id: null, bank_account_name: null, bank_account_number: null, bank_ifsc: null, net_pay: 999.5 },
      ]),
    ).toEqual([
      ['Priya', 'Priya S', '1234567890', 'HDFC0001234', 'priya@okhdfc', '24115.00'],
      ['Aman', '', '', '', '', '999.50'],
    ])
    expect(monthLabel(2026, 9)).toBe('September 2026')
  })
})
