import { describe, expect, it } from 'vitest'
import { nudge, payoutChoices, ROUND_AMOUNTS } from './payout-choices'

const memory = { people: { u1: [5000, 4500, 4000, 3500] }, roles: { 'Reels Editor': [4000, 6000] } }

describe('payout choices', () => {
  it('offers their rates, then what they were paid, then the role, then round amounts, each once', () => {
    const s = payoutChoices({ name: 'Asha Mehta', freelancer_rate: 5000, rate_wedding_day: 8000, rate_half_day: null }, 'Reels Editor', memory, 'u1')
    expect(s.map((x) => x.title)).toEqual(['Their rates', 'Paid Asha before', 'Usually for Reels Editor', 'Pick an amount'])
    expect(s[0]!.choices).toEqual([
      { amount: 5000, why: 'their day rate' },
      { amount: 8000, why: 'their wedding rate' },
    ])
    // 5000 already offered as their rate; three at most.
    expect(s[1]!.choices.map((c) => c.amount)).toEqual([4500, 4000, 3500])
    // 4000 already offered; 6000 is new.
    expect(s[2]!.choices.map((c) => c.amount)).toEqual([6000])
    const round = s[3]!.choices.map((c) => c.amount)
    expect(round).not.toContain(5000)
    expect(round).not.toContain(4000)
    expect(round.length).toBe(ROUND_AMOUNTS.length - 4)
  })

  it('skips empty sections, so a new person gets just the round amounts', () => {
    const s = payoutChoices({ name: null, freelancer_rate: null, rate_wedding_day: null, rate_half_day: null }, 'Drone', undefined, 'x')
    expect(s.map((x) => x.title)).toEqual(['Pick an amount'])
  })

  it('nudges by ₹500 and never below zero', () => {
    expect(nudge(5000, 1)).toBe(5500)
    expect(nudge(4750, -1)).toBe(4500)
    expect(nudge(300, -1)).toBe(0)
  })
})
