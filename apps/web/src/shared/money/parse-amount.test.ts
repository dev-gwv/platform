import { describe, expect, it } from 'vitest'
import { parseAmount } from './parse-amount'

describe('parseAmount', () => {
  it('reads amounts typed the Indian way', () => {
    expect(parseAmount('1,50,000')).toBe(150000)
    expect(parseAmount('₹ 15,000')).toBe(15000)
    expect(parseAmount('2500.50')).toBe(2500.5)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount('12.')).toBe(12)
    expect(parseAmount('abc')).toBe(0)
    expect(parseAmount(undefined)).toBe(0)
  })
})
