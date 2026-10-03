import { describe, expect, it } from 'vitest'
import type { PlanUsage } from '@ipc/contracts'
import { nearestLimit, perDay, usageBars } from './usage'

const starter: PlanUsage = {
  plan_key: 'starter_monthly',
  plan_name: 'Starter',
  tier: 'starter',
  limits: { projects_per_year: 30, team_logins: 3 },
  includes: [],
  used: { projects_per_year: 25, projects_per_month: 7, invoices_per_month: 4, team_logins: 1, enquiry_forms: 1 },
}

describe('usage bars', () => {
  it('draws only the limits the plan has, each in a sentence', () => {
    const bars = usageBars(starter)
    expect(bars.map((b) => b.line)).toEqual(['25 of 30 projects this year (April to March)', '1 of 3 team logins'])
    expect(bars.map((b) => b.tone)).toEqual(['near', 'calm'])
  })

  it('has no bars for an unlimited plan', () => {
    expect(usageBars({ ...starter, limits: {} })).toEqual([])
    expect(nearestLimit({ ...starter, limits: {} })).toBeNull()
  })

  it('names the fullest limit for the sidebar', () => {
    expect(nearestLimit(starter)?.line).toBe('25 of 30 projects this year (April to March)')
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
