import { describe, expect, it } from 'vitest'
import { panPhoto, placePhoto } from './photo-math'

describe('photo in its frame', () => {
  it('covers the frame and centres on the focus point', () => {
    // A 3:2 photo in a square frame: as tall as the frame, wider than it.
    expect(placePhoto(400, 400, 1200, 800, 50, 50, 1)).toEqual({
      left: -100,
      top: 0,
      width: 600,
      height: 400,
    })
    expect(placePhoto(400, 400, 1200, 800, 0, 50, 1).left).toBe(0)
    expect(placePhoto(400, 400, 1200, 800, 100, 50, 1).left).toBe(-200)
  })
  it('follows the hand when dragged, only where there is photo to show', () => {
    const p = placePhoto(400, 400, 1200, 800, 50, 50, 1)
    expect(panPhoto(p, 400, 400, 50, 50, 50, 30)).toEqual({ x: 25, y: 50 })
    expect(panPhoto(p, 400, 400, 50, 50, -500, 0)).toEqual({ x: 100, y: 50 })
  })
  it('moves both ways once zoomed in', () => {
    const p = placePhoto(400, 400, 1200, 800, 50, 50, 2)
    expect(panPhoto(p, 400, 400, 50, 50, 0, 40).y).toBe(40)
  })
})
