import { describe, expect, it } from 'vitest'
import { guestCountFromText, guestCountText, guestsLabel } from './guests'

describe('guestsLabel', () => {
  it('says nothing until someone has said', () => {
    expect(guestsLabel(null)).toBeNull()
    expect(guestsLabel(undefined)).toBeNull()
  })

  it('reads in Indian grouping, one guest or many', () => {
    expect(guestsLabel(1)).toBe('1 guest')
    expect(guestsLabel(350)).toBe('350 guests')
    expect(guestsLabel(1200)).toBe('1,200 guests')
    expect(guestsLabel(0)).toBe('0 guests')
  })
})

describe('guestCountFromText', () => {
  it('reads a whole number, forgiving commas and spaces', () => {
    expect(guestCountFromText('350')).toBe(350)
    expect(guestCountFromText(' 1,200 ')).toBe(1200)
  })

  it('is blank for an empty box or anything that is not a headcount', () => {
    for (const t of ['', '  ', 'about 300', '-5', '2.5', '100001']) expect(guestCountFromText(t)).toBeNull()
  })

  it('round-trips through the box', () => {
    expect(guestCountFromText(guestCountText(450))).toBe(450)
    expect(guestCountText(null)).toBe('')
  })
})
