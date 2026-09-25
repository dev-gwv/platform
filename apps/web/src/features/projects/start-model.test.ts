import { describe, expect, it } from 'vitest'
import type { MyDeliverable } from '@ipc/contracts'
import { startLabel, toStart } from './start-model'

const del = (over: Partial<MyDeliverable>): MyDeliverable =>
  ({
    id: 'd1',
    project_id: 'p1',
    project_name: 'Sharma Wedding',
    title: 'Highlight film',
    status: 'in_progress',
    estimated_date: '2026-10-20',
    visibility_scope: 'client',
    notes_count: 0,
    voice_count: 0,
    start_by: '2026-10-12',
    work_days: 7,
    started_at: null,
    ...over,
  }) as MyDeliverable

describe('what to start', () => {
  it('shows work whose start date is within two days, most behind first, and hides started work', () => {
    const items = toStart(
      [
        del({ id: 'soon', start_by: '2026-10-12' }),
        del({ id: 'behind', start_by: '2026-10-07' }),
        del({ id: 'later', start_by: '2026-10-20' }),
        del({ id: 'started', start_by: '2026-10-08', started_at: '2026-10-08T05:00:00Z' }),
        del({ id: 'review', start_by: '2026-10-08', status: 'review' }),
      ],
      [
        { id: 't1', title: 'Colour grade', status: 'to_do', due_date: '2026-10-11', project_name: 'Sharma Wedding' },
        { id: 't2', title: 'Doing it', status: 'in_progress', due_date: '2026-10-10', project_name: null },
      ],
      '2026-10-10',
    )
    expect(items.map((i) => [i.id, i.left])).toEqual([
      ['behind', -3],
      ['t1', 0],
      ['soon', 2],
    ])
  })

  it('says it in words', () => {
    expect(startLabel({ left: 0, startBy: '2026-10-10' })).toBe('Start today')
    expect(startLabel({ left: -3, startBy: '2026-10-07' })).toBe('3 days behind')
    expect(startLabel({ left: 2, startBy: '2026-10-12' })).toMatch(/^Start by /)
  })
})
