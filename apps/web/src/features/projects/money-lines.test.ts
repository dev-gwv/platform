import { describe, expect, it } from 'vitest'
import { collectedLine, marginOf, toCollectLine } from './money-lines'

describe('project money lines', () => {
  it('says the share collected', () => {
    expect(collectedLine({ total: 100000, received: 20000 })).toBe('20% collected')
    expect(collectedLine({ total: 0, received: 0 })).toBeUndefined()
  })
  it('says what is to come and what of it is promised', () => {
    expect(toCollectLine({ total: 100000, due: 80000, promised: 10000 })).toBe('80% to come · ₹10,000 promised')
    expect(toCollectLine({ total: 100000, due: 80000, promised: 0 })).toBe('80% to come')
    expect(toCollectLine({ total: 100000, due: 0, promised: 0 })).toBe('All collected')
    expect(toCollectLine({ total: 0, due: 0, promised: 0 })).toBeUndefined()
  })
  it('reads the margin, and says plainly when costs are over', () => {
    expect(marginOf({ income: 100000, profit: 32000, margin: 32 })).toEqual({ value: '32%', sub: 'after crew & expenses', negative: false })
    expect(marginOf({ income: 100000, profit: -5000, margin: -5 })?.negative).toBe(true)
    expect(marginOf({ income: 0, profit: 0, margin: null })?.value).toBe('—')
    expect(marginOf(null)).toBeNull()
  })
})
