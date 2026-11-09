import { describe, expect, it } from 'vitest'
import { designPageData } from '@ipc/contracts'
import {
  addElement,
  duplicateElement,
  elementKey,
  newElement,
  nudge,
  removeElement,
  updateElement,
} from './elements'
import { PAGE_W } from './page-context'

const blank = () => designPageData.parse({})

describe('added items (Canva Text and Elements)', () => {
  it('a page holds none until the studio adds one', () => {
    expect(blank().elements).toEqual([])
  })

  it('a new item lands centred, each next one a little lower', () => {
    const a = newElement('heading', 0, 'a1')
    const b = newElement('heading', 1, 'b1')
    expect(a.x + a.w / 2).toBe(PAGE_W / 2)
    expect(b.y).toBeGreaterThan(a.y)
    expect(a.text).toBe('Add a heading')
    expect(designPageData.parse({ elements: [a] }).elements[0]).toEqual(a)
  })

  it('a copy sits 24 px down and right, where the original was moved to, with its style', () => {
    let d = addElement(blank(), newElement('box', 0, 'box1'))
    d = { ...d, layout: { [elementKey('box1')]: { dx: 10, dy: 20, s: 1.5 } }, styles: {} }
    d = updateElement(d, 'box1', { color: '#ff0000' })
    const c = duplicateElement(d, 'box1', 'box2')
    const [o, copy] = c.elements
    expect(copy!.x).toBe(o!.x + 34)
    expect(copy!.y).toBe(o!.y + 44)
    expect(copy!.color).toBe('#ff0000')
    expect(c.layout[elementKey('box2')]).toEqual({ dx: 0, dy: 0, s: 1.5 })
  })

  it('deleting takes its place and style with it', () => {
    let d = addElement(blank(), newElement('text', 0, 't1'))
    d = {
      ...d,
      layout: { [elementKey('t1')]: { dx: 5, dy: 5, s: 1 }, title: { dx: 1, dy: 1, s: 1 } },
      styles: { [elementKey('t1')]: { bold: true } },
    }
    const r = removeElement(d, 't1')
    expect(r.elements).toEqual([])
    expect(r.layout).toEqual({ title: { dx: 1, dy: 1, s: 1 } })
    expect(r.styles).toEqual({})
  })

  it('the arrows move any item, within the limits', () => {
    let d = nudge(blank(), 'photo', 10, -1)
    expect(d.layout['photo']).toEqual({ dx: 10, dy: -1, s: 1 })
    d = nudge(d, 'photo', 5000, 0)
    expect(d.layout['photo']!.dx).toBe(1200)
  })

  it('a page takes at most 40 added items', () => {
    let d = blank()
    for (let i = 0; i < 45; i++) d = addElement(d, newElement('circle', i, `c${i}`))
    expect(d.elements).toHaveLength(40)
    expect(designPageData.safeParse({ ...d, elements: [...d.elements, newElement('box', 0, 'zz')] }).success).toBe(false)
  })
})
