import { describe, expect, it } from 'vitest'
import type { TaskListItem } from '@ipc/contracts'
import {
  EMPTY_FILTERS,
  filterTasks,
  groupByPerson,
  isOverdue,
  summarise,
  tabCounts,
  todayISO,
} from './board'

const TODAY = '2026-09-01'

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
  project_name: 'Sharma Wedding',
  assignee_names: ['Rahul'],
  assignee_ids: ['user-rahul'],
  sort_order: 0,
  tag: 'General',
  blocked_reason: null,
  created_by: null,
  created_by_name: null,
  latest_submission: null,
  updated_at: null,
  ...over,
})

const titles = (ts: readonly TaskListItem[]) => ts.map((t) => t.title)

describe('isOverdue', () => {
  it('is about the date, not the status column', () => {
    expect(isOverdue(task('a', { due_date: '2026-08-30' }), TODAY)).toBe(true)
    expect(isOverdue(task('b', { due_date: '2026-09-05' }), TODAY)).toBe(false)
  })

  it('counts due today as still on time', () => {
    expect(isOverdue(task('c', { due_date: TODAY }), TODAY)).toBe(false)
  })

  it('never calls finished work overdue', () => {
    expect(isOverdue(task('d', { due_date: '2026-08-01', status: 'completed' }), TODAY)).toBe(false)
    expect(isOverdue(task('e', { due_date: '2026-08-01', status: 'cancelled' }), TODAY)).toBe(false)
  })

  it('is not overdue without a due date', () => {
    // Undated is unscheduled, which is a different problem from late.
    expect(isOverdue(task('f'), TODAY)).toBe(false)
  })
})

describe('summarise', () => {
  const BOARD = [
    task('Cull', { status: 'to_do', due_date: '2026-08-25' }),
    task('Edit', { status: 'in_progress' }),
    task('Album', { status: 'completed' }),
    task('Dropped', { status: 'cancelled' }),
  ]

  it('leaves cancelled work out of the total', () => {
    // Counting it would make every other tile read as a smaller share.
    const s = summarise(BOARD, TODAY)
    expect(s.total).toBe(3)
    expect(s.toDo).toBe(1)
    expect(s.inProgress).toBe(1)
    expect(s.completed).toBe(1)
    expect(s.overdue).toBe(1)
  })

  it('is all zeros on an empty board', () => {
    expect(summarise([], TODAY)).toEqual({
      total: 0,
      toDo: 0,
      inProgress: 0,
      completed: 0,
      overdue: 0,
    })
  })

  it('agrees with the tab counts beside it', () => {
    const s = summarise(BOARD, TODAY)
    const c = tabCounts(BOARD, TODAY)
    expect(c.all).toBe(s.total)
    expect(c.to_do).toBe(s.toDo)
    expect(c.overdue).toBe(s.overdue)
  })
})

describe('filterTasks', () => {
  const BOARD = [
    task('Late album', { due_date: '2026-08-20', priority: 'high' }),
    task('Due soon', { due_date: '2026-09-03' }),
    task('Someday', { priority: 'low' }),
    task('Urgent undated', { priority: 'urgent' }),
    task('Finished', { status: 'completed' }),
    task('Dropped', { status: 'cancelled' }),
  ]

  it('hides cancelled work from every tab, including All', () => {
    expect(titles(filterTasks(BOARD, 'all', EMPTY_FILTERS, TODAY))).not.toContain('Dropped')
  })

  it('orders late first, then soonest, then by priority', () => {
    expect(titles(filterTasks(BOARD, 'all', EMPTY_FILTERS, TODAY))).toEqual([
      'Late album',
      'Due soon',
      'Urgent undated',
      'Someday',
      'Finished',
    ])
  })

  it('sinks finished work below everything still open', () => {
    // On a mixed list the question is what is left to do — a completed task
    // outranking an open one because it was marked urgent is noise.
    const done = [
      task('Done urgent', { status: 'completed', priority: 'urgent' }),
      task('Open low', { priority: 'low' }),
    ]
    expect(titles(filterTasks(done, 'all', EMPTY_FILTERS, TODAY))).toEqual([
      'Open low',
      'Done urgent',
    ])
  })

  it('filters by priority and searches title, project and assignee', () => {
    expect(titles(filterTasks(BOARD, 'all', { ...EMPTY_FILTERS, priority: 'urgent' }, TODAY))).toEqual([
      'Urgent undated',
    ])
    expect(filterTasks(BOARD, 'all', { ...EMPTY_FILTERS, search: 'sharma' }, TODAY)).toHaveLength(5)
    expect(titles(filterTasks(BOARD, 'all', { ...EMPTY_FILTERS, search: 'album' }, TODAY))).toEqual([
      'Late album',
    ])
  })

  it('searches the description too', () => {
    const withNotes = [task('Vague', { description: 'Colour grade the teaser first' })]
    expect(titles(filterTasks(withNotes, 'all', { ...EMPTY_FILTERS, search: 'teaser' }, TODAY))).toEqual([
      'Vague',
    ])
  })

  it('does not mutate the array it was given', () => {
    const before = titles(BOARD)
    filterTasks(BOARD, 'all', EMPTY_FILTERS, TODAY)
    expect(titles(BOARD)).toEqual(before)
  })
})

describe('todayISO', () => {
  it('pads the way a date comparison needs', () => {
    expect(todayISO(new Date(2026, 8, 1))).toBe('2026-09-01')
    expect(todayISO(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('groupByPerson', () => {
  const t = (over: Partial<TaskListItem>): TaskListItem =>
    ({
      id: over.id ?? crypto.randomUUID(),
      title: 'Task',
      description: null,
      status: 'to_do',
      priority: 'medium',
      custom_priority_code: null,
      custom_priority_label: null,
      custom_priority_tone: null,
      custom_status_code: null,
      custom_status_label: null,
      due_date: null,
      project_id: null,
      project_name: null,
      deliverable_id: null,
      parent_task_id: null,
      voice_note_url: null,
      assignee_names: [],
      assignee_ids: [],
      sort_order: 0,
      ...over,
    }) as TaskListItem

  it('puts unassigned work first, then the busiest and latest people', () => {
    const cols = groupByPerson(
      [
        t({ assignee_ids: ['a'], assignee_names: ['Aman'] }),
        t({ assignee_ids: ['n'], assignee_names: ['Nisha'], due_date: '2026-01-01' }),
        t({ assignee_ids: ['a'], assignee_names: ['Aman'] }),
        t({}),
      ],
      '2026-09-26',
    )
    expect(cols.map((c) => c.name)).toEqual(['Unassigned', 'Nisha', 'Aman'])
    expect(cols[1]!.late).toBe(1)
    expect(cols[2]!.tasks).toHaveLength(2)
  })

  it('shows a shared task under everyone on it', () => {
    const cols = groupByPerson([t({ assignee_ids: ['a', 'n'], assignee_names: ['Aman', 'Nisha'] })], '2026-09-26')
    expect(cols.map((c) => c.name).sort()).toEqual(['Aman', 'Nisha'])
    expect(cols.some((c) => c.id === null)).toBe(false)
  })
})
