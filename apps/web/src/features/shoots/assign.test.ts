import { describe, expect, it } from 'vitest'
import type { TeamMember, TeamSlot } from '@ipc/contracts'
import {
  alsoBookedText,
  availabilityLine,
  bookedHours,
  bookingsOn,
  candidatesFor,
  clashFor,
  clockRange,
  defaultWindowFields,
  freeGaps,
  freeText,
  leaveOn,
  normalizePicks,
  personDay,
  overlaps,
  pickedIds,
  progressWithPicks,
  rangeLabel,
  requirementFill,
  roleMatches,
  seatsLeft,
  shootHours,
  timeLabel,
  windowFor,
  withPicks,
  shootProgress,
  suggestedPayout,
  suggestedRate,
  sameCrewPlan,
  copyResultLine,
  windowOf,
} from './assign'

const SHOOT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const member = (id: string, name: string, over: Partial<TeamMember> = {}): TeamMember => ({
  user_id: id,
  name,
  role: 'employee',
  role_names: [],
  engagement_type: null,
  phone: null,
  email: null,
  payout_type: null,
  freelancer_rate: null,
  rate_wedding_day: null,
  rate_half_day: null,
  login_enabled: true,
  last_seen_at: null,
  ...over,
})

let n = 0
const slot = (over: Partial<TeamSlot>): TeamSlot => ({
  response: 'confirmed',
  decline_reason: null,
  arrived_at: null,
  released_at: null,
  shoot_name: null,
  shoot_date: null,
  shoot_status: null,
  location: null,
  map_link: null,
  project_id: null,
  project_name: null,
  client_name: null,
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  user_id: 'u1',
  user_name: null,
  shoot_id: SHOOT,
  service_name: 'Candid Photographer',
  start_at: '2026-10-01T04:30:00.000Z',
  end_at: '2026-10-01T08:30:00.000Z',
  status: 'booked',
  estimated_cost: null,
  final_cost: null,
  cost_status: 'tentative',
  cost_notes: null,
  data_required: false,
  data_not_required_reason: null,
  ...over,
})

describe('requirementFill / shootProgress', () => {
  it('counts only live bookings, per requirement, case-insensitively', () => {
    const fill = requirementFill(
      { requirements: [{ service_id: 's1', name: 'Candid Photographer', quantity: 2 }, { service_id: 's2', name: 'Drone', quantity: 1 }] },
      [
        slot({ service_name: 'candid photographer' }),
        slot({ service_name: 'Candid Photographer', status: 'released' }),
      ],
    )
    expect(fill).toEqual([
      { name: 'Candid Photographer', required: 2, assigned: 1, open: 1 },
      { name: 'Drone', required: 1, assigned: 0, open: 1 },
    ])
    expect(shootProgress(fill)).toEqual({ required: 3, assigned: 1, pct: 33 })
  })

  it('does not let an over-filled role count past what it needs', () => {
    const fill = [{ name: 'A', required: 1, assigned: 3, open: 0 }, { name: 'B', required: 1, assigned: 0, open: 1 }]
    expect(shootProgress(fill).assigned).toBe(1)
  })
})

describe('windows and clashes', () => {
  it('builds a window from date, time and hours, and refuses an incomplete one', () => {
    const w = windowOf('2026-10-01', '10:00', 4)!
    expect(Date.parse(w.end) - Date.parse(w.start)).toBe(4 * 3_600_000)
    expect(windowOf('2026-10-01', '', 4)).toBeNull()
    expect(windowOf('2026-10-01', '10:00', 0)).toBeNull()
  })

  it('treats back-to-back as fine: only a true overlap clashes', () => {
    const a = { start: '2026-10-01T04:00:00Z', end: '2026-10-01T08:00:00Z' }
    expect(overlaps(a, { start: '2026-10-01T08:00:00Z', end: '2026-10-01T10:00:00Z' })).toBe(false)
    expect(overlaps(a, { start: '2026-10-01T07:59:00Z', end: '2026-10-01T10:00:00Z' })).toBe(true)
  })

  it('finds the booking that makes someone busy -- on any shoot -- but not the one being changed', () => {
    const busy = slot({ user_id: 'u1', shoot_id: OTHER })
    const w = { start: '2026-10-01T06:00:00Z', end: '2026-10-01T07:00:00Z' }
    expect(clashFor('u1', w, [busy])?.id).toBe(busy.id)
    expect(clashFor('u1', w, [busy], { ignoreSlotId: busy.id })).toBeNull()
    expect(clashFor('u2', w, [busy])).toBeNull()
    // Later the same day, after that booking ends: free.
    expect(clashFor('u1', { start: '2026-10-01T09:00:00Z', end: '2026-10-01T11:00:00Z' }, [busy])).toBeNull()
  })
})

describe('candidatesFor', () => {
  it('puts free role matches first, then free others, then those who cannot, with the reason', () => {
    const members = [
      member('u1', 'Asha', { role_names: ['Candid Photographer'] }),
      member('u2', 'Bala'),
      member('u3', 'Chetan', { role_names: ['Photographer'] }),
      member('u4', 'Dev', { role_names: ['Candid Photographer'] }),
    ]
    const slots = [
      slot({ user_id: 'u4', shoot_id: OTHER, service_name: 'Wedding' }), // busy elsewhere
      slot({ user_id: 'u1', service_name: 'Candid Photographer' }), // already on this role
    ]
    const out = candidatesFor({
      members,
      requirement: 'Candid Photographer',
      // Explicit UTC, so the test means the same in any machine's timezone.
      window: { start: '2026-10-01T05:00:00Z', end: '2026-10-01T07:00:00Z' },
      shootId: SHOOT,
      slots,
    })
    expect(out.map((c) => [c.member.name, c.match, c.availability.state])).toEqual([
      ['Chetan', true, 'free'],
      ['Bala', false, 'free'],
      ['Asha', true, 'on_role'],
      ['Dev', true, 'busy'],
    ])
  })
})

describe("a person's day, in plain words", () => {
  const IST = 'Asia/Kolkata'
  // 10:30–14:30 IST on 1 Oct (the fixture's default booking).
  const booking = () => slot({ user_id: 'u1', shoot_id: OTHER, shoot_name: 'Engagement', project_name: 'Sharma Wedding' })

  it('a booking that overlaps is busy, back to back or later is free, and the reason names the other shoot', () => {
    const members = [member('u1', 'Rahul', { role_names: ['Photographer'] }), member('u2', 'Bala')]
    const base = { members, requirement: 'Photographer', shootId: SHOOT, slots: [booking()] }
    // 2:30–4:30 PM IST: right after the Sharma booking ends.
    const after = candidatesFor({ ...base, window: { start: '2026-10-01T09:00:00Z', end: '2026-10-01T11:00:00Z' } })
    expect(after.map((c) => [c.member.name, c.availability.state])).toEqual([
      ['Rahul', 'free'],
      ['Bala', 'free'],
    ])
    const during = candidatesFor({ ...base, window: { start: '2026-10-01T08:00:00Z', end: '2026-10-01T10:00:00Z' } })
    expect(during[1]!.availability).toMatchObject({ state: 'busy', onThisShoot: false })
    expect(availabilityLine(during[1]!, [], IST)).toEqual({ tone: 'muted', text: 'Busy 10 AM–2 PM · Engagement (Sharma Wedding)' })
  })

  it('knows when the clash is this very shoot, in another role', () => {
    const out = candidatesFor({
      members: [member('u1', 'Rahul')],
      requirement: 'Drone',
      window: { start: '2026-10-01T05:00:00Z', end: '2026-10-01T07:00:00Z' },
      shootId: SHOOT,
      slots: [slot({ user_id: 'u1', shoot_id: SHOOT, service_name: 'Candid Photographer' })],
    })
    expect(out[0]!.availability).toMatchObject({ state: 'busy', onThisShoot: true })
    expect(availabilityLine(out[0]!, [], IST).text).toBe('Already on this shoot as Candid Photographer')
  })

  it('writes the one line under a name: free, free with other bookings, on leave', () => {
    const free = { availability: { state: 'free' as const } }
    expect(availabilityLine(free, [], IST)).toEqual({ tone: 'green', text: 'Free all day' })
    const b = booking()
    expect(availabilityLine(free, [b], IST)).toEqual({ tone: 'green', text: 'Free at this time · also booked 10 AM–2 PM · Engagement (Sharma Wedding)' })
    const c = slot({ user_id: 'u1', shoot_id: OTHER, shoot_name: 'Sangeet', project_name: 'Mehta Wedding', start_at: '2026-10-01T13:30:00Z', end_at: '2026-10-01T15:30:00Z' })
    const d = slot({ user_id: 'u1', shoot_id: OTHER, shoot_name: 'Reception', start_at: '2026-10-01T16:00:00Z', end_at: '2026-10-01T17:00:00Z' })
    expect(availabilityLine(free, [b, c, d], IST).text).toBe(
      'Free at this time · also booked 10 AM–2 PM · Engagement (Sharma Wedding), 7–9 PM · Sangeet (Mehta Wedding) +1 more',
    )
    expect(availabilityLine({ ...free, leave: 'full' }, [b], IST)).toEqual({ tone: 'amber', text: 'On leave that day' })
    expect(availabilityLine({ ...free, leave: 'half' }, [], IST)).toEqual({ tone: 'amber', text: 'Half-day leave that day' })
    expect(alsoBookedText([c], IST)).toBe('Also booked 7–9 PM · Sangeet (Mehta Wedding)')
    expect(alsoBookedText([], IST)).toBeNull()
  })

  it('puts people on leave after the free ones, still pickable', () => {
    const members = [member('u1', 'Asha', { role_names: ['Photographer'] }), member('u2', 'Bala')]
    const out = candidatesFor({
      members,
      requirement: 'Photographer',
      window: { start: '2026-10-01T05:00:00Z', end: '2026-10-01T07:00:00Z' },
      shootId: SHOOT,
      slots: [],
      leaves: [{ user_id: 'u1', start_date: '2026-09-30', end_date: '2026-10-02', half_day: false, status: 'approved' } as never],
    })
    expect(out.map((c) => [c.member.name, c.leave, c.availability.state])).toEqual([
      ['Bala', null, 'free'],
      ['Asha', 'full', 'free'],
    ])
    expect(leaveOn('u1', '2026-10-03', [{ user_id: 'u1', start_date: '2026-10-03', end_date: '2026-10-03', half_day: true, status: 'approved' }])).toBe('half')
    expect(leaveOn('u1', '2026-10-03', [{ user_id: 'u1', start_date: '2026-10-03', end_date: '2026-10-03', half_day: false, status: 'pending' }])).toBeNull()
  })

  it("lists a person's bookings on a day, counting a booking past midnight on both days", () => {
    const day = slot({ user_id: 'u1', start_at: new Date(2026, 9, 1, 10, 0).toISOString(), end_at: new Date(2026, 9, 1, 15, 0).toISOString() })
    const late = slot({ user_id: 'u1', start_at: new Date(2026, 9, 1, 22, 0).toISOString(), end_at: new Date(2026, 9, 2, 3, 0).toISOString() })
    const gone = slot({ user_id: 'u1', status: 'released', start_at: new Date(2026, 9, 1, 16, 0).toISOString(), end_at: new Date(2026, 9, 1, 17, 0).toISOString() })
    const other = slot({ user_id: 'u2' })
    expect(bookingsOn('u1', '2026-10-01', [late, gone, other, day]).map((s) => s.id)).toEqual([day.id, late.id])
    expect(bookingsOn('u1', '2026-10-02', [late, day]).map((s) => s.id)).toEqual([late.id])
    expect(bookingsOn('u1', '2026-10-01', [late, day], { ignoreSlotId: late.id }).map((s) => s.id)).toEqual([day.id])
    expect(bookedHours([day, late], '2026-10-01')).toBe(7)
    expect(bookedHours([late], '2026-10-02')).toBe(3)
  })

  it('says when they are free that day', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 1, h, m).toISOString()
    expect(freeText(freeGaps([], '2026-10-01'))).toBe('Free all day')
    const gaps = freeGaps(
      [
        { start_at: at(15), end_at: at(18) },
        { start_at: at(19), end_at: at(21) },
      ],
      '2026-10-01',
    )
    expect(gaps).toHaveLength(3)
    expect(gaps[0]!.from).toBeNull()
    expect(gaps[2]!.to).toBeNull()
    expect(freeText(gaps)).toBe('Free before 3 PM, 6–7 PM, after 9 PM')
    // Back to back, then the rest of the day.
    expect(freeText(freeGaps([{ start_at: at(0), end_at: at(12) }, { start_at: at(12), end_at: at(23, 59) }], '2026-10-01'))).toBe('Free after 11:59 PM')
    // Overlapping bookings merge; a whole day leaves nothing.
    expect(freeText(freeGaps([{ start_at: at(0), end_at: new Date(2026, 9, 2, 1).toISOString() }], '2026-10-01'))).toBe('No free time that day')
    const pd = personDay('u1', '2026-10-01', [slot({ user_id: 'u1', start_at: at(15), end_at: at(18) })])
    expect(pd).toMatchObject({ hours: 3, free: 'Free before 3 PM, after 6 PM' })
  })

  it('labels times and ranges the way a studio says them', () => {
    expect(timeLabel('2026-10-01T10:30:00Z', IST)).toBe('4 PM')
    expect(timeLabel('2026-10-01T10:45:00Z', IST)).toBe('4:15 PM')
    expect(clockRange('2026-10-01T09:30:00Z', '2026-10-01T12:30:00Z', IST)).toBe('3–6 PM')
    expect(rangeLabel({ start: '2026-10-01T10:30:00Z', end: '2026-10-01T15:30:00Z' }, IST)).toBe('4–9 PM · 5 h')
    expect(rangeLabel({ start: '2026-10-01T05:30:00Z', end: '2026-10-01T09:30:00Z' }, IST)).toBe('11 AM–3 PM · 4 h')
    expect(rangeLabel({ start: '2026-10-01T10:30:00Z', end: '2026-10-01T13:00:00Z' }, IST)).toBe('4–6:30 PM · 2.5 h')
  })

  it("a pick books the shoot's window unless it says otherwise", () => {
    const base = { date: '2026-10-01', time: '16:00', hours: 5 }
    const whole = windowFor({ id: 'a', payout: '' }, base)!
    expect(Date.parse(whole.end) - Date.parse(whole.start)).toBe(5 * 3_600_000)
    const two = windowFor({ id: 'a', payout: '', hours: 2 }, base)!
    expect(Date.parse(two.end) - Date.parse(two.start)).toBe(2 * 3_600_000)
    expect(two.start).toBe(whole.start)
    const later = windowFor({ id: 'a', payout: '', start: '18:00' }, base)!
    expect(Date.parse(later.start) - Date.parse(whole.start)).toBe(2 * 3_600_000)
    expect(windowFor({ id: 'a', payout: '' }, { ...base, hours: null })).toBeNull()
    expect(windowFor({ id: 'a', payout: '', hours: 2 }, { ...base, hours: null })).not.toBeNull()
  })

  it('reads a saved draft back without trusting it', () => {
    expect(normalizePicks({ Candid: [{ id: 'a', payout: '500' }, { id: 'b', hours: 'x', start: 'noon' }, { nope: 1 }], junk: 'no' })).toEqual({
      Candid: [{ id: 'a', payout: '500' }, { id: 'b', payout: '' }],
    })
    expect(normalizePicks({ Candid: [{ id: 'a', payout: '', hours: 2, start: '18:00' }] })).toEqual({ Candid: [{ id: 'a', payout: '', hours: 2, start: '18:00' }] })
    expect(normalizePicks(null)).toEqual({})
  })

  it('knows how long a shoot runs', () => {
    expect(shootHours({ start_at: '2026-10-01T10:30:00Z', end_at: '2026-10-01T15:30:00Z' })).toBe(5)
    expect(shootHours({ start_at: '2026-10-01T10:30:00Z', end_at: null })).toBeNull()
    expect(shootHours({ start_at: '2026-10-01T10:30:00Z', end_at: '2026-10-01T10:00:00Z' })).toBeNull()
  })
})

describe('roleMatches / suggestedPayout / defaultWindowFields', () => {
  it('matches a role named more or less specifically', () => {
    expect(roleMatches({ role_names: ['Photographer'] }, 'Candid Photographer')).toBe(true)
    expect(roleMatches({ role_names: ['Cinematographer'] }, 'Drone Operator')).toBe(false)
  })

  it("pre-fills a freelancer's rate, never a salaried person's", () => {
    expect(suggestedPayout({ freelancer_rate: 12000, payout_type: 'per_shoot', engagement_type: 'freelancer' })).toBe(12000)
    expect(suggestedPayout({ freelancer_rate: 12000, payout_type: 'salary', engagement_type: 'in_house' })).toBeNull()
    expect(suggestedPayout({ freelancer_rate: null, payout_type: null, engagement_type: 'freelancer' })).toBeNull()
  })

  it("uses the shoot's own hours, else 9am on its day with the hours left to ask", () => {
    expect(defaultWindowFields({ shoot_date: '2026-10-01', start_at: null, end_at: null })).toEqual({
      date: '2026-10-01',
      time: '09:00',
      hours: null,
    })
    const only = new Date(2026, 9, 1, 16, 0)
    expect(defaultWindowFields({ shoot_date: '2026-10-01', start_at: only.toISOString(), end_at: null }).hours).toBeNull()
    const s = new Date(2026, 9, 1, 16, 0)
    const e = new Date(2026, 9, 1, 22, 30)
    expect(
      defaultWindowFields({ shoot_date: '2026-10-01', start_at: s.toISOString(), end_at: e.toISOString() }),
    ).toEqual({ date: '2026-10-01', time: '16:00', hours: 6.5 })
  })
})

describe('seatsLeft / pickedIds', () => {
  const fill = [
    { name: 'Candid', required: 2, assigned: 1, open: 1 },
    { name: 'Drone', required: 1, assigned: 0, open: 1 },
  ]
  it('takes the picks off the open seats and never goes below zero', () => {
    const left = seatsLeft(fill, { Candid: [{ id: 'a', payout: '' }, { id: 'b', payout: '' }] })
    expect(left.get('Candid')).toBe(0)
    expect(left.get('Drone')).toBe(1)
  })
  it('knows everyone picked, across roles', () => {
    expect([...pickedIds({ Candid: [{ id: 'a', payout: '' }], Drone: [{ id: 'b', payout: '5000' }] })]).toEqual(['a', 'b'])
  })
})

describe('withPicks / progressWithPicks', () => {
  const fill = [
    { name: 'Album Designer', required: 2, assigned: 0, open: 2 },
    { name: 'Candid', required: 2, assigned: 1, open: 1 },
  ]
  it('counts a pick the moment it is made, before Book', () => {
    const counts = withPicks(fill, { 'Album Designer': [{ id: 'a', payout: '' }] })
    expect(counts[0]).toMatchObject({ booked: 0, picked: 1, filled: 1 })
    expect(counts[1]).toMatchObject({ booked: 1, picked: 0, filled: 1 })
    expect(progressWithPicks(counts)).toEqual({ required: 4, booked: 1, picked: 1, filled: 2 })
  })
  it('never counts past what a role needs', () => {
    const counts = withPicks(fill, { Candid: [{ id: 'a', payout: '' }, { id: 'b', payout: '' }] })
    expect(counts[1]).toMatchObject({ booked: 1, picked: 1, filled: 2 })
  })
})

describe('suggestedRate', () => {
  const m = { freelancer_rate: 8000, rate_wedding_day: 10000, rate_half_day: 4500, payout_type: 'per_shoot', engagement_type: 'freelancer' }
  it('a wedding function takes the wedding rate', () => {
    expect(suggestedRate(m, { shootName: 'Wedding', hours: 8 })).toEqual({ amount: 10000, why: 'their wedding rate' })
    expect(suggestedRate(m, { shootName: 'Pheras', hours: 8 })?.amount).toBe(10000)
  })
  it('5 hours or less is a half day, whatever the function', () => {
    expect(suggestedRate(m, { shootName: 'Wedding', hours: 4 })).toEqual({ amount: 4500, why: 'their half-day rate' })
    expect(suggestedRate(m, { shootName: 'Haldi', hours: 5 })?.amount).toBe(4500)
  })
  it('anything else, or no hours yet, is the day rate', () => {
    expect(suggestedRate(m, { shootName: 'Haldi', hours: 6 })).toEqual({ amount: 8000, why: 'their day rate' })
    expect(suggestedRate(m, { shootName: 'Sangeet' })?.amount).toBe(8000)
    expect(suggestedRate(m)?.amount).toBe(8000)
  })
  it('falls back to the day rate when a usual rate is not set; salaried is never pre-filled', () => {
    expect(suggestedRate({ ...m, rate_wedding_day: null }, { shootName: 'Wedding', hours: 8 })?.amount).toBe(8000)
    expect(suggestedRate({ ...m, payout_type: 'salary' }, { shootName: 'Wedding' })).toBeNull()
    expect(suggestedRate({ ...m, freelancer_rate: null, rate_wedding_day: null, rate_half_day: null })).toBeNull()
  })
})

describe('sameCrewPlan', () => {
  const T = (id: string, name: string, day: string, req: { name: string; quantity: number }[], hours = true) => ({
    id,
    name,
    start_at: hours ? `${day}T10:00:00.000Z` : null,
    end_at: hours ? `${day}T16:00:00.000Z` : null,
    requirements: req.map((r) => ({ service_id: '00000000-0000-4000-8000-000000000000', ...r })),
  })
  const crew = [
    { user_id: 'u1', name: 'Rahul', role: 'Candid' },
    { user_id: 'u2', name: 'Neha', role: 'Cinematic' },
  ]

  it('books the same people in the same roles at each day’s hours', () => {
    const plan = sameCrewPlan({ crew, targets: [T('m', 'Mehendi', '2026-11-10', [{ name: 'Candid', quantity: 1 }, { name: 'Cinematic', quantity: 1 }])], slots: [] })
    expect(plan.book.map((b) => [b.user_id, b.service_name, b.start_at])).toEqual([
      ['u1', 'Candid', '2026-11-10T10:00:00.000Z'],
      ['u2', 'Cinematic', '2026-11-10T10:00:00.000Z'],
    ])
    expect(plan.skipped).toEqual([])
  })

  it('skips busy people, full or unneeded roles, leave, and days with no hours', () => {
    const targets = [
      T('w', 'Wedding', '2026-11-12', [{ name: 'Candid', quantity: 1 }]),
      T('r', 'Reception', '2026-11-13', [{ name: 'Candid', quantity: 1 }, { name: 'Cinematic', quantity: 1 }]),
      T('x', 'Sangeet', '2026-11-11', [{ name: 'Candid', quantity: 1 }], false),
    ]
    const slots = [
      slot({ id: 's1', user_id: 'u1', shoot_id: 'other', start_at: '2026-11-12T12:00:00.000Z', end_at: '2026-11-12T14:00:00.000Z', status: 'booked' }),
      slot({ id: 's2', user_id: 'u9', shoot_id: 'r', service_name: 'Candid', start_at: '2026-11-13T10:00:00.000Z', end_at: '2026-11-13T16:00:00.000Z', status: 'booked' }),
    ]
    const leaves = [{ user_id: 'u2', start_date: '2026-11-13', end_date: '2026-11-13', half_day: false, status: 'approved' as const }]
    const plan = sameCrewPlan({ crew, targets, slots, leaves })
    expect(plan.book).toEqual([])
    expect(plan.skipped.map((s) => `${s.name}@${s.shoot_name}:${s.why}`)).toEqual([
      'Rahul@Wedding:busy',
      'Neha@Wedding:not_needed',
      'Rahul@Reception:full',
      'Neha@Reception:leave',
      'Rahul@Sangeet:no_time',
      'Neha@Sangeet:no_time',
    ])
  })

  it('says what was booked and who was skipped', () => {
    expect(copyResultLine(2, [])).toBe('Booked 2 on the other days.')
    expect(copyResultLine(1, [{ user_id: 'u', name: 'Neha', shoot_name: 'Wedding', why: 'busy' }])).toBe(
      'Booked 1 on the other days. Skipped Neha on Wedding (busy then).',
    )
  })
})
