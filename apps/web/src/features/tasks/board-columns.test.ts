import { describe, expect, it } from 'vitest'
import type { TaskColumns, TaskListItem, TaskStatus } from '@ipc/contracts'
import {
  appendToColumn,
  boardNarrowed,
  laneOrderBody,
  laneOf,
  moreInColumn,
  moveTasks,
  reorderColumn,
  showMoreLabel,
  taskColumnPagePath,
  taskColumnsPath,
  type BoardQuery,
} from './board-columns'

const base: BoardQuery = { mine: false, member: '', due: 'all', q: '', today: '2026-11-21', project: '', since: '2026-10-22' }

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const task = (n: number, status: TaskStatus): TaskListItem =>
  ({ id: id(n), title: `T${n}`, status, priority: 'medium', due_date: null, assignee_ids: [], assignee_names: [], sort_order: 0 }) as unknown as TaskListItem

function board(): TaskColumns {
  return {
    columns: [
      { status: 'to_do', total: 100, items: [task(1, 'to_do'), task(2, 'to_do'), task(3, 'to_do')], next_cursor: 'c1' },
      { status: 'in_progress', total: 2, items: [task(4, 'in_progress'), task(5, 'in_progress')], next_cursor: null },
      { status: 'review', total: 0, items: [], next_cursor: null },
      { status: 'blocked', total: 0, items: [], next_cursor: null },
      { status: 'completed', total: 1, items: [task(6, 'completed')], next_cursor: null },
    ],
  }
}
const ids = (d: TaskColumns, s: TaskStatus) => d.columns.find((c) => c.status === s)!.items.map((r) => r.id)
const total = (d: TaskColumns, s: TaskStatus) => d.columns.find((c) => c.status === s)!.total

describe('the board addresses', () => {
  it('sends only what narrows, plus the day and the Done window', () => {
    expect(taskColumnsPath(base)).toBe('/tasks/columns?today=2026-11-21&done_since=2026-10-22')
    expect(taskColumnsPath({ ...base, mine: true, member: 'x', due: 'overdue', q: '  album ', project: id(9) })).toBe(
      `/tasks/columns?mine=1&due=overdue&q=album&project_id=${id(9)}&today=2026-11-21&done_since=2026-10-22`,
    )
    expect(taskColumnsPath({ ...base, member: 'none' })).toContain('member=none')
  })

  it("asks Show more for one column's next page, with the same filters", () => {
    expect(taskColumnPagePath({ ...base, member: id(7) }, 'to_do', 'abc')).toBe(
      `/tasks/columns/page?member=${id(7)}&today=2026-11-21&done_since=2026-10-22&status=to_do&cursor=abc&limit=30`,
    )
  })
})

describe('Show more on a column', () => {
  it('adds the page under its own column only, once each, and takes its cursor', () => {
    const next = appendToColumn(board(), 'to_do', { items: [task(3, 'to_do'), task(7, 'to_do')], next_cursor: 'c2' })
    expect(ids(next, 'to_do')).toEqual([id(1), id(2), id(3), id(7)])
    expect(next.columns[0]!.next_cursor).toBe('c2')
    expect(ids(next, 'in_progress')).toEqual([id(4), id(5)])
  })

  it('says how many more a column holds, never below zero', () => {
    expect(moreInColumn(board().columns[0])).toBe(97)
    expect(moreInColumn(board().columns[1])).toBe(0)
    expect(moreInColumn({ status: 'to_do', total: 2, items: [task(1, 'to_do'), task(2, 'to_do'), task(3, 'to_do')], next_cursor: 'x' })).toBe(0)
    expect(moreInColumn(undefined)).toBe(0)
  })
})

describe('a drag or the bulk bar, before the server answers', () => {
  it('moves a card across, and both header counts follow', () => {
    const next = moveTasks(board(), [task(2, 'to_do')], 'in_progress', 1)
    expect(ids(next, 'to_do')).toEqual([id(1), id(3)])
    expect(total(next, 'to_do')).toBe(99)
    expect(ids(next, 'in_progress')).toEqual([id(4), id(2), id(5)])
    expect(total(next, 'in_progress')).toBe(3)
    expect(next.columns[1]!.items[1]!.status).toBe('in_progress')
  })

  it('bulk moves land at the top; cards already there stay put', () => {
    const next = moveTasks(board(), [task(1, 'to_do'), task(4, 'in_progress'), task(6, 'completed')], 'completed')
    expect(ids(next, 'completed')).toEqual([id(1), id(4), id(6)])
    expect(total(next, 'completed')).toBe(3)
    expect(total(next, 'to_do')).toBe(99)
    expect(total(next, 'in_progress')).toBe(1)
  })

  it('a card in no column (an older done one) only joins', () => {
    const next = moveTasks(board(), [task(50, 'completed')], 'to_do')
    expect(ids(next, 'to_do')[0]).toBe(id(50))
    expect(total(next, 'to_do')).toBe(101)
    expect(total(next, 'completed')).toBe(1)
  })

  it('nothing to move hands back the same board', () => {
    const b = board()
    expect(moveTasks(b, [task(1, 'to_do')], 'to_do')).toBe(b)
  })

  it('reorders inside one lane without touching its total', () => {
    const next = reorderColumn(board(), 'to_do', [id(3), id(1), id(2)])
    expect(ids(next, 'to_do')).toEqual([id(3), id(1), id(2)])
    expect(total(next, 'to_do')).toBe(100)
  })
})

describe('what a lane shows', () => {
  it('counts from the server total, not the cards loaded', () => {
    const l = laneOf(board(), 'to_do')
    expect(l.items).toHaveLength(3)
    expect(l.count).toBe(100)
    expect(l.more).toBe(97)
    expect(l.cursor).toBe('c1')
  })

  it('Done takes the older done tasks under it once it is all here', () => {
    const l = laneOf(board(), 'completed', [task(6, 'completed'), task(60, 'completed'), task(61, 'cancelled')])
    expect(l.items.map((r) => r.id)).toEqual([id(6), id(60)])
    expect(l.count).toBe(2)
  })

  it('an empty board is empty lanes', () => {
    expect(laneOf(undefined, 'review')).toEqual({ items: [], count: 0, more: 0, cursor: null })
  })
})

describe('the Show more button', () => {
  it('says everything the column has left, as the Leads pipeline does, not the next 30', () => {
    const big: TaskColumns['columns'][number] = { status: 'to_do', total: 375, items: board().columns[0]!.items, next_cursor: 'c' }
    expect(showMoreLabel(moreInColumn(big))).toBe('Show 372 more')
    expect(showMoreLabel(1250)).toBe('Show 1,250 more')
    expect(showMoreLabel(40, true)).toBe('Loading…')
  })
})

describe('the order a drag saves', () => {
  it('unfiltered: the cards shown, and the rest after them only when the lane holds more', () => {
    expect(laneOrderBody(base, 'to_do', [id(2), id(1)], true)).toEqual({ board_view: 'default', lane_key: 'to_do', task_ids: [id(2), id(1)], rest_after: true })
    expect(laneOrderBody(base, 'to_do', [id(2), id(1)], false)).toEqual({ board_view: 'default', lane_key: 'to_do', task_ids: [id(2), id(1)] })
  })

  it('filtered by a search, a person, a date or a project: the hidden cards keep their places', () => {
    for (const f of [{ q: 'album' }, { member: id(7) }, { member: 'none' }, { mine: true }, { due: 'overdue' }, { project: id(9) }]) {
      const b = { ...base, ...f }
      expect(boardNarrowed(b)).toBe(true)
      const body = laneOrderBody(b, 'review', [id(3)], true)
      expect(body).toMatchObject({ keep_hidden: true, task_ids: [id(3)] })
      expect(body).not.toHaveProperty('rest_after')
    }
    expect(boardNarrowed({ ...base, q: '   ' })).toBe(false)
  })
})
