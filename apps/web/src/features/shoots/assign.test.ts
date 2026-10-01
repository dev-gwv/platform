import { describe, expect, it } from 'vitest'
import type { TeamMember, TeamSlot } from '@ipc/contracts'
import {
  availabilityLine,
  candidatesFor,
  clashFor,
  dayLoad,
  defaultWindowFields,
  freeFrom,
  gapBetween,
  nearestClash,
  normalizePicks,
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

  it('treats back-to-back as fine, and a buffer as the gap they need', () => {
    const a = { start: '2026-10-01T04:00:00Z', end: '2026-10-01T08:00:00Z' }
    const b = { start: '2026-10-01T08:00:00Z', end: '2026-10-01T10:00:00Z' }
    expect(overlaps(a, b)).toBe(false)
    expect(overlaps(a, b, 60)).toBe(true)
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

describe('by the clock: nearest clash, tight vs busy, the day', () => {
  const IST = 'Asia/Kolkata'
  // 10:30–14:30 IST on 1 Oct (the fixture's default booking).
  const booking = () => slot({ user_id: 'u1', shoot_id: OTHER, shoot_name: 'Sharma wedding' })

  it('measures the gap between two windows, negative when they overlap', () => {
    const a = { start: '2026-10-01T04:00:00Z', end: '2026-10-01T08:00:00Z' }
    expect(gapBetween(a, { start: '2026-10-01T08:30:00Z', end: '2026-10-01T10:00:00Z' })).toBe(30)
    expect(gapBetween({ start: '2026-10-01T08:30:00Z', end: '2026-10-01T10:00:00Z' }, a)).toBe(30)
    expect(gapBetween(a, { start: '2026-10-01T07:00:00Z', end: '2026-10-01T10:00:00Z' })).toBe(-60)
    expect(gapBetween(a, { start: '2026-10-01T08:00:00Z', end: '2026-10-01T10:00:00Z' })).toBe(0)
  })

  it('picks the closer of two bookings, and ignores the one being changed', () => {
    const far = slot({ user_id: 'u1', start_at: '2026-10-01T00:00:00Z', end_at: '2026-10-01T02:00:00Z' })
    const near = slot({ user_id: 'u1', start_at: '2026-10-01T03:00:00Z', end_at: '2026-10-01T04:00:00Z' })
    const w = { start: '2026-10-01T04:30:00Z', end: '2026-10-01T06:00:00Z' }
    expect(nearestClash('u1', w, [far, near], { bufferMin: 180 })).toMatchObject({ slot: { id: near.id }, gapMin: 30 })
    expect(nearestClash('u1', w, [far, near], { bufferMin: 180, ignoreSlotId: near.id })?.slot.id).toBe(far.id)
    expect(nearestClash('u1', w, [far, near], { bufferMin: 0 })).toBeNull()
  })

  it('tells a tight gap from a real overlap, and ranks free, tight, busy', () => {
    const members = [member('u1', 'Rahul', { role_names: ['Photographer'] }), member('u2', 'Bala')]
    const base = { members, requirement: 'Photographer', shootId: SHOOT, slots: [booking()] }
    const tight = candidatesFor({ ...base, window: { start: '2026-10-01T09:00:00Z', end: '2026-10-01T11:00:00Z' }, bufferMin: 60 })
    expect(tight[0]!.member.name).toBe('Bala')
    expect(tight[1]!.availability).toMatchObject({ state: 'tight', gapMin: 30 })
    const busy = candidatesFor({ ...base, window: { start: '2026-10-01T08:00:00Z', end: '2026-10-01T10:00:00Z' }, bufferMin: 60 })
    expect(busy[1]!.availability).toMatchObject({ state: 'busy', onThisShoot: false })
    const free = candidatesFor({ ...base, window: { start: '2026-10-01T09:00:00Z', end: '2026-10-01T11:00:00Z' }, bufferMin: 0 })
    expect(free[0]!.availability.state).toBe('free')
    expect(free[0]!.member.name).toBe('Rahul')
  })

  it('knows when the clash is this very shoot, in another role', () => {
    const members = [member('u1', 'Rahul')]
    const out = candidatesFor({
      members,
      requirement: 'Drone',
      window: { start: '2026-10-01T05:00:00Z', end: '2026-10-01T07:00:00Z' },
      shootId: SHOOT,
      slots: [slot({ user_id: 'u1', shoot_id: SHOOT, service_name: 'Candid Photographer' })],
    })
    expect(out[0]!.availability).toMatchObject({ state: 'busy', onThisShoot: true })
    expect(availabilityLine(out[0]!, { hours: 0, slots: [], left: 24 }, 2, 60, IST).text).toBe('Already on this shoot as Candid Photographer')
  })

  it("adds up a person's day, counting only the part of a booking on that day", () => {
    const day = slot({ user_id: 'u1', start_at: '2026-10-01T04:30:00Z', end_at: '2026-10-01T09:30:00Z' }) // 5 h
    const evening = slot({ user_id: 'u1', start_at: '2026-10-01T13:30:00Z', end_at: '2026-10-01T16:30:00Z' }) // 3 h
    const gone = slot({ user_id: 'u1', status: 'released', start_at: '2026-10-01T10:00:00Z', end_at: '2026-10-01T12:00:00Z' })
    const other = slot({ user_id: 'u2', start_at: '2026-10-01T10:00:00Z', end_at: '2026-10-01T12:00:00Z' })
    const load = dayLoad('u1', '2026-10-01', [evening, gone, other, day])
    expect(load).toMatchObject({ hours: 8, left: 16 })
    expect(load.slots.map((s) => s.id)).toEqual([day.id, evening.id])
    expect(dayLoad('u1', '2026-10-01', [day, evening], { ignoreSlotId: evening.id }).hours).toBe(5)
    // Past midnight local: the part before midnight on the 1st, the rest on the 2nd.
    const late = slot({
      user_id: 'u1',
      start_at: new Date(2026, 9, 1, 22, 0).toISOString(),
      end_at: new Date(2026, 9, 2, 3, 0).toISOString(),
    })
    expect(dayLoad('u1', '2026-10-01', [late]).hours).toBe(2)
    expect(dayLoad('u1', '2026-10-02', [late]).hours).toBe(3)
    // A full day and more never reads as negative hours left.
    const marathon = slot({ user_id: 'u1', start_at: new Date(2026, 9, 1, 0, 0).toISOString(), end_at: new Date(2026, 9, 2, 2, 0).toISOString() })
    expect(dayLoad('u1', '2026-10-01', [marathon])).toMatchObject({ hours: 24, left: 0 })
  })

  it('says when they are free again: the end plus the gap', () => {
    expect(freeFrom({ end_at: '2026-10-01T08:30:00Z' }, 60)).toBe('2026-10-01T09:30:00.000Z')
    expect(freeFrom({ end_at: '2026-10-01T08:30:00Z' })).toBe('2026-10-01T08:30:00.000Z')
  })

  it('labels times and ranges the way a studio says them', () => {
    expect(timeLabel('2026-10-01T10:30:00Z', IST)).toBe('4 PM')
    expect(timeLabel('2026-10-01T10:45:00Z', IST)).toBe('4:15 PM')
    expect(rangeLabel({ start: '2026-10-01T10:30:00Z', end: '2026-10-01T15:30:00Z' }, IST)).toBe('4–9 PM · 5 h')
    expect(rangeLabel({ start: '2026-10-01T05:30:00Z', end: '2026-10-01T09:30:00Z' }, IST)).toBe('11 AM–3 PM · 4 h')
    expect(rangeLabel({ start: '2026-10-01T10:30:00Z', end: '2026-10-01T13:00:00Z' }, IST)).toBe('4–6:30 PM · 2.5 h')
  })

  it('writes the one line under a name', () => {
    const free = { availability: { state: 'free' as const } }
    expect(availabilityLine(free, { hours: 0, slots: [], left: 24 }, 5, 60, IST)).toEqual({ tone: 'green', text: 'Free all day' })
    const b = booking()
    expect(availabilityLine(free, { hours: 4, slots: [b], left: 20 }, 5, 60, IST)).toEqual({
      tone: 'green',
      text: 'Free · also 10 AM–2 PM, Sharma wedding · 20 h left',
    })
    expect(availabilityLine(free, { hours: 21, slots: [b], left: 3 }, 5, 60, IST)).toMatchObject({ tone: 'amber', text: expect.stringMatching(/^Only 3 h left today/) })
    expect(availabilityLine({ availability: { state: 'tight', slot: b, gapMin: 30 } }, { hours: 4, slots: [b], left: 20 }, 2, 60, IST)).toEqual({
      tone: 'amber',
      text: 'Tight · only 30 min from Sharma wedding (10 AM–2 PM), needs 1 h',
    })
    expect(availabilityLine({ availability: { state: 'busy', slot: b, onThisShoot: false } }, { hours: 4, slots: [b], left: 20 }, 2, 60, IST)).toEqual({
      tone: 'muted',
      text: 'Busy 10 AM–2 PM, Sharma wedding · free from 3 PM',
    })
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
