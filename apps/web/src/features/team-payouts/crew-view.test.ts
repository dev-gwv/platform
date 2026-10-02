import { describe, expect, it } from 'vitest'
import type { CrewPayoutRow } from '@ipc/contracts'
import { crewPersonLine, crewRowLine, crewRowNote, crewRowsFor, crewViewOf, myPayoutsLine, whoYouOweLine } from './crew-view'

const today = '2026-10-02'
const row = (o: Partial<CrewPayoutRow>): CrewPayoutRow => ({
  slot_id: '00000000-0000-4000-8000-000000000001',
  user_id: '00000000-0000-4000-8000-0000000000a1',
  user_name: 'Asha',
  role: 'Candid',
  shoot_id: null,
  shoot_name: 'Haldi',
  project_id: 'p1',
  project_name: 'Mehta Wedding',
  shoot_date: '2026-09-30',
  amount: 10000,
  cost_status: 'final',
  paid: 0,
  last_paid_date: null,
  stands: true,
  ...o,
})
const inr = (s: string) => s.replace(/\u00a0/g, ' ')

describe('crewViewOf', () => {
  it('opens on Owed now', () => {
    expect(crewViewOf(null)).toBe('owed')
    expect(crewViewOf('nonsense')).toBe('owed')
    expect(crewViewOf('upcoming')).toBe('upcoming')
  })
})

describe('crewRowsFor', () => {
  const rows = [
    row({ slot_id: 'a' }),
    row({ slot_id: 'b', paid: 10000 }),
    row({ slot_id: 'c', shoot_date: '2026-10-02' }),
    row({ slot_id: 'd', shoot_date: '2026-10-09', project_id: 'p2', user_name: 'Bilal' }),
  ]
  const ids = (v: Parameters<typeof crewRowsFor>[1], f = {}) => crewRowsFor(rows, v, today, f).map((r) => r.slot_id)
  it('Owed now is past shoots with money left', () => expect(ids('owed')).toEqual(['a']))
  it('Upcoming starts today', () => expect(ids('upcoming')).toEqual(['c', 'd']))
  it('All is everything, narrowed by the filters', () => {
    expect(ids('all')).toEqual(['a', 'b', 'c', 'd'])
    expect(ids('all', { project: 'p2' })).toEqual(['d'])
    expect(ids('all', { q: 'bil' })).toEqual(['d'])
    expect(ids('all', { from: '2026-10-01', to: '2026-10-05' })).toEqual(['c'])
  })
})

describe('crewRowLine', () => {
  it('says what is left, owed, or paid ahead', () => {
    expect(inr(crewRowLine(row({}), today))).toBe('₹10,000 owed')
    expect(inr(crewRowLine(row({ paid: 4000 }), today))).toBe('₹6,000 left of ₹10,000')
    expect(crewRowLine(row({ paid: 10000 }), today)).toBe('Paid')
    expect(inr(crewRowLine(row({ shoot_date: '2026-10-09' }), today))).toBe('₹10,000 after the shoot')
    expect(inr(crewRowLine(row({ shoot_date: '2026-10-09', paid: 10000 }), today))).toBe('₹10,000 paid in advance')
    expect(inr(crewRowLine(row({ shoot_date: '2026-10-09', paid: 3000 }), today))).toBe(
      '₹3,000 paid in advance · ₹7,000 after the shoot',
    )
    expect(crewRowLine(row({ amount: 0 }), today)).toBe('No payout set')
    expect(inr(crewRowLine(row({ stands: false, amount: 2000, paid: 2000 }), today))).toBe('₹2,000 paid · booking released')
  })
})

describe('whoYouOweLine', () => {
  it('names the money and the people', () => {
    expect(inr(whoYouOweLine({ owed_now: 12500, people: [{ user_id: 'a', user_name: 'A', owed: 12500, bookings: 2 }] }))).toBe(
      '₹12,500 to 1 person for shoots already done',
    )
    expect(whoYouOweLine({ owed_now: 0, people: [] })).toBe('All crew paid for shoots already done')
  })
})

describe('myPayoutsLine', () => {
  it('splits what is due now from what is still to come', () => {
    expect(inr(myPayoutsLine({ owed_now: 6000, upcoming: 10000, paid: 4000, paid_ahead: 0 }))).toBe(
      '₹6,000 due to you for shoots already done · ₹10,000 for shoots coming up · ₹4,000 paid.',
    )
    expect(inr(myPayoutsLine({ owed_now: 0, upcoming: 0, paid: 5000, paid_ahead: 2000 }))).toBe(
      'You have been paid for every shoot so far · ₹5,000 paid, ₹2,000 of it in advance.',
    )
  })
})

describe('crewRowNote', () => {
  it('says "amount may change" only while money is still to go', () => {
    expect(crewRowNote(row({ cost_status: 'tentative' }))).toBe(' · amount may change')
    expect(crewRowNote(row({ cost_status: 'tentative', paid: 10000 }))).toBe('')
    expect(crewRowNote(row({ cost_status: 'final' }))).toBe('')
  })
})

describe('crewPersonLine', () => {
  const money = (n: number) => `Rs ${n}`
  it('never calls money for a future shoot "left" or "owed"', () => {
    const line = crewPersonLine([row({ shoot_date: '2026-09-20', paid: 10000 }), row({ shoot_date: '2026-11-21', amount: 12000 })], today, money)
    expect(line).toBe('Rs 12000 after the shoot · 2 shoots')
  })
  it('splits what is owed from what comes later', () => {
    expect(crewPersonLine([row({}), row({ shoot_date: '2026-11-21', amount: 12000 })], today, money)).toBe('Rs 10000 owed · Rs 12000 after the shoot · 2 shoots')
    expect(crewPersonLine([row({ paid: 10000 })], today, money)).toBe('All paid · 1 shoot')
  })
})
