import { describe, expect, it } from 'vitest'
import { profileLine } from './profile-line'

describe('profileLine', () => {
  it('names two things and counts the rest', () => {
    expect(profileLine(40, ['Photo', 'Phone', 'Address', 'Bank details', 'ID'])).toBe('Profile 40% done · add Photo, Phone +3 more')
  })
  it('names one or two without a count', () => {
    expect(profileLine(90, ['Photo'])).toBe('Profile 90% done · add Photo')
    expect(profileLine(80, ['Photo', 'Phone'])).toBe('Profile 80% done · add Photo, Phone')
  })
})
