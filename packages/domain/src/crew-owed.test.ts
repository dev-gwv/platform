import { describe, expect, it } from 'vitest'
import { crewBucketOf, crewMonthDue, summarizeCrewOwed, type CrewPayoutLine } from './crew-owed'

const line = (o: Partial<CrewPayoutLine>): CrewPayoutLine => ({
  user_id: 'a',
  user_name: 'Asha',
  shoot_date: '2026-10-01',
  amount: 10000,
  paid: 0,
  ...o,
})

describe('crewBucketOf', () => {
  it('is owed only once the day has passed', () => {
    expect(crewBucketOf('2026-10-01', '2026-10-02')).toBe('past')
    expect(crewBucketOf('2026-10-02', '2026-10-02')).toBe('upcoming')
    expect(crewBucketOf('2026-10-09', '2026-10-02')).toBe('upcoming')
  })
})

describe('summarizeCrewOwed', () => {
  const today = '2026-10-02'
  it('owes past shoots minus what was paid, and keeps future ones apart', () => {
    const s = summarizeCrewOwed(
      [
        line({ amount: 10000, paid: 4000 }),
        line({ user_id: 'b', user_name: 'Bilal', amount: 5000 }),
        line({ shoot_date: '2026-10-05', amount: 8000, paid: 3000 }),
      ],
      today,
    )
    expect(s.owed_now).toBe(11000)
    expect(s.upcoming).toBe(5000)
    expect(s.paid).toBe(7000)
    expect(s.paid_ahead).toBe(3000)
    expect(s.people.map((p) => [p.user_name, p.owed])).toEqual([
      ['Asha', 6000],
      ['Bilal', 5000],
    ])
  })

  it('never subtracts money paid ahead from what is owed now', () => {
    const s = summarizeCrewOwed(
      [line({ amount: 10000 }), line({ shoot_date: '2026-10-20', amount: 10000, paid: 10000 })],
      today,
    )
    expect(s.owed_now).toBe(10000)
    expect(s.upcoming).toBe(0)
    expect(s.paid_ahead).toBe(10000)
  })

  it('an over-paid or fully paid shoot owes nothing and names nobody', () => {
    const s = summarizeCrewOwed([line({ paid: 12000 }), line({ paid: 10000 })], today)
    expect(s.owed_now).toBe(0)
    expect(s.people).toEqual([])
    expect(s.paid).toBe(22000)
  })

  it('counts a person once with every booking that still has money on it', () => {
    const s = summarizeCrewOwed([line({}), line({ shoot_date: '2026-09-20', amount: 2500 })], today)
    expect(s.people).toEqual([{ user_id: 'a', user_name: 'Asha', owed: 12500, bookings: 2 }])
  })
})

describe('crewMonthDue (Payroll shoot payouts)', () => {
  const today = '2026-10-15'
  const lines = [
    line({ shoot_date: '2026-10-01', amount: 10000, paid: 4000 }),
    line({ shoot_date: '2026-10-20', amount: 6000, paid: 1000 }),
    line({ shoot_date: '2026-09-28', amount: 5000 }),
    line({ user_id: 'b', user_name: 'Ravi', shoot_date: '2026-10-02', amount: 3000, paid: 3000 }),
  ]

  it('is the month part of Owed now, with shoots still to come kept apart', () => {
    expect(crewMonthDue(lines, '2026-10-01', '2026-10-31', today)).toEqual([
      { user_id: 'a', user_name: 'Asha', shoots: 1, owed: 10000, paid: 4000, due: 6000, upcoming: 5000 },
    ])
  })

  it('adds up to Owed now when the month holds every done shoot', () => {
    const month = crewMonthDue(lines, '2026-09-01', '2026-10-31', today)
    const owed = summarizeCrewOwed(lines, today).owed_now
    expect(month.reduce((n, p) => n + p.due, 0)).toBe(owed)
  })
})
