import { describe, expect, it } from 'vitest'
import type { PlatformPlan } from '@ipc/contracts'
import { byAudience, limitWords, planLabel, priceWords } from './plan-rows'

const row = (o: Partial<PlatformPlan>): PlatformPlan => ({
  id: '00000000-0000-4000-8000-000000000001',
  key: 'k',
  name: 'Plan',
  price: 1000,
  billing_interval: 'yearly',
  duration_days: 365,
  audience: 'outsider',
  is_active: true,
  ...o,
})

describe('Platform → Plans in words', () => {
  it('reads a price with how often it is paid', () => {
    expect(priceWords(row({ price: 17988 }))).toBe('₹17,988 a year')
    expect(priceWords(row({ price: 1999, billing_interval: 'monthly' }))).toBe('₹1,999 a month')
    expect(priceWords(row({ price: 33000, billing_interval: 'biennial' }))).toBe('₹33,000 for 2 years')
  })

  it('reads Starter\'s limits in one line, and none as Unlimited', () => {
    expect(limitWords(row({ limits: { projects: 30, leads: 300, invoices: 60, team_logins: 3, team_members: 20, packages: 3 } }))).toBe(
      '30 projects, 300 leads, 60 invoices a year · 3 logins · 20 crew',
    )
    expect(limitWords(row({ billing_interval: 'monthly', limits: { projects: 3, leads: 25, invoices: 5, team_logins: 3 } }))).toBe(
      '3 projects, 25 leads, 5 invoices a month · 3 logins',
    )
    expect(limitWords(row({ limits: {} }))).toBe('Unlimited')
    expect(limitWords(row({}))).toBe('Unlimited')
  })

  it('names a plan so both audiences and both ways of paying read apart', () => {
    expect(planLabel(row({ name: 'Starter', tier: 'starter' }))).toBe('Starter, yearly')
    expect(planLabel(row({ name: 'Starter', tier: 'starter', billing_interval: 'monthly' }))).toBe('Starter, monthly')
    expect(planLabel(row({ name: 'Monthly', audience: 'diamond' }))).toBe('Member Monthly')
    expect(planLabel(row({ name: 'Yearly', tier: null }))).toBe('Yearly (old)')
  })

  it('groups outsiders first, plans on sale before those off sale', () => {
    const groups = byAudience([
      row({ key: 'ipc_yearly', audience: 'diamond', sort_order: 110 }),
      row({ key: 'studio_yearly', is_active: false, sort_order: 90 }),
      row({ key: 'pro_yearly', sort_order: 20 }),
      row({ key: 'starter_yearly', sort_order: 10 }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['outsider', 'diamond'])
    expect(groups[0]!.plans.map((p) => p.key)).toEqual(['starter_yearly', 'pro_yearly', 'studio_yearly'])
  })
})
