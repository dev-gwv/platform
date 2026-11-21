import { describe, expect, it } from 'vitest'
import { defaultIntent, looksLike } from './intents'

describe('Reply with AI: the screen', () => {
  it('starts on the reply that fits where the lead is', () => {
    expect(defaultIntent({ status: 'new', contacted_status: 'uncontacted' })).toBe('first_reply')
    expect(defaultIntent({ status: 'new', contacted_status: 'contacted' })).toBe('ask_call')
    expect(defaultIntent({ status: 'proposal_sent' })).toBe('quote_follow_up')
    expect(defaultIntent({ status: 'converted' })).toBe('booked_thanks')
    expect(defaultIntent({ status: 'lost' })).toBe('win_back')
  })

  it('notices a client who writes in Hindi or Hinglish', () => {
    expect(looksLike('शादी की फोटो का पैकेज क्या है?')).toBe('hi')
    expect(looksLike('Bhai package kitna hai? shaadi feb mein hai')).toBe('hinglish')
    expect(looksLike('What is your price for a wedding?')).toBeNull()
  })
})
