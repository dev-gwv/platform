import { describe, expect, it } from 'vitest'
import { offerFor, offerLastDay, offerPlansWords, offerPrice } from './offer'

const offer = { id: '00000000-0000-4000-8000-0000000000aa', percent: 20, tiers: ['starter', 'pro'] as ('starter' | 'pro' | 'max')[], for_diamond: false, ends_at: '2026-10-19T18:30:00Z', note: null }

describe('a personal offer on the price cards (0268)', () => {
  it('covers the plans it names, on the regular price unless it says Diamond too', () => {
    expect(offerFor(offer, { tier: 'pro' }, 'regular')).toBe(offer)
    expect(offerFor(offer, { tier: 'max' }, 'regular')).toBeNull()
    expect(offerFor(offer, { tier: 'pro' }, 'member')).toBeNull()
    expect(offerFor({ ...offer, for_diamond: true }, { tier: 'pro' }, 'member')).not.toBeNull()
    expect(offerFor(null, { tier: 'pro' }, 'regular')).toBeNull()
  })

  it('takes the percent off to the rupee', () => {
    expect(offerPrice(4999, 20)).toBe(3999)
    expect(offerPrice(35988, 10)).toBe(32389)
  })

  it('names the last day in India and the plans in words', () => {
    // Ends at midnight IST starting 20 Oct, so the last day is the 19th.
    expect(offerLastDay('2026-10-19T18:30:00Z')).toBe('Monday, 19 October')
    expect(offerPlansWords(['starter', 'pro', 'max'])).toBe('any plan')
    expect(offerPlansWords(['starter', 'pro'])).toBe('Starter or Pro')
  })
})
