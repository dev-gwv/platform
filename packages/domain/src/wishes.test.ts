import { describe, expect, it } from 'vitest'
import { coupleName, daysUntil, nextOccurrence, ordinal, sortBySoonest, whenWords, wishWords, yearsOn } from './wishes'

describe('wishes', () => {
  it('finds the next time a day comes round, 29 Feb on 28 Feb', () => {
    expect(nextOccurrence({ month: 3, day: 14 }, '2026-10-03')).toBe('2027-03-14')
    expect(nextOccurrence({ month: 10, day: 3 }, '2026-10-03')).toBe('2026-10-03')
    expect(nextOccurrence({ month: 2, day: 29 }, '2026-10-03')).toBe('2027-02-28')
    expect(nextOccurrence({ month: 2, day: 29 }, '2027-10-03')).toBe('2028-02-29')
  })

  it('says when in plain words', () => {
    expect(daysUntil('2026-10-08', '2026-10-03')).toBe(5)
    expect([whenWords(0), whenWords(1), whenWords(5)]).toEqual(['Today', 'Tomorrow', 'In 5 days'])
  })

  it('counts the years and writes them as people say them', () => {
    expect(yearsOn({ year: 2026 }, '2027-12-12')).toBe(1)
    expect(yearsOn({ year: null }, '2027-12-12')).toBeNull()
    expect(yearsOn({ year: 2027 }, '2027-12-12')).toBeNull()
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 25, 101, 111].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '25th', '101st', '111th',
    ])
  })

  it('names the couple from their birthdays, else the client', () => {
    expect(coupleName('Priya Sharma', [{ kind: 'birthday', person_name: 'Priya Sharma' }, { kind: 'birthday', person_name: 'Rahul Verma' }])).toBe(
      'Priya & Rahul',
    )
    expect(coupleName('Priya Sharma', [])).toBe('Priya')
  })

  it('writes a birthday and an anniversary wish signed by the studio', () => {
    expect(
      wishWords({ occasion: { kind: 'birthday', person_name: 'Rahul Verma', month: 8, day: 2, year: null }, clientName: 'Priya', studioName: 'Asha Studio', on: '2027-08-02' }),
    ).toBe('Happy birthday, Rahul! Wishing you a wonderful year ahead — from all of us at Asha Studio.')
    expect(
      wishWords({
        occasion: { kind: 'anniversary', person_name: '', month: 12, day: 12, year: 2026 },
        clientName: 'Priya Sharma',
        studioName: 'Asha Studio',
        on: '2027-12-12',
        others: [{ kind: 'birthday', person_name: 'Priya' }, { kind: 'birthday', person_name: 'Rahul' }],
      }),
    ).toBe('Happy 1st anniversary, Priya & Rahul! It was an honour to be part of your wedding. Wishing you many more years together — Asha Studio.')
  })

  it('puts the soonest first', () => {
    const list = [{ month: 3, day: 14 }, { month: 10, day: 20 }, { month: 1, day: 5 }]
    expect(sortBySoonest(list, '2026-10-03').map((o) => o.month)).toEqual([10, 1, 3])
  })
})
