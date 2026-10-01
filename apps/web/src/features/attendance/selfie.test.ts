import { describe, expect, it } from 'vitest'
import { fitWithin } from './selfie'

describe('a selfie is made small', () => {
  it('fits the long side inside 480 px, keeping the shape', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 360, height: 480 })
    expect(fitWithin(4000, 3000)).toEqual({ width: 480, height: 360 })
  })
  it('never makes a small photo bigger, and copes with nothing', () => {
    expect(fitWithin(320, 240)).toEqual({ width: 320, height: 240 })
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 })
  })
})
