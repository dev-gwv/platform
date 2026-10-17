import { describe, expect, it } from 'vitest'
import { computeInvoice, lineMeasure, rateUnit } from './invoice'
import { amountInWords } from './amount-in-words'

describe('computeInvoice', () => {
  const lines = [
    { description: 'Photography', quantity: 1, rate: 100000, gst_rate: 18 as const },
    { description: 'Album', quantity: 2, rate: 10000, gst_rate: 12 as const },
  ]

  it('intra-state splits CGST/SGST, no discount', () => {
    const inv = computeInvoice(lines, { intraState: true })
    expect(inv.subtotal).toBe(120000)
    // 100000@18 -> 18000 (9+9k); 20000@12 -> 2400 (1.2+1.2k)
    expect(inv.tax).toBe(20400)
    expect(inv.total).toBe(140400)
    expect(inv.lines[0]!.cgst).toBe(9000)
    expect(inv.lines[0]!.sgst).toBe(9000)
    expect(inv.lines[0]!.igst).toBe(0)
  })

  it('inter-state uses IGST', () => {
    const inv = computeInvoice(lines, { intraState: false })
    expect(inv.lines[0]!.igst).toBe(18000)
    expect(inv.lines[0]!.cgst).toBe(0)
    expect(inv.total).toBe(140400)
  })

  it('applies discount proportionally before tax', () => {
    const inv = computeInvoice(lines, { intraState: true, discount: 12000 }) // 10% off
    expect(inv.discount).toBe(12000)
    expect(inv.taxable).toBe(108000) // 120000 - 12000
    // tax scales by 0.9 -> 18360
    expect(inv.tax).toBe(18360)
    expect(inv.total).toBe(126360)
  })

  it('caps discount at subtotal', () => {
    const inv = computeInvoice(lines, { intraState: true, discount: 999999 })
    expect(inv.discount).toBe(120000)
    expect(inv.taxable).toBe(0)
    expect(inv.total).toBe(0)
  })

  it('reads a percent discount off the subtotal, and persists it as the flat figure it resolves to', () => {
    const inv = computeInvoice(lines, { intraState: true, discount: 10, discountType: 'percent' })
    expect(inv.discount).toBe(12000) // 10% of 120000 -- same flat amount as the test above
    expect(inv.total).toBe(126360)
  })

  it('caps a percent discount over 100% at the subtotal, same as a flat one', () => {
    const inv = computeInvoice(lines, { intraState: true, discount: 150, discountType: 'percent' })
    expect(inv.discount).toBe(120000)
    expect(inv.total).toBe(0)
  })

  it('omitting discountType still means a flat amount, unchanged from before this option existed', () => {
    const inv = computeInvoice(lines, { intraState: true, discount: 12000 })
    expect(inv.discount).toBe(12000)
  })
})

describe('amountInWords (Indian)', () => {
  it('formats lakhs and crores', () => {
    expect(amountInWords(123456)).toBe(
      'One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees',
    )
    expect(amountInWords(10000000)).toBe('One Crore Rupees')
    expect(amountInWords(0)).toBe('Zero Rupees')
    expect(amountInWords(140400)).toBe('One Lakh Forty Thousand Four Hundred Rupees')
  })
})

describe('a line counted in a unit, for some days', () => {
  it('multiplies by the days: an LED screen of 96 sq ft at ₹60 for 3 days is ₹17,280', () => {
    const inv = computeInvoice([{ description: 'LED Screen', quantity: 96, unit: 'sq ft', rate: 60, days: 3, gst_rate: 18 }], { intraState: true })
    expect(inv.subtotal).toBe(17280)
    expect(inv.tax).toBe(3110.4)
    expect(inv.total).toBe(20390.4)
  })

  it('treats empty or zero days as one', () => {
    const one = computeInvoice([{ description: 'x', quantity: 2, rate: 100, gst_rate: 0 }], { intraState: true })
    const zero = computeInvoice([{ description: 'x', quantity: 2, rate: 100, days: 0, gst_rate: 0 }], { intraState: true })
    expect(one.subtotal).toBe(200)
    expect(zero.subtotal).toBe(200)
  })

  it('says how the line is counted', () => {
    expect(lineMeasure({ quantity: 96, unit: 'sq ft', days: 3 })).toBe('96 sq ft × 3 days')
    expect(lineMeasure({ quantity: 1, days: 1 })).toBe('1 × 1 day')
    expect(lineMeasure({ quantity: 2.5, unit: 'hours' })).toBe('2.5 hours')
    expect(lineMeasure({ quantity: 1 })).toBe('1')
    expect(rateUnit({ unit: 'sq ft', days: 3 })).toBe('per sq ft per day')
    expect(rateUnit({ days: 2 })).toBe('per day')
    expect(rateUnit({})).toBe('')
  })
})
