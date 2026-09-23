import { describe, expect, it } from 'vitest'
import type { TeamMember, TeamSlot } from '@ipc/contracts'
import {
  candidatesFor,
  clashFor,
  defaultWindowFields,
  overlaps,
  requirementFill,
  roleMatches,
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
  ...over,
})

let n = 0
const slot = (over: Partial<TeamSlot>): TeamSlot => ({
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

  it("uses the shoot's own hours, else 9am for four hours on its day", () => {
    expect(defaultWindowFields({ shoot_date: '2026-10-01', start_at: null, end_at: null })).toEqual({
      date: '2026-10-01',
      time: '09:00',
      hours: 4,
    })
    const s = new Date(2026, 9, 1, 16, 0)
    const e = new Date(2026, 9, 1, 22, 30)
    expect(
      defaultWindowFields({ shoot_date: '2026-10-01', start_at: s.toISOString(), end_at: e.toISOString() }),
    ).toEqual({ date: '2026-10-01', time: '16:00', hours: 6.5 })
  })
})
