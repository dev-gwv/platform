import { describe, expect, it } from 'vitest'
import { designPageData } from '@ipc/contracts'

describe('quotation designer, step 4', () => {
  it('keeps where an item was moved and how big it was made', () => {
    const d = designPageData.parse({ layout: { photo: { dx: 40, dy: -12, s: 1.25 }, title: { dy: 30 } } })
    expect(d.layout.photo).toEqual({ dx: 40, dy: -12, s: 1.25 })
    expect(d.layout.title).toEqual({ dx: 0, dy: 30, s: 1 })
    expect(designPageData.parse({}).layout).toEqual({})
  })
  it('refuses a move off the page and an item made too small', () => {
    expect(designPageData.safeParse({ layout: { photo: { dx: 5000 } } }).success).toBe(false)
    expect(designPageData.safeParse({ layout: { photo: { s: 0.05 } } }).success).toBe(false)
  })
})
