import { describe, expect, it } from 'vitest'
import type { Plan } from '@ipc/contracts'
import { bestSaving, monthlyOf, percentOff, savingWords, sectionOrder, twinOf, withGst } from './price-lists'

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`
let n = 0
const p = (tier: Plan['tier'], billing_interval: Plan['billing_interval'], price: number, monthly_equivalent?: number): Plan => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  key: `${tier}_${billing_interval}`,
  name: String(tier),
  price,
  billing_interval,
  tier,
  monthly_equivalent: monthly_equivalent ?? null,
})

const regular = [
  p('starter', 'yearly', 35988, 2999),
  p('starter', 'monthly', 3999),
  p('pro', 'yearly', 59988, 4999),
  p('pro', 'monthly', 5999),
  p('max', 'yearly', 95988, 7999),
  p('max', 'monthly', 9999),
]
const member = [
  p('starter', 'yearly', 17988, 1499),
  p('starter', 'monthly', 1999),
  p('pro', 'yearly', 29988, 2499),
  p('pro', 'monthly', 2999),
  p('max', 'yearly', 47988, 3999),
  p('max', 'monthly', 4999),
]

describe('the two price lists', () => {
  it('pairs each member plan with the same plan at the regular price, paid the same way', () => {
    expect(twinOf(member[2]!, regular)).toBe(regular[2])
    expect(twinOf(member[3]!, regular)).toBe(regular[3])
    expect(twinOf(member[0]!, undefined)).toBeUndefined()
  })

  it('says what a member saves in the way the plan is paid', () => {
    expect(savingWords(member[0]!, regular[0], inr)).toBe('Save ₹18,000 a year')
    expect(savingWords(member[1]!, regular[1], inr)).toBe('Save ₹2,000 a month')
    expect(savingWords(member[4]!, regular[4], inr)).toBe('Save ₹48,000 a year')
    // Nothing to say when the member price is not lower, or there is no regular twin.
    expect(savingWords(regular[0]!, member[0], inr)).toBeNull()
    expect(savingWords(member[0]!, undefined, inr)).toBeNull()
  })

  it('heads the Diamond section with the biggest saving', () => {
    expect(bestSaving(member.filter((x) => x.billing_interval === 'yearly'), regular)).toBe(48000)
    expect(bestSaving(member.filter((x) => x.billing_interval === 'monthly'), regular)).toBe(5000)
    expect(bestSaving(member, [])).toBe(0)
  })

  it('reads about half off', () => {
    expect(percentOff(member[0]!, regular[0])).toBe(50)
    expect(percentOff(member[1]!, regular[1])).toBe(50)
    expect(percentOff(member[0]!, undefined)).toBe(0)
  })

  it('puts the regular price first until the studio is a verified member', () => {
    expect(sectionOrder(false)).toEqual(['regular', 'member'])
    expect(sectionOrder(true)).toEqual(['member', 'regular'])
  })

  it('keeps the month and GST sums', () => {
    expect(monthlyOf(member[0]!)).toBe(1499)
    expect(monthlyOf(member[1]!)).toBe(1999)
    expect(monthlyOf(p('pro', 'yearly', 12000))).toBe(1000)
    expect(withGst(1999)).toBe(2359)
  })
})
