import { describe, expect, it } from 'vitest'
import type { Plan, PlanQuote } from '@ipc/contracts'
import { COMPARE, COMPARE_GROUPS, INCLUDED, planEnquiryMessage, quoteWords, tierPlans } from './plan-features'

const base = { currency: 'INR', duration_days: 365, billing_interval: 'yearly' as const, includes: [] as string[] }
const starter: Plan = {
  ...base,
  id: '00000000-0000-4000-8000-000000000001',
  key: 'starter_yearly',
  name: 'Starter',
  price: 17988,
  tier: 'starter',
  limits: { projects: 30, invoices: 30, leads: 30, team_logins: 3, team_members: 10, enquiry_forms: 2, facebook_pages: 1, brands: 1 },
}
const pro: Plan = { ...base, id: '00000000-0000-4000-8000-000000000002', key: 'pro_yearly', name: 'Pro', price: 29988, tier: 'pro', limits: { brands: 3 }, includes: ['drive_import'] }
const max: Plan = {
  ...base,
  id: '00000000-0000-4000-8000-000000000003',
  key: 'max_yearly',
  name: 'Studio Max',
  price: 47988,
  tier: 'max',
  limits: {},
  includes: ['white_label', 'whatsapp_api', 'sequences_auto', 'drive_import'],
}
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
const text = (c: ReturnType<(typeof COMPARE)[number]['cell']>) => (c.kind === 'text' ? c.text : c.kind)

describe('the pricing page', () => {
  const row = (label: string) => COMPARE.find((r) => r.label === label)!
  const across = (label: string) => [starter, pro, max].map((p) => text(row(label).cell(p)))

  it('shows every feature once as eight chips, and Compare plans in sections', () => {
    expect(INCLUDED).toHaveLength(8)
    expect(COMPARE_GROUPS.map((g) => g.title)).toEqual(['What you can make', 'Your team', 'Getting leads', 'Photo sharing (Frameline gallery)', 'In every plan', 'Extras'])
    expect(COMPARE_GROUPS.every((g) => g.rows.length <= 6)).toBe(true)
  })

  it('reads Starter numbers from the plan, and Unlimited on Pro and Studio Max', () => {
    expect(across('Projects')).toEqual(['30 a year', 'Unlimited', 'Unlimited'])
    expect(across('Leads held at a time')).toEqual(['30 at a time', 'Unlimited', 'Unlimited'])
    expect(across('Team logins')).toEqual(['3', 'Unlimited', 'Unlimited'])
    expect(across('Brands on one login')).toEqual(['1', '3', 'Unlimited'])
    expect(across('Your own name and logo (white label)')).toEqual(['no', 'no', 'yes'])
  })

  it('says what the gallery includes, with the Drive photos from the plan (0307)', () => {
    const proPhotos = { ...pro, limits: { ...pro.limits, gallery_photos: 25000 } }
    const maxPhotos = { ...max, limits: { gallery_photos: 75000 } }
    const r = row('Google Drive gallery photos included')
    expect([starter, proPhotos, maxPhotos].map((p) => text(r.cell(p)))).toEqual(['no', '25,000 photos', '75,000 photos'])
    expect(across('Import from Google Drive')).toEqual(['no', 'yes', 'yes'])
    expect(across('Galleries with a link, PIN and QR')).toEqual(['yes', 'yes', 'yes'])
    expect(across('More gallery photos')).toEqual(['no', 'Ask us', 'Ask us'])
  })

  it('counts by the year on the monthly plans too, never "a month" (0267)', () => {
    expect(text(COMPARE[0]!.cell({ ...starter, billing_interval: 'monthly' }))).toBe('30 a year')
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

describe('buying a plan is a WhatsApp message', () => {
  const who = { studio: 'Mehta Studios', name: 'Asha Mehta', email: 'asha@mehta.in', inr }

  it('names the plan, how it is paid, the price before GST and the login', () => {
    expect(planEnquiryMessage({ ...who, plan: pro })).toBe(
      [
        "Hi Studio AutoPilot team, I'm Asha Mehta from Mehta Studios.",
        "I'd like the Pro plan, paid yearly (₹29,988 + 18% GST).",
        'Login: asha@mehta.in',
        'Please call me to set it up.',
      ].join('\n'),
    )
  })

  it('says upgrade or renew when that is what paying would do', () => {
    expect(planEnquiryMessage({ ...who, plan: max, kind: 'upgrade' })).toContain("I'd like to upgrade to the Studio Max plan, paid yearly")
    expect(planEnquiryMessage({ ...who, plan: starter, kind: 'renew' })).toContain("I'd like to renew the Starter plan")
  })

  it('reads a monthly and a two-year plan in words', () => {
    expect(planEnquiryMessage({ ...who, plan: { ...pro, billing_interval: 'monthly', price: 2999 } })).toContain('paid monthly (₹2,999 + 18% GST)')
    expect(planEnquiryMessage({ ...who, plan: { name: '2-Year', price: 33000, billing_interval: 'biennial' } })).toContain('for 2 years (₹33,000')
  })

  it('leaves the login line out when there is no email', () => {
    expect(planEnquiryMessage({ ...who, email: null, plan: pro })).not.toContain('Login')
  })
})
