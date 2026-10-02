import { describe, expect, it } from 'vitest'
import { leftToPayLine } from './left-to-pay'

const base = { due: 100000, amount: 40000, received: true, editing: false, today: '2026-10-02' }

describe('leftToPayLine', () => {
  it('says what is left and when it stays due', () => {
    expect(leftToPayLine({ ...base, dueOn: '2027-01-05' })).toBe('₹60,000 is left. It stays due on 5 Jan.')
  })
  it('says it was due when the date has passed', () => {
    expect(leftToPayLine({ ...base, dueOn: '2026-09-20' })).toBe('₹60,000 is left. It was due on 20 Sept.')
  })
  it('has no date to give without one', () => {
    expect(leftToPayLine(base)).toBe('₹60,000 is left to collect.')
  })
  it('says nothing for a promise, an edit, or a payment that clears it', () => {
    expect(leftToPayLine({ ...base, received: false })).toBeNull()
    expect(leftToPayLine({ ...base, editing: true })).toBeNull()
    expect(leftToPayLine({ ...base, amount: 100000 })).toBeNull()
    expect(leftToPayLine({ ...base, amount: 0 })).toBeNull()
    expect(leftToPayLine({ ...base, due: 0 })).toBeNull()
  })
})
