import { describe, expect, it } from 'vitest'
import { record, redo, startHistory, undo } from './history'

describe('designer undo', () => {
  it('undoes and redoes a step', () => {
    let h = startHistory('a')
    h = record(h, 'b', 1000)
    h = record(h, 'c', 5000)
    h = undo(h)
    expect(h.present).toBe('b')
    h = undo(h)
    expect(h.present).toBe('a')
    expect(undo(h).present).toBe('a')
    h = redo(h)
    expect(h.present).toBe('b')
  })

  it('makes quick changes one step, like typing a word', () => {
    let h = startHistory('')
    h = record(h, 'h', 1000)
    h = record(h, 'hi', 1200)
    h = record(h, 'hi!', 1400)
    expect(undo(h).present).toBe('')
  })

  it('forgets the redo once something new is done', () => {
    let h = startHistory(1)
    h = record(h, 2, 1000)
    h = undo(h)
    h = record(h, 3, 9000)
    expect(h.future).toEqual([])
    expect(redo(h).present).toBe(3)
  })
})
