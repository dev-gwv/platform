import { describe, expect, it } from 'vitest'
import type { PlanUsage } from '@ipc/contracts'
import { nearestLimit, perDay, usageBars, windowLine } from './usage'

const used = { projects: 25, leads: 120, invoices: 10, team_logins: 1, team_members: 6, enquiry_forms: 1, facebook_pages: 0, packages: 1, storage_mb: 300 }
const starter: PlanUsage = {
  plan_key: 'starter_yearly',
  plan_name: 'Starter',
  tier: 'starter',
  limits: { projects: 30, leads: 300, team_logins: 3, storage_mb: 2048 },
  includes: [],
  used,
  window_starts: '2026-10-15T06:30:00Z',
  window_ends: '2027-10-15T06:30:00Z',
  period: 'year',
}

describe('usage bars', () => {
  it('draws only the limits the plan has, each in a sentence', () => {
    const bars = usageBars(starter)
    expect(bars.map((b) => b.line)).toEqual([
      '25 of 30 projects this year',
      '120 of 300 leads this year',
      '1 of 3 team logins',
      '0.3 of 2 GB of uploads',
    ])
    expect(bars.map((b) => b.tone)).toEqual(['near', 'calm', 'calm', 'calm'])
  })

  it('says "this month" on a monthly pass', () => {
    expect(usageBars({ ...starter, period: 'month', limits: { projects: 3 }, used: { ...used, projects: 3 } })[0]).toMatchObject({
      line: '3 of 3 projects this month',
      tone: 'full',
    })
  })

  it('has no bars for an unlimited plan', () => {
    expect(usageBars({ ...starter, limits: {} })).toEqual([])
    expect(nearestLimit({ ...starter, limits: {} })).toBeNull()
  })

  it('names the fullest limit for the sidebar', () => {
    expect(nearestLimit(starter)?.line).toBe('25 of 30 projects this year')
  })

  it('says when the counts start again, from the day the studio paid', () => {
    expect(windowLine(starter)).toBe('Counts start again on 15 Oct 2027')
    expect(windowLine({ ...starter, limits: { team_logins: 3 } })).toBeNull()
  })
})

describe('per-day price', () => {
  it('says what a yearly plan costs a day, and nothing for monthly', () => {
    expect(perDay({ price: 17988, duration_days: 365, billing_interval: 'yearly' })).toBe(49)
    expect(perDay({ price: 29988, duration_days: 365, billing_interval: 'yearly' })).toBe(82)
    expect(perDay({ price: 47988, duration_days: 365, billing_interval: 'yearly' })).toBe(131)
    expect(perDay({ price: 2999, duration_days: 30, billing_interval: 'monthly' })).toBeNull()
  })
})
