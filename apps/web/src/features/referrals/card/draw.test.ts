import { describe, expect, it } from 'vitest'
import { cardCode, offerHeadline, shareText, validWords, wrap } from './draw'

describe('referral card', () => {
  it('says what the friend gets, the studio’s words first', () => {
    expect(offerHeadline('fixed', 10000, null)).toBe('₹10,000 off your booking')
    expect(offerHeadline('percentage', 10, '')).toBe('10% off your booking')
    expect(offerHeadline('free_addon', 0, 'Free pre-wedding shoot')).toBe('Free pre-wedding shoot')
    expect(offerHeadline('none', 0, null)).toBe('A special welcome when you book')
  })

  it('reads the date and the code the way people do', () => {
    expect(validWords('2027-03-31')).toBe('31 Mar 2027')
    expect(validWords(null)).toBeNull()
    expect(cardCode('priya-wedding-referrals-a1b2c3')).toBe('A1B2C3')
    expect(cardCode('old')).toBe('OLD')
  })

  it('wraps to the width and cuts the last line', () => {
    const m = (s: string) => s.length * 10
    expect(wrap(m, 'one two three four', 100)).toEqual(['one two', 'three four'])
    expect(wrap(m, 'aaaa bbbb cccc dddd eeee ffff', 90, 2)).toEqual(['aaaa bbbb', 'cccc ddd…'])
  })

  it('writes the WhatsApp message with the offer, code and link', () => {
    const t = shareText({
      studio: 'Cine World',
      from: 'Priya & Rahul',
      friendType: 'fixed',
      friendValue: 10000,
      friendTitle: null,
      code: 'priya-abc123',
      link: 'https://studioautopilot.in/refer/priya-abc123',
      validUntil: '2027-03-31',
    })
    expect(t).toContain('Priya & Rahul is inviting you to Cine World')
    expect(t).toContain('₹10,000 off your booking')
    expect(t).toContain('Gift code: ABC123')
    expect(t).toContain('Tap to claim it: https://studioautopilot.in/refer/priya-abc123')
    expect(t).toContain('Valid till 31 Mar 2027.')
  })
})
