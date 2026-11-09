import { describe, expect, it } from 'vitest'
import { snapBox } from './snap'

describe('designer guides', () => {
  it('snaps a box to the page centre and says where', () => {
    const r = snapBox({ x: 300, y: 100, w: 200, h: 100 }) // centre 400, page centre 397
    expect(r.x).toBe(297)
    expect(r.guides).toContainEqual({ axis: 'x', at: 397 })
  })
  it('snaps an edge to the margin', () => {
    const r = snapBox({ x: 52, y: 1000, w: 100, h: 74 })
    expect(r.x).toBe(48)
    expect(r.y).toBe(1001) // bottom edge to 1123 - 48
  })
  it('leaves a box alone away from any line', () => {
    expect(snapBox({ x: 150, y: 300, w: 100, h: 100 })).toEqual({ x: 150, y: 300, guides: [] })
  })
})
