import { describe, expect, it } from 'vitest'
import { BUILT_IN_TEMPLATES, PAYMENT_PRESETS, advanceAndBalance, fillPlaceholders, presetTerms } from './templates'

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`

describe('terms templates', () => {
  it('puts the studio’s own Mulberry Weddings terms first, on 30/30/30/10', () => {
    const m = BUILT_IN_TEMPLATES[0]!
    expect(m.key).toBe('mulberry')
    expect(m.preset).toBe('30-30-30-10')
    expect(m.body).toContain('Raw photographs will be shared within 7–10 days')
    expect(m.body).toContain('13. Acknowledgement')
    expect(PAYMENT_PRESETS.some((p) => p.key === m.preset)).toBe(true)
  })

  it('fills the advance and the balance from the plan and the total', () => {
    const plan = presetTerms(PAYMENT_PRESETS.find((p) => p.key === '30-30-30-10')!)
    const ab = advanceAndBalance(plan, 200000, fmt)
    expect(ab).toEqual({ advance: '₹60,000', balance: '₹1,40,000' })
    const text = fillPlaceholders('Pay {{advance}} now and {{ balance }} later, {{client_name}}.', {
      client_name: 'Priya',
      project_name: 'P',
      studio_name: 'S',
      total: '₹2,00,000',
      event_date: '',
      ...ab!,
    })
    expect(text).toBe('Pay ₹60,000 now and ₹1,40,000 later, Priya.')
    expect(advanceAndBalance(plan, 0, fmt)).toBeNull()
  })
})
