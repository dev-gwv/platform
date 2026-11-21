import { describe, expect, it } from 'vitest'
import { oauthStateMatches, withOauthState } from './oauth-state'

describe('Facebook connect state', () => {
  it('puts the state on the Connect link, keeping what is there', () => {
    const url = withOauthState('https://www.facebook.com/v21.0/dialog/oauth?client_id=1&scope=a%2Cb', 'abc')
    const u = new URL(url)
    expect(u.searchParams.get('state')).toBe('abc')
    expect(u.searchParams.get('client_id')).toBe('1')
    expect(u.searchParams.get('scope')).toBe('a,b')
  })

  it('exchanges a code only when the state is the one this tab sent', () => {
    expect(oauthStateMatches('abc', 'abc')).toBe(true)
    expect(oauthStateMatches('abc', 'xyz')).toBe(false)
    expect(oauthStateMatches(null, 'abc')).toBe(false)
    expect(oauthStateMatches('abc', null)).toBe(false)
    expect(oauthStateMatches('', '')).toBe(false)
  })
})
