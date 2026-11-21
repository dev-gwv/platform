import { describe, expect, it } from 'vitest'
import { projectOutstanding } from './outstanding'

/** The rule Home and Payments used before 0315; the new one is never below it. */
const older = (value: number, received: number, open: number) => Math.max(0, value - received, open)

describe('projectOutstanding', () => {
  it('is value less money in when nothing is invoiced', () => {
    expect(projectOutstanding({ value: 100_000, received: 30_000 })).toBe(70_000)
    expect(projectOutstanding({ value: 100_000, received: 0 })).toBe(100_000)
    expect(projectOutstanding({ value: 100_000, received: 120_000 })).toBe(0)
  })

  it('does not let GST paid on an invoice count against the value (the audit example)', () => {
    // ₹1,00,000 project, a ₹50,000 + 18% invoice paid in full.
    const invoices = [{ total: 59_000, tax: 9_000, balance: 0 }]
    expect(projectOutstanding({ value: 100_000, received: 59_000, invoices })).toBe(50_000)
    expect(older(100_000, 59_000, 0)).toBe(41_000)
  })

  it('counts the GST of an open invoice', () => {
    const invoices = [{ total: 59_000, tax: 9_000, balance: 59_000 }]
    expect(projectOutstanding({ value: 100_000, received: 0, invoices })).toBe(109_000)
  })

  it('takes an advance on no invoice off the part not yet invoiced', () => {
    const invoices = [{ total: 59_000, tax: 9_000, balance: 59_000 }]
    expect(projectOutstanding({ value: 100_000, received: 20_000, invoices })).toBe(89_000)
  })

  it('takes an advance attached to the invoice off that invoice only', () => {
    // The whole value invoiced with GST, ₹30,000 advance attached to it.
    const invoices = [{ total: 118_000, tax: 18_000, balance: 88_000 }]
    expect(projectOutstanding({ value: 100_000, received: 30_000, invoices })).toBe(88_000)
  })

  it('owes an invoice balance even when the value is paid (6 Nov bug sweep)', () => {
    const invoices = [{ total: 118_000, tax: 18_000, balance: 18_000 }]
    expect(projectOutstanding({ value: 100_000, received: 100_000, invoices })).toBe(18_000)
  })

  it('is zero when an invoice for more than the value is paid', () => {
    const invoices = [{ total: 120_000, tax: 0, balance: 0 }]
    expect(projectOutstanding({ value: 100_000, received: 120_000, invoices })).toBe(0)
  })

  it('equals the older rule without GST and is never below it', () => {
    const cases: Array<[number, number, Array<{ total: number; tax: number; balance: number }>]> = [
      [100_000, 0, [{ total: 50_000, tax: 0, balance: 50_000 }]],
      [100_000, 50_000, [{ total: 50_000, tax: 0, balance: 0 }]],
      [100_000, 10_000, [{ total: 40_000, tax: 0, balance: 40_000 }]],
    ]
    for (const [value, received, invoices] of cases) {
      const open = invoices.reduce((n, i) => n + i.balance, 0)
      expect(projectOutstanding({ value, received, invoices })).toBe(older(value, received, open))
    }
    const gst = [{ total: 59_000, tax: 9_000, balance: 29_000 }]
    expect(projectOutstanding({ value: 100_000, received: 30_000, invoices: gst })).toBeGreaterThanOrEqual(older(100_000, 30_000, 29_000))
  })
})
