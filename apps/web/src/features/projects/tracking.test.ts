import { describe, expect, it } from 'vitest'
import type { ProjectTrackingRow } from '@ipc/contracts'
import {
  filterAndSort,
  mostUrgent,
  summary,
  tabCounts,
  track,
  type TrackedProject,
} from './tracking'

const TODAY = '2026-09-01'

const row = (name: string, over: Partial<ProjectTrackingRow> = {}): ProjectTrackingRow => ({
  id: `id-${name}`,
  name,
  status: 'active',
  client_name: 'Sharma Family',
  total_cost: 100000,
  tasks_total: 4,
  tasks_done: 2,
  tasks_overdue: 0,
  deliverables_total: 0,
  deliverables_done: 0,
  deliverables_late: 0,
  data_records_total: 0,
  data_records_unverified: 0,
  pending_reviews: 0,
  shoots_total: 2,
  shoots_done: 1,
  next_shoot_date: '2026-09-20',
  last_activity_at: '2026-08-30T10:00:00Z',
  ...over,
})

const names = (ps: readonly TrackedProject[]) => ps.map((p) => p.name)

const BOARD = track(
  [
    row('Healthy'),
    row('Burning', { data_records_unverified: 3, tasks_overdue: 2 }),
    row('Late', { tasks_overdue: 1 }),
    row('Waiting', { pending_reviews: 2 }),
    row('Stalled', { shoots_total: 2, shoots_done: 2, tasks_total: 10, tasks_done: 1 }),
    row('Done', { tasks_total: 3, tasks_done: 3 }),
  ],
  TODAY,
)

describe('tabCounts', () => {
  it('counts every bucket from the same scored list', () => {
    const counts = tabCounts(BOARD)
    expect(counts.all).toBe(6)
    expect(counts.critical).toBe(1)
    expect(counts.data_missing).toBe(1)
    expect(counts.overdue).toBe(2)
    expect(counts.pending_review).toBe(1)
    expect(counts.completed).toBe(1)
    expect(counts.low_progress).toBe(1)
  })

  it('lets a project appear under every bucket it belongs to', () => {
    // Burning is critical AND data_missing AND overdue — filters are lenses on
    // the same list, not an exclusive routing.
    const counts = tabCounts(track([row('Burning', { data_records_unverified: 3, tasks_overdue: 2 })], TODAY))
    expect(counts.critical).toBe(1)
    expect(counts.data_missing).toBe(1)
    expect(counts.overdue).toBe(1)
  })
})

describe('filterAndSort', () => {
  it('puts the loudest project first by default', () => {
    expect(names(filterAndSort(BOARD, 'all', 'risk'))[0]).toBe('Burning')
  })

  it('sorts by completion, name and next shoot', () => {
    const byCompletion = names(filterAndSort(BOARD, 'all', 'completion'))
    expect(byCompletion[byCompletion.length - 1]).toBe('Done')
    expect(names(filterAndSort(BOARD, 'all', 'name'))).toEqual([
      'Burning',
      'Done',
      'Healthy',
      'Late',
      'Stalled',
      'Waiting',
    ])
  })

  it('sorts highest completion first and most pending reviews first', () => {
    expect(names(filterAndSort(BOARD, 'all', 'completion_desc'))[0]).toBe('Done')
    expect(names(filterAndSort(BOARD, 'all', 'pending_review')).slice(0, 2)).toEqual(['Waiting', 'Burning'])
  })

  it('sorts by overdue work and by recent activity', () => {
    expect(names(filterAndSort(BOARD, 'all', 'overdue')).slice(0, 2)).toEqual(['Burning', 'Late'])
    const board = track(
      [
        row('Old', { last_activity_at: '2026-08-01T10:00:00Z' }),
        row('New', { last_activity_at: '2026-08-31T10:00:00Z' }),
      ],
      TODAY,
    )
    expect(names(filterAndSort(board, 'all', 'recent'))).toEqual(['New', 'Old'])
  })

  it('sinks projects with no shoot booked rather than calling them soonest', () => {
    const board = track(
      [
        row('Unscheduled', { next_shoot_date: null }),
        row('Soon', { next_shoot_date: '2026-09-05' }),
        row('Later', { next_shoot_date: '2026-12-01' }),
      ],
      TODAY,
    )
    expect(names(filterAndSort(board, 'all', 'next_shoot'))).toEqual(['Soon', 'Later', 'Unscheduled'])
  })

  it('narrows to one bucket without reordering it differently', () => {
    expect(names(filterAndSort(BOARD, 'overdue', 'risk'))).toEqual(['Burning', 'Late'])
  })

  it('does not mutate the list it was handed', () => {
    const before = names(BOARD)
    filterAndSort(BOARD, 'all', 'name')
    expect(names(BOARD)).toEqual(before)
  })
})

describe('mostUrgent', () => {
  it('is the highest-scoring project', () => {
    expect(mostUrgent(BOARD)?.name).toBe('Burning')
  })

  it('is nothing at all when every project is calm or closed', () => {
    // A quiet board should say so, not nominate whichever project sorted first.
    const calm = track([row('Done', { tasks_total: 2, tasks_done: 2 })], TODAY)
    expect(mostUrgent(calm)).toBeNull()
    expect(mostUrgent([])).toBeNull()
  })
})

describe('summary', () => {
  it('counts projects for risk bands but items for the work tiles', () => {
    // "2 critical projects" and "7 overdue tasks" are different units, and the
    // tiles have to mean what their labels say.
    const s = summary(BOARD)
    expect(s.critical).toBe(1)
    expect(s.overdue).toBe(3)
    expect(s.data_missing).toBe(3)
    expect(s.pending_review).toBe(2)
  })
})
