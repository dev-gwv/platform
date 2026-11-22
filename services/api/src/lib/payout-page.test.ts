import { describe, expect, it } from 'vitest'
import { crewPayoutsPage, crewPayoutsPageQuery, type CrewPayoutRow } from '@ipc/contracts'
import { crewOwedFrom, crewPayoutsPageFrom } from './payout-rows'

/**
 * Team payouts a page at a time (speed check, 22 Nov: 7,500 bookings were
 * 3 MB on every open). The server runs the view the browser used to run;
 * these pin that a page is the same rows, in the same order, the old screen
 * showed, and that the headline and each person's figures still cover
 * everything, not only the page.
 */
const today = '2026-10-10'
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const A = id()
const B = id()
const P1 = id()
const P2 = id()
const row = (o: Partial<CrewPayoutRow>): CrewPayoutRow => ({
  slot_id: id(),
  user_id: A,
  user_name: 'Asha',
  role: 'Candid',
  shoot_id: null,
  shoot_name: 'Haldi',
  project_id: P1,
  project_name: 'Mehta Wedding',
  shoot_date: '2026-10-01',
  amount: 10000,
  cost_status: 'final',
  paid: 0,
  last_paid_date: null,
  stands: true,
  ...o,
})

// Newest first, as crewPayoutRows orders them.
const rows: CrewPayoutRow[] = [
  row({ shoot_date: '2026-10-20', amount: 8000 }),
  row({ shoot_date: '2026-10-12', user_id: B, user_name: 'Bilal', project_id: P2, project_name: 'Rao Reception', paid: 2000 }),
  ...Array.from({ length: 150 }, (_, i) => row({ shoot_date: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, user_id: i % 2 ? B : A, user_name: i % 2 ? 'Bilal' : 'Asha', paid: i % 5 === 0 ? 10000 : 0 })),
]
const page = (raw: Record<string, string>) => crewPayoutsPageFrom(rows, crewPayoutsPageQuery.parse(raw), today)

describe('crewPayoutsPageFrom', () => {
  it('sends the first hundred owed rows, counts them all, and keeps the headline whole', () => {
    const p = page({ view: 'owed' })
    // 150 past rows, every fifth paid in full: 120 owed.
    expect(p.rows_total).toBe(120)
    expect(p.rows).toHaveLength(100)
    expect(p.owed_count).toBe(120)
    expect(p.bookings).toBe(rows.length)
    expect(p.rows.every((r) => r.shoot_date < today && r.amount - r.paid > 0)).toBe(true)
    const { today: _t, ...headline } = crewOwedFrom(rows, today)
    expect(p).toMatchObject(headline)
    expect(() => crewPayoutsPage.parse(p)).not.toThrow()
  })

  it('totals each person over the whole view, not the page', () => {
    const p = page({ view: 'owed', limit: '10' })
    const asha = p.persons.find((x) => x.user_id === A)!
    expect(asha.shoots).toBe(60)
    expect(asha.owed).toBe(600000)
    expect(p.persons.reduce((s, x) => s + x.shoots, 0)).toBe(120)
  })

  it('keeps the order rows came in, so a longer page only adds to the end', () => {
    const short = page({ view: 'all', limit: '30' }).rows.map((r) => r.slot_id)
    const long = page({ view: 'all', limit: '60' }).rows.map((r) => r.slot_id)
    expect(long.slice(0, 30)).toEqual(short)
  })

  it('applies the filters on the server', () => {
    expect(page({ view: 'upcoming' }).rows_total).toBe(2)
    expect(page({ view: 'all', project_id: P2 }).rows.map((r) => r.project_name)).toEqual(['Rao Reception'])
    expect(page({ view: 'all', q: 'bil' }).rows.every((r) => r.user_name === 'Bilal')).toBe(true)
    expect(page({ view: 'all', from: '2026-10-01', to: '2026-10-31' }).rows_total).toBe(2)
  })

  it('By project sends projects, with a footer over all of them', () => {
    const p = page({ view: 'projects', limit: '1' })
    expect(p.rows).toHaveLength(0)
    expect(p.projects_total).toBe(2)
    expect(p.projects).toHaveLength(1)
    expect(p.project_totals.paid).toBe(30 * 10000 + 2000)
  })
})
