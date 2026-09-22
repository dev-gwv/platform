import { describe, expect, it } from 'vitest'
import { deriveIntraState, matchStudioState, toAmount } from './invoice-math'

describe('toAmount', () => {
  it('keeps paise', () => {
    expect(toAmount('1500.50')).toBe(1500.5)
    expect(toAmount('0.05')).toBe(0.05)
  })

  // The bug this whole string-drafts change exists for: held as a number, a
  // rate re-rendered as "1500" the moment the dot was typed, so the second
  // decimal place could never be reached.
  it('survives the half-typed decimal point', () => {
    expect(toAmount('1500.')).toBe(1500)
  })

  it('treats an empty box as nothing owed, not an error', () => {
    expect(toAmount('')).toBe(0)
    expect(toAmount(' ')).toBe(0)
  })

  it('is 0 for anything that is not a number', () => {
    expect(toAmount('abc')).toBe(0)
    expect(toAmount('1,500')).toBe(0)
  })

  it('reads a quantity of 0 as 0 rather than falling back to 1', () => {
    expect(toAmount('0')).toBe(0)
  })
})

const STATES = [
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
] as const

describe('matchStudioState', () => {
  it('matches the company address name to a GST code', () => {
    expect(matchStudioState(STATES, 'Maharashtra')?.code).toBe('27')
  })

  it('ignores case and stray spacing, which an address field collects', () => {
    expect(matchStudioState(STATES, '  karnataka ')?.code).toBe('29')
  })

  it('gives nothing when the studio has no state set', () => {
    expect(matchStudioState(STATES, null)).toBeUndefined()
    expect(matchStudioState(STATES, '')).toBeUndefined()
    expect(matchStudioState(undefined, 'Maharashtra')).toBeUndefined()
  })

  it('gives nothing for a state name that is not a GST state', () => {
    expect(matchStudioState(STATES, 'Atlantis')).toBeUndefined()
  })
})

describe('deriveIntraState', () => {
  it('is CGST+SGST when the client is in the studio state', () => {
    expect(deriveIntraState('27', '27')).toBe(true)
  })

  it('is IGST when the client is elsewhere', () => {
    expect(deriveIntraState('29', '27')).toBe(false)
  })

  // null, not false: not knowing must leave the existing value alone rather
  // than quietly declaring every invoice inter-state.
  it('declines to answer when either state is unknown', () => {
    expect(deriveIntraState('', '27')).toBeNull()
    expect(deriveIntraState('27', null)).toBeNull()
    expect(deriveIntraState('27', undefined)).toBeNull()
  })
})
