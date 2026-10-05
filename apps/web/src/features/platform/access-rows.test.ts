import { describe, expect, it } from 'vitest'
import type { LegacyStudio, PlatformStudio } from '@ipc/contracts'
import { accessMessage, extendFrom, statusOf, toRows } from './access-rows'

const NOW = Date.parse('2026-10-04T06:30:00Z')
const studio = (over: Partial<PlatformStudio>): PlatformStudio => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Ark Pictures',
  owner_email: 'ark@example.com',
  plan_gate: 'active',
  plan_expiry: '2026-10-29T00:00:00Z',
  user_count: 2,
  project_count: 4,
  created_at: '2026-09-28T00:00:00Z',
  owner_name: 'Ahmed Raza',
  ...over,
})
const old = (over: Partial<LegacyStudio>): LegacyStudio => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  old_company_id: 'x',
  studio_name: 'Modern Memories',
  owner_name: 'Rajan Mehta',
  email: 'rajan@example.com',
  phone: '7206374525',
  plan: 'yearly',
  expires_at: '2026-10-26',
  old_created_at: '2026-09-26',
  joined_company_id: null,
  joined_name: null,
  carried_at: null,
  ...over,
})

describe('the studio access list', () => {
  it('reads each studio as active, on trial, expiring soon or expired', () => {
    expect(statusOf(studio({}), NOW)).toBe('active')
    expect(statusOf(studio({ plan_expiry: '2026-10-08T00:00:00Z' }), NOW)).toBe('soon')
    expect(statusOf(studio({ plan_gate: 'grandfathered', plan_expiry: null, access_until: '2026-11-01T00:00:00Z' }), NOW)).toBe('trial')
    expect(statusOf(studio({ plan_gate: 'expired' }), NOW)).toBe('expired')
  })

  it('puts the old app’s studios that have not joined beside the new ones, once', () => {
    const rows = toRows([studio({})], [old({}), old({ id: '00000000-0000-4000-8000-0000000000bb', joined_company_id: '00000000-0000-4000-8000-000000000001' })], NOW)
    expect(rows.map((r) => [r.kind, r.name, r.status, r.daysLeft])).toEqual([
      ['new', 'Ark Pictures', 'active', 25],
      ['old', 'Modern Memories', 'active', 22],
    ])
  })

  it('extends from the end date, or from today once access has ended', () => {
    const now = new Date('2026-10-04T12:00:00')
    expect(extendFrom('2026-10-28T00:00:00', 30, now)).toBe('2026-11-27')
    expect(extendFrom('2026-09-01T00:00:00', 30, now)).toBe('2026-11-03')
    expect(extendFrom(null, 90, now)).toBe('2027-01-02')
  })

  it('writes the access message in a sentence', () => {
    expect(accessMessage({ owner: 'Ahmed Raza', name: 'Ark Pictures', status: 'active', expires: '2026-10-28T00:00:00', daysLeft: 25 })).toBe(
      'Hi Ahmed, your Studio AutoPilot access for Ark Pictures is active until 28 Oct 2026 · 25 days left. Sign in: https://studioautopilot.in',
    )
    expect(accessMessage({ owner: null, name: 'Ark Pictures', status: 'expired', expires: null, daysLeft: 0 })).toMatch(/^Hi, your .* has ended\. Renew/)
  })
})
