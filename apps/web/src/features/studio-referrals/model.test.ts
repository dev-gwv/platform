import { describe, expect, it } from 'vitest'
import { referralState, summaryLine, termsLine } from './model'

const row = { paid_at: null, rewarded_at: null, reward_amount: null, void_reason: null }

describe('refer a studio model', () => {
  it('reads each state', () => {
    expect(referralState(row)).toEqual({ label: 'Joined · on trial', tone: 'blue' })
    expect(referralState({ ...row, paid_at: '2026-10-02' }).tone).toBe('green')
    expect(referralState({ ...row, paid_at: '2026-10-02', rewarded_at: '2026-10-09', reward_amount: 2000 }).label).toBe('Rewarded ₹2,000')
    expect(referralState({ ...row, void_reason: 'Same owner' }).tone).toBe('rose')
  })

  it('says the terms are being finalised until they are set', () => {
    expect(termsLine({ reward: null, discount_pct: null, hold_days: null })).toMatch(/being finalised/)
    expect(termsLine({ reward: 2000, discount_pct: 10, hold_days: 30 })).toBe(
      '₹2,000 for every studio that starts a paid plan, and they get 10% off their first plan. Your reward is due 30 days after they pay.',
    )
    expect(termsLine({ reward: null, discount_pct: 15, hold_days: null })).toBe('They get 15% off their first plan.')
  })

  it('sums up who joined', () => {
    expect(summaryLine([])).toMatch(/No studios yet/)
    expect(summaryLine([row, { ...row, paid_at: 'x' }, { ...row, void_reason: 'dup' }])).toBe('2 studios joined · 1 on a paid plan')
    expect(summaryLine([row])).toBe('1 studio joined · none on a paid plan yet')
  })
})
