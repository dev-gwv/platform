import { describe, expect, it } from 'vitest'
import { fromIso, niceDate, parseTyped, toIso } from './date-field'

describe('date field helpers', () => {
  it('round-trips ISO dates in local time', () => {
    expect(toIso(fromIso('2026-09-24')!)).toBe('2026-09-24')
    expect(fromIso('2026-02-30')?.getMonth()).toBe(2) // JS rolls it; parseTyped is the strict one
    expect(fromIso('')).toBeUndefined()
    expect(fromIso('24/09/2026')).toBeUndefined()
  })

  it('reads a typed date day-first, the Indian way', () => {
    const now = new Date(2026, 8, 24)
    expect(parseTyped('24/09/2026', now)).toBe('2026-09-24')
    expect(parseTyped('3-1-27', now)).toBe('2027-01-03')
    expect(parseTyped('5.12.2026', now)).toBe('2026-12-05')
    expect(parseTyped('31/02/2026', now)).toBeNull()
    expect(parseTyped('2026-09-24', now)).toBeNull()
    expect(parseTyped('hello', now)).toBeNull()
  })

  it('says the date the way a person does', () => {
    expect(niceDate('2026-09-24')).toMatch(/^Thu, 24 Sept? 2026$/)
    expect(niceDate('nope')).toBe('nope')
  })
})
