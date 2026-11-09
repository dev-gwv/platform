import { describe, expect, it } from 'vitest'
import { fitWithin, sizeWords } from './shrink'

describe('photo shrinking', () => {
  it('keeps the long side within the size, the shape kept', () => {
    expect(fitWithin(6000, 4000, 2400)).toEqual([2400, 1600])
    expect(fitWithin(4000, 6000, 2400)).toEqual([1600, 2400])
    expect(fitWithin(1200, 800, 2400)).toEqual([1200, 800])
  })
  it('says sizes in words', () => {
    expect(sizeWords(28.4 * 1024 * 1024)).toBe('28.4 MB')
    expect(sizeWords(860 * 1024)).toBe('860 KB')
  })
})
