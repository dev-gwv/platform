import { describe, expect, it } from 'vitest'
import type { TaskListItem, TaskOpenSummary } from '@ipc/contracts'
import { openTasksPath, pageCounts, peopleCounts, showingLine, type OpenTaskQuery } from './open-pages'

const base: OpenTaskQuery = { mine: false, member: '', due: 'all', tab: 'all', q: '', today: '2026-11-21' }

const task = (over: Partial<TaskListItem>): TaskListItem =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    title: 'T',
    status: 'completed',
    priority: 'medium',
    due_date: null,
    updated_at: '2026-11-20T10:00:00+05:30',
    assignee_ids: [],
    assignee_names: [],
    ...over,
  }) as TaskListItem

const summary: TaskOpenSummary = {
  open: 1158,
  matching: 1158,
  to_do: 900,
  in_progress: 200,
  review: 40,
  blocked: 18,
  overdue: 75,
  high_priority: 120,
  due_today: 9,
  people: [
    { user_id: '00000000-0000-4000-8000-0000000000aa', open: 30, late: 4 },
    { user_id: null, open: 12, late: 0 },
  ],
}

describe('openTasksPath', () => {
  it('sends only what narrows, and always the viewer’s day', () => {
    expect(openTasksPath(base)).toBe('/tasks/open?today=2026-11-21')
  })

  it('mine wins over a person; due, tab and search ride along; a cursor pages on', () => {
    const path = openTasksPath({ ...base, mine: true, member: 'none', due: 'overdue', tab: 'to_do', q: '  album ' }, 'abc', 50)
    const qs = new URLSearchParams(path.split('?')[1])
    expect(qs.get('mine')).toBe('1')
    expect(qs.has('member')).toBe(false)
    expect(qs.get('due')).toBe('overdue')
    expect(qs.get('tab')).toBe('to_do')
    expect(qs.get('q')).toBe('album')
    expect(qs.get('cursor')).toBe('abc')
    expect(qs.get('limit')).toBe('50')
  })

  it('a person, and the Completed tab never reaches the open list', () => {
    const qs = new URLSearchParams(openTasksPath({ ...base, member: 'none', tab: 'completed' }).split('?')[1])
    expect(qs.get('member')).toBe('none')
    expect(qs.has('tab')).toBe(false)
  })
})

describe('pageCounts', () => {
  it('open counts come from the summary, finished ones from the rows', () => {
    const done = [
      task({ id: '00000000-0000-4000-8000-000000000001' }),
      task({ id: '00000000-0000-4000-8000-000000000002', updated_at: '2026-11-02T10:00:00+05:30' }),
      task({ id: '00000000-0000-4000-8000-000000000003', status: 'cancelled' }),
    ]
    const c = pageCounts(summary, done, '2026-11-21')
    expect(c.tabs).toEqual({ all: 1160, to_do: 900, in_progress: 200, completed: 2, overdue: 75 })
    // 21 Nov 2026 is a Saturday: the week began on Monday the 16th.
    expect(c.stats).toEqual({ highPriority: 120, inProgress: 200, dueToday: 9, doneThisWeek: 1 })
  })

  it('reads zero before the summary lands', () => {
    expect(pageCounts(null, [], '2026-11-21').tabs.all).toBe(0)
  })
})

describe('peopleCounts and showingLine', () => {
  it('keys each person by id, nobody as none', () => {
    const m = peopleCounts(summary)!
    expect(m.get('00000000-0000-4000-8000-0000000000aa')).toEqual({ open: 30, late: 4 })
    expect(m.get('none')).toEqual({ open: 12, late: 0 })
    expect(peopleCounts(null)).toBeUndefined()
  })

  it('says how many of how many, in Indian grouping', () => {
    expect(showingLine(100, 1158)).toBe('Showing 100 of 1,158')
    expect(showingLine(200, 150000)).toBe('Showing 200 of 1,50,000')
    expect(showingLine(120, 100)).toBe('Showing 100 of 100')
  })
})
