import { describe, expect, it } from 'vitest'
import { cleanItems, itemsFrom, itemsTotal } from './items'

describe('expense item lines', () => {
  it('drops empty rows, keeps qty only when typed, and adds the lines up', () => {
    const rows = [
      { title: 'Album 12x36', qty: '2', amount: '9,000' },
      { title: '', qty: '', amount: '' },
      { title: 'Courier', qty: '', amount: '250.505' },
    ]
    expect(cleanItems(rows)).toEqual([
      { title: 'Album 12x36', amount: 9000, qty: 2 },
      { title: 'Courier', amount: 250.51 },
    ])
    expect(itemsTotal(rows)).toBe(9250.51)
  })

  it('reads lines saved by the old app under other names', () => {
    expect(itemsFrom([{ name: 'Frames', total: 1200, quantity: 3 }, { title: 'Glue', amount: 0 }])).toEqual([
      { title: 'Frames', amount: '1200', qty: '3' },
      { title: 'Glue', amount: '', qty: '' },
    ])
    expect(itemsFrom(null)).toEqual([])
  })
})
