import { describe, expect, it } from 'vitest'
import type { PlanUsage } from '@ipc/contracts'
import { nearestLimit, usageBars } from './usage'

const starter: PlanUsage = {
  plan_key: 'starter_monthly',
  plan_name: 'Starter',
  tier: 'starter',
  limits: { projects_per_month: 8, invoices_per_month: 25, team_logins: 5, enquiry_forms: 3 },
  includes: [],
  used: { projects_per_month: 7, invoices_per_month: 4, team_logins: 5, enquiry_forms: 1 },
}

describe('usage bars', () => {
  it('draws only the limits the plan has, each in a sentence', () => {
    const bars = usageBars(starter)
    expect(bars.map((b) => b.line)).toEqual(['7 of 8 projects this month', '4 of 25 invoices this month', '5 of 5 team logins', '1 of 3 enquiry forms'])
    expect(bars.map((b) => b.tone)).toEqual(['near', 'calm', 'full', 'calm'])
  })

  it('has no bars for an unlimited plan', () => {
    expect(usageBars({ ...starter, limits: {} })).toEqual([])
    expect(nearestLimit({ ...starter, limits: {} })).toBeNull()
  })

  it('names the fullest limit for the sidebar', () => {
    expect(nearestLimit(starter)?.line).toBe('5 of 5 team logins')
  })
})
