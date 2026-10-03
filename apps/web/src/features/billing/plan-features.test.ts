import { describe, expect, it } from 'vitest'
import type { Plan, PlanQuote } from '@ipc/contracts'
import { COMPARE, INCLUDED, quoteWords, tierPlans } from './plan-features'

const base = { currency: 'INR', duration_days: 365, billing_interval: 'yearly' as const, includes: [] as string[] }
const starter: Plan = {
  ...base,
  id: '00000000-0000-4000-8000-000000000001',
  key: 'starter_yearly',
  name: 'Starter',
  price: 17988,
  tier: 'starter',
  limits: { projects: 30, invoices: 60, leads: 300, team_logins: 3, team_members: 20, enquiry_forms: 2, facebook_pages: 1 },
}
const pro: Plan = { ...base, id: '00000000-0000-4000-8000-000000000002', key: 'pro_yearly', name: 'Pro', price: 29988, tier: 'pro', limits: {} }
const max: Plan = {
  ...base,
  id: '00000000-0000-4000-8000-000000000003',
  key: 'max_yearly',
  name: 'Studio Max',
  price: 47988,
  tier: 'max',
  limits: {},
  includes: ['white_label', 'whatsapp_api', 'sequences_auto'],
}
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
const text = (c: ReturnType<(typeof COMPARE)[number]['cell']>) => (c.kind === 'text' ? c.text : c.kind)

describe('the pricing page stays short', () => {
  it('shows every feature once as eight chips, and compares only what differs', () => {
    expect(INCLUDED).toHaveLength(8)
    expect(COMPARE.length).toBeLessThanOrEqual(9)
  })

  it('reads Starter numbers from the plan, and Unlimited on Pro and Studio Max', () => {
    expect(COMPARE.map((r) => text(r.cell(starter)))).toEqual(['30 a year', '300 a year', '60 a year', '3', '20', '2', '1', 'no', 'no'])
    expect(COMPARE.map((r) => text(r.cell(pro)))).toEqual([...Array(7).fill('Unlimited'), 'no', 'no'])
    expect(COMPARE.map((r) => text(r.cell(max)))).toEqual([...Array(7).fill('Unlimited'), 'yes', 'yes'])
  })

  it('says "a month" on the monthly plans', () => {
    expect(text(COMPARE[0]!.cell({ ...starter, billing_interval: 'monthly', limits: { projects: 3 } }))).toBe('3 a month')
  })

  it('puts the three plans for one way of paying in order', () => {
    const monthly = { ...pro, id: '00000000-0000-4000-8000-000000000004', billing_interval: 'monthly' as const }
    expect(tierPlans([max, monthly, starter, pro], 'yearly').map((p) => p.name)).toEqual(['Starter', 'Pro', 'Studio Max'])
  })
})

describe('what the plan button says', () => {
  const q = (over: Partial<PlanQuote>): PlanQuote => ({
    plan_id: pro.id,
    kind: 'buy',
    credit: 0,
    amount: 35385.84,
    current_name: null,
    blocked_until: null,
    ...over,
  })

  it('chooses, renews, or upgrades for the difference', () => {
    expect(quoteWords(pro, q({}), inr).button).toBe('Choose Pro')
    expect(quoteWords(pro, q({ kind: 'renew', current_name: 'Pro' }), inr).button).toBe('Renew Pro')
    expect(quoteWords(pro, q({ kind: 'upgrade', credit: 9748, amount: 23885, current_name: 'Starter' }), inr)).toEqual({
      button: 'Upgrade to Pro',
      line: '₹23,885 today with GST · ₹9,748 left on Starter comes off',
      disabled: false,
    })
  })

  it('waits for the current plan to end before a lower one', () => {
    const w = quoteWords(starter, q({ kind: 'later', current_name: 'Pro', blocked_until: '2027-10-14T10:00:00Z' }), inr)
    expect(w).toEqual({ button: 'From 14 Oct 2027', line: 'When your Pro plan ends', disabled: true })
  })
})
