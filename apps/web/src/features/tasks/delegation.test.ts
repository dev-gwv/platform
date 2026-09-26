import { describe, expect, it } from 'vitest'
import type { TaskListItem } from '@ipc/contracts'
import { groupByPerson } from './board'
import {
  addDays,
  assigneeStatusOptions,
  canReview,
  creatorInitials,
  extractUrls,
  hostOf,
  isWebLink,
  matchesDue,
  matchesScope,
  quickActions,
  reassigned,
  soonestOpen,
  taskStats,
  weekStart,
} from './delegation'

// 2026-09-02 is a Wednesday.
const TODAY = '2026-09-02'

const task = (title: string, over: Partial<TaskListItem> = {}): TaskListItem => ({
  id: `id-${title}`,
  title,
  description: null,
  status: 'to_do',
  priority: 'medium',
  custom_status_code: null,
  custom_status_label: null,
  deliverable_id: null,
  parent_task_id: null,
  voice_note_url: null,
  custom_priority_code: null,
  custom_priority_label: null,
  custom_priority_tone: null,
  due_date: null,
  project_id: null,
  project_name: null,
  assignee_names: ['Ravi'],
  assignee_ids: ['u-ravi'],
  sort_order: 0,
  tag: 'General',
  blocked_reason: null,
  created_by: 'u-owner',
  created_by_name: 'Asha Owner',
  latest_submission: null,
  updated_at: null,
  ...over,
})

describe('links', () => {
  it('finds each web link once, without trailing punctuation', () => {
    expect(extractUrls('Brief: https://drive.google.com/a, and https://x.test/b). Again https://drive.google.com/a.')).toEqual([
      'https://drive.google.com/a',
      'https://x.test/b',
    ])
    expect(extractUrls(null)).toEqual([])
  })

  it('names a link by its host', () => {
    expect(hostOf('https://www.dropbox.com/s/1')).toBe('dropbox.com')
    expect(hostOf('not a link')).toBe('link')
  })

  it('accepts only http(s)', () => {
    expect(isWebLink('https://a.test')).toBe(true)
    expect(isWebLink('javascript:alert(1)')).toBe(false)
    expect(isWebLink('drive folder')).toBe(false)
  })
})

describe('dates', () => {
  it('adds days across a month end', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05')
  })

  it('finds Monday', () => {
    expect(weekStart(TODAY)).toBe('2026-08-31')
    expect(weekStart('2026-08-31')).toBe('2026-08-31')
    expect(weekStart('2026-09-06')).toBe('2026-08-31') // Sunday belongs to the week before
  })

  it('filters by due date', () => {
    const late = task('late', { due_date: '2026-09-01' })
    const today = task('today', { due_date: TODAY })
    const soon = task('soon', { due_date: '2026-09-09' })
    const later = task('later', { due_date: '2026-09-10' })
    const none = task('none')
    const all = [late, today, soon, later, none]
    const pick = (f: Parameters<typeof matchesDue>[1]) => all.filter((t) => matchesDue(t, f, TODAY)).map((t) => t.title)
    expect(pick('overdue')).toEqual(['late'])
    expect(pick('today')).toEqual(['today'])
    expect(pick('week')).toEqual(['today', 'soon'])
    expect(pick('none')).toEqual(['none'])
    expect(pick('all')).toHaveLength(5)
    // Finished work is never overdue or due.
    expect(matchesDue(task('done', { due_date: '2026-09-01', status: 'completed' }), 'overdue', TODAY)).toBe(false)
  })
})

describe('taskStats', () => {
  it('counts the four chips', () => {
    const s = taskStats(
      [
        task('a', { priority: 'urgent' }),
        task('b', { priority: 'high', status: 'completed', updated_at: '2026-09-01T10:00:00+00:00' }),
        task('c', { status: 'in_progress', due_date: TODAY }),
        task('d', { status: 'completed', updated_at: '2026-08-30T10:00:00+00:00' }),
        task('e', { status: 'review', priority: 'high' }),
      ],
      TODAY,
    )
    expect(s).toEqual({ highPriority: 2, inProgress: 1, dueToday: 1, doneThisWeek: 1 })
  })
})

describe('who may do what', () => {
  it('the person on it submits and moves it, but does not close it', () => {
    expect(quickActions(task('t'), { isAssignee: true, canManage: false })).toEqual(['submit', 'in_progress', 'review', 'blocked'])
    expect(quickActions(task('t', { status: 'in_progress' }), { isAssignee: true, canManage: false })).toEqual(['submit', 'review', 'blocked'])
  })

  it('a manager can close it; an onlooker gets nothing', () => {
    expect(quickActions(task('t', { status: 'review' }), { isAssignee: false, canManage: true })).toEqual(['in_progress', 'blocked', 'done'])
    expect(quickActions(task('t'), { isAssignee: false, canManage: false })).toEqual([])
    expect(quickActions(task('t', { status: 'completed' }), { isAssignee: true, canManage: true })).toEqual([])
  })

  it('review is for whoever gave it, or a manager, and only in review', () => {
    const inReview = task('t', { status: 'review' })
    expect(canReview(inReview, 'u-owner', false)).toBe(true)
    expect(canReview(inReview, 'u-ravi', false)).toBe(false)
    expect(canReview(inReview, 'u-ravi', true)).toBe(true)
    expect(canReview(task('t'), 'u-owner', true)).toBe(false)
  })

  it('shows "by" only when someone else gave it', () => {
    expect(creatorInitials(task('t'))).toBe('AO')
    expect(creatorInitials(task('t', { created_by: 'u-ravi', created_by_name: 'Ravi' }))).toBeNull()
    expect(creatorInitials(task('t', { created_by: null }))).toBeNull()
  })

  it('offers the assignee their moves plus where the task is now', () => {
    expect(assigneeStatusOptions('to_do')).toEqual(['to_do', 'in_progress', 'review'])
    expect(assigneeStatusOptions('completed')).toEqual(['to_do', 'in_progress', 'review', 'completed'])
  })
})

describe('soonestOpen', () => {
  it('late first, then soonest, finished work left out', () => {
    const next = soonestOpen(
      [
        task('no date'),
        task('next week', { due_date: '2026-09-09' }),
        task('late', { due_date: '2026-08-30' }),
        task('done', { due_date: '2026-08-01', status: 'completed' }),
        task('tomorrow', { due_date: '2026-09-03' }),
      ],
      TODAY,
    )
    expect(next.map((t) => t.title)).toEqual(['late', 'tomorrow', 'next week'])
  })
})

describe('reassigned (drag between people)', () => {
  it('swaps the person it came from for the one it went to', () => {
    expect(reassigned(['a', 'b'], 'a', 'c')).toEqual(['b', 'c'])
  })
  it('from Unassigned gives it to someone; to Unassigned takes them off', () => {
    expect(reassigned([], null, 'c')).toEqual(['c'])
    expect(reassigned(['a', 'b'], 'a', null)).toEqual(['b'])
  })
  it('does nothing when nothing changes', () => {
    expect(reassigned(['a'], 'a', 'a')).toBeNull()
    expect(reassigned(['a', 'b'], 'a', 'b')).toEqual(['b'])
  })
})

describe('matchesScope', () => {
  const mine = task('mine', { assignee_ids: ['me'] })
  const theirs = task('theirs', { assignee_ids: ['x'] })
  const nobody = task('nobody', { assignee_ids: [], assignee_names: [] })
  it('my tasks, one person, or nobody', () => {
    const run = (f: Parameters<typeof matchesScope>[1]) => [mine, theirs, nobody].filter((t) => matchesScope(t, f)).map((t) => t.title)
    expect(run({ mine: true, me: 'me', member: '' })).toEqual(['mine'])
    expect(run({ mine: false, me: 'me', member: 'x' })).toEqual(['theirs'])
    expect(run({ mine: false, me: 'me', member: 'none' })).toEqual(['nobody'])
    expect(run({ mine: false, me: 'me', member: '' })).toHaveLength(3)
  })
})

describe('groupByPerson', () => {
  it('puts unassigned first and late people before busy ones', () => {
    const cols = groupByPerson(
      [
        task('a', { assignee_ids: ['x'], assignee_names: ['Xena'] }),
        task('b', { assignee_ids: ['x'], assignee_names: ['Xena'] }),
        task('c', { assignee_ids: ['y'], assignee_names: ['Yash'], due_date: '2026-08-01' }),
        task('d', { assignee_ids: [], assignee_names: [] }),
      ],
      TODAY,
    )
    expect(cols.map((c) => c.name)).toEqual(['Unassigned', 'Yash', 'Xena'])
  })
})
