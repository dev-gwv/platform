import { describe, expect, it } from 'vitest'
import type { PlatformOffer, StudioActivity } from '@ipc/contracts'
import { activityLevel, lastActiveWords, madeLine, offerState } from './activity'

const a = (o: Partial<StudioActivity> = {}): StudioActivity => ({
  company_id: '00000000-0000-4000-8000-000000000001',
  projects: 0, invoices: 0, leads: 0, shoots: 0, team: 0,
  active_days_7: 0, active_days_30: 0, last_active: null, last_made: null, bought: false,
  ...o,
})

describe('how busy a studio is (0268)', () => {
  it('reads Busy, Trying it, Gone quiet and Never started', () => {
    expect(activityLevel(a({ active_days_7: 4, projects: 3 }))).toBe('busy')
    expect(activityLevel(a({ active_days_7: 4 }))).toBe('trying')
    expect(activityLevel(a({ active_days_7: 1, projects: 2 }))).toBe('trying')
    expect(activityLevel(a({ projects: 5, active_days_30: 2 }))).toBe('quiet')
    expect(activityLevel(a({ leads: 1 }))).toBe('quiet')
    expect(activityLevel(a())).toBe('never')
    expect(activityLevel(undefined)).toBe('never')
  })

  it('says what was made in one line, leaving out the zeros', () => {
    expect(madeLine(a({ projects: 12, invoices: 1, team: 5 }))).toBe('12 projects · 1 invoice · 5 team')
    expect(madeLine(a())).toBe('Nothing made yet')
  })

  it('says when the studio was last in, by India dates', () => {
    const now = Date.parse('2026-10-17T12:00:00+05:30')
    expect(lastActiveWords('2026-10-17T00:30:00+05:30', now)).toBe('Today')
    expect(lastActiveWords('2026-10-16T23:00:00+05:30', now)).toBe('Yesterday')
    expect(lastActiveWords('2026-10-14T10:00:00+05:30', now)).toBe('3 days ago')
    expect(lastActiveWords(null, now)).toBe('Not in 30 days')
  })
})

describe('where an offer stands', () => {
  const o = (x: Partial<PlatformOffer> = {}): PlatformOffer => ({
    id: '00000000-0000-4000-8000-0000000000aa', company_id: '00000000-0000-4000-8000-000000000001', studio: 'S',
    percent: 20, tiers: ['starter', 'pro', 'max'], for_diamond: false, ends_at: '2026-10-20T18:30:00Z', note: null,
    created_at: '2026-10-17T10:00:00Z', seen_at: null, asked_at: null, used_at: null, used_plan: null, cancelled_at: null, ...x,
  })
  const now = Date.parse('2026-10-18T10:00:00Z')
  it('moves Sent → Seen → Asked → Paid, and Ran out after its last day', () => {
    expect(offerState(o(), now).label).toBe('Sent')
    expect(offerState(o({ seen_at: 'x' }), now).label).toBe('Seen')
    expect(offerState(o({ seen_at: 'x', asked_at: 'x' }), now).label).toBe('Asked on WhatsApp')
    expect(offerState(o({ used_at: 'x', used_plan: 'pro_yearly_regular' }), now).label).toBe('Paid · pro yearly')
    expect(offerState(o({ cancelled_at: 'x' }), now).label).toBe('Ended')
    expect(offerState(o(), Date.parse('2026-10-21T00:00:00Z')).label).toBe('Ran out')
  })
})
