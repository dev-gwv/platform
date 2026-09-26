import { describe, expect, it } from 'vitest'
import { fromIso, niceDate, parseTyped, quickDates, toIso } from './date-field'

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

  it('offers today, tomorrow and the coming weekend, in date order', () => {
    // A Wednesday: the weekend is three and four days out.
    const wed = new Date(2026, 8, 23)
    expect(quickDates(wed).map((q) => [q.label, q.iso])).toEqual([
      ['Today', '2026-09-23'],
      ['Tomorrow', '2026-09-24'],
      [expect.stringMatching(/^Sat 26 Sept?$/), '2026-09-26'],
      [expect.stringMatching(/^Sun 27 Sept?$/), '2026-09-27'],
    ])
  })

  it('never lists the same day twice', () => {
    // On a Friday tomorrow is Saturday, so the weekend chips skip to next week's Saturday.
    const fri = new Date(2026, 8, 25)
    const isos = quickDates(fri).map((q) => q.iso)
    expect(new Set(isos).size).toBe(isos.length)
    expect(isos).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-10-03'])
  })

  it('greys out chips outside min and max instead of hiding them', () => {
    const wed = new Date(2026, 8, 23)
    const chips = quickDates(wed, new Date(2026, 8, 24))
    expect(chips.find((q) => q.label === 'Today')?.ok).toBe(false)
    expect(chips.find((q) => q.label === 'Tomorrow')?.ok).toBe(true)
  })
})
