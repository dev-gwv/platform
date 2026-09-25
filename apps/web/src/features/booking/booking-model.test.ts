import { describe, expect, it } from 'vitest'
import type { TeamSlot } from '@ipc/contracts'
import { bookingMessage, conflictItems, daysOf, figures, monthDays, monthGrid, roleCards, shiftMonth, staffing } from './booking-model'
import { icsForSlot } from './share'

const SHOOT = '00000000-0000-4000-8000-0000000000a1'
const OTHER_SHOOT = '00000000-0000-4000-8000-0000000000a2'
const PRIYA = '00000000-0000-4000-8000-000000000001'
const AMAN = '00000000-0000-4000-8000-000000000002'
const SANA = '00000000-0000-4000-8000-000000000003'

let n = 0
const slot = (over: Partial<TeamSlot>): TeamSlot => ({
  id: `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`,
  user_id: PRIYA,
  user_name: 'Priya Nair',
  shoot_id: SHOOT,
  service_name: 'Candid Photographer',
  start_at: '2026-09-26T04:30:00.000Z',
  end_at: '2026-09-26T10:30:00.000Z',
  status: 'booked',
  estimated_cost: null,
  final_cost: null,
  cost_status: 'not_decided',
  cost_notes: null,
  data_required: false,
  data_not_required_reason: null,
  released_at: null,
  shoot_name: 'Haldi',
  shoot_date: '2026-09-26',
  shoot_status: 'planned',
  location: 'Jaipur',
  map_link: null,
  project_id: null,
  project_name: 'Sharma Wedding',
  client_name: 'Sharma',
  ...over,
})

const shoot = {
  id: SHOOT,
  requirements: [
    { service_id: '00000000-0000-4000-8000-0000000000b1', name: 'Candid Photographer', quantity: 2 },
    { service_id: '00000000-0000-4000-8000-0000000000b2', name: 'Cinematographer', quantity: 1 },
    { service_id: '00000000-0000-4000-8000-0000000000b3', name: 'Drone Operator', quantity: 1 },
  ],
}

describe('role cards', () => {
  const slots = [
    slot({ user_id: PRIYA, user_name: 'Priya Nair', service_name: ' candid  photographer ' }),
    slot({ user_id: AMAN, user_name: 'Aman Verma', service_name: 'Cinematographer' }),
    slot({ user_id: SANA, user_name: 'Sana Iyer', service_name: 'Lightman' }),
    slot({ user_id: SANA, service_name: 'Candid Photographer', status: 'released' }),
    slot({ user_id: SANA, service_name: 'Drone Operator', shoot_id: OTHER_SHOOT }),
  ]

  it('puts each booked person on the role they fill, ignoring case and spacing', () => {
    const { cards } = roleCards(shoot, slots)
    expect(cards.map((c) => [c.name, c.people.map((p) => p.user_name), c.fill, c.open])).toEqual([
      ['Candid Photographer', ['Priya Nair'], 'partial', 1],
      ['Cinematographer', ['Aman Verma'], 'full', 0],
      ['Drone Operator', [], 'empty', 1],
    ])
  })

  it('keeps someone on a role the shoot never asked for, instead of hiding them', () => {
    expect(roleCards(shoot, slots).extra.map((s) => s.service_name)).toEqual(['Lightman'])
  })

  it('adds up staffing, capping a role that has more people than seats', () => {
    expect(staffing(shoot, slots)).toEqual({ needed: 4, filled: 2, state: 'partial' })
    const over = [...slots, slot({ user_id: SANA, service_name: 'Cinematographer', start_at: '2026-09-26T11:00:00.000Z', end_at: '2026-09-26T12:00:00.000Z' })]
    expect(staffing(shoot, over).filled).toBe(2)
    expect(staffing({ id: SHOOT, requirements: [] }, slots).state).toBe('none')
    expect(staffing(shoot, []).state).toBe('empty')
  })
})

describe('the month', () => {
  it('knows the days of a month and steps across a year', () => {
    expect(monthDays('2026-02')).toHaveLength(28)
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('puts a booking that runs past midnight on both days, and one ending at midnight on one', () => {
    const late = slot({ start_at: new Date(2026, 8, 26, 20).toISOString(), end_at: new Date(2026, 8, 27, 2).toISOString() })
    expect(daysOf(late)).toEqual(['2026-09-26', '2026-09-27'])
    const toMidnight = slot({ start_at: new Date(2026, 8, 26, 20).toISOString(), end_at: new Date(2026, 8, 27, 0).toISOString() })
    expect(daysOf(toMidnight)).toEqual(['2026-09-26'])
  })

  it("adds up each person's month, busiest first, and leaves the free ones free", () => {
    const members = [
      { user_id: PRIYA, name: 'Priya Nair', role_names: [] },
      { user_id: AMAN, name: 'Aman Verma', role_names: [] },
      { user_id: SANA, name: 'Sana Iyer', role_names: [] },
    ]
    const at = (d: number, h: number) => new Date(2026, 8, d, h).toISOString()
    const slots = [
      slot({ user_id: AMAN, start_at: at(5, 9), end_at: at(5, 15) }),
      slot({ user_id: AMAN, shoot_id: OTHER_SHOOT, start_at: at(6, 9), end_at: at(6, 11) }),
      slot({ user_id: PRIYA, start_at: at(5, 9), end_at: at(5, 12) }),
      slot({ user_id: PRIYA, start_at: at(12, 9), end_at: at(12, 12), status: 'cancelled' }),
      slot({ user_id: PRIYA, start_at: at(3, 9), end_at: at(3, 12), status: 'released' }),
      slot({ user_id: PRIYA, start_at: new Date(2026, 9, 2, 9).toISOString(), end_at: new Date(2026, 9, 2, 10).toISOString() }),
    ]
    const rows = monthGrid(members, slots, '2026-09')
    expect(rows.map((r) => [r.member.name, r.shoots, r.days, r.hours])).toEqual([
      ['Aman Verma', 2, 2, 8],
      ['Priya Nair', 1, 1, 3],
      ['Sana Iyer', 0, 0, 0],
    ])
    // A released booking still shows on its day, greyed; a cancelled one is gone.
    expect(rows[1]!.byDay.get('2026-09-03')?.[0]?.status).toBe('released')
    expect(rows[1]!.byDay.has('2026-09-12')).toBe(false)
  })
})

describe('conflicts and figures', () => {
  const now = Date.parse('2026-09-28T00:00:00Z')

  it('finds double bookings, bookings with no role, and stale ones on unfinished shoots only; blocked time is fine', () => {
    const items = conflictItems(
      [
        slot({ user_id: PRIYA, start_at: '2026-09-30T04:00:00.000Z', end_at: '2026-09-30T08:00:00.000Z' }),
        slot({ user_id: PRIYA, start_at: '2026-09-30T07:00:00.000Z', end_at: '2026-09-30T09:00:00.000Z', service_name: '' }),
        slot({ user_id: AMAN, start_at: '2026-09-30T07:00:00.000Z', end_at: '2026-09-30T09:00:00.000Z', shoot_id: null }),
        slot({ user_id: SANA, start_at: '2026-09-20T04:00:00.000Z', end_at: '2026-09-20T06:00:00.000Z' }),
        slot({ user_id: SANA, start_at: '2026-09-21T04:00:00.000Z', end_at: '2026-09-21T06:00:00.000Z', shoot_status: 'completed' }),
        slot({ user_id: AMAN, start_at: '2026-09-30T04:00:00.000Z', end_at: '2026-09-30T08:00:00.000Z', status: 'released' }),
      ],
      now,
    )
    expect(items[0]!.type).toBe('double_booking')
    expect(items.map((i) => i.type).sort()).toEqual(['double_booking', 'missing_service', 'past_active'])
  })

  it('counts roles to fill, short-staffed shoots and people booked', () => {
    const f = figures([shoot], [slot({}), slot({ user_id: AMAN, service_name: 'Cinematographer' })], 1)
    expect(f).toMatchObject({ shoots: 1, needed: 4, filled: 2, toFill: 2, shortShoots: 1, people: 2, conflicts: 1 })
  })
})

describe('outside the app', () => {
  it('writes a WhatsApp message and a calendar file that say what, when and where', () => {
    const s = slot({ map_link: 'https://maps.example/x' })
    const text = bookingMessage(s)
    expect(text).toMatch(/^Hi Priya, you are booked for Haldi \(Sharma Wedding\)\./)
    expect(text).toContain('Role: Candid Photographer')
    expect(text).toContain('Where: Jaipur')
    const ics = icsForSlot(s)
    expect(ics).toContain('SUMMARY:Haldi · Candid Photographer')
    expect(ics).toContain('DTSTART:20260926T043000Z')
    expect(ics).toContain('LOCATION:Jaipur')
  })
})
