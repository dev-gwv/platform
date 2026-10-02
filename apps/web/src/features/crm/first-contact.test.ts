import { describe, expect, it } from 'vitest'
import { firstContactWords } from './first-contact'

const at = (min: number) => new Date(Date.parse('2026-10-02T04:00:00Z') + min * 60_000).toISOString()

describe('firstContactWords', () => {
  it('reads minutes, hours and days', () => {
    expect(firstContactWords(at(0), at(0))).toBe('First contact within a minute')
    expect(firstContactWords(at(0), at(25))).toBe('First contact in 25 min')
    expect(firstContactWords(at(0), at(130))).toBe('First contact in 2 h')
    expect(firstContactWords(at(0), at(60 * 24))).toBe('First contact in 1 day')
    expect(firstContactWords(at(0), at(60 * 72))).toBe('First contact in 3 days')
  })
  it('says nothing before anyone reached them', () => {
    expect(firstContactWords(at(0), null)).toBeNull()
  })
})
