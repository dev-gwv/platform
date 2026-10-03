import { describe, expect, it } from 'vitest'
import { workSummary } from './summary'

const today = '2026-10-03'

describe('workSummary', () => {
  it('counts edits beside tasks', () => {
    const s = workSummary(
      [{ status: 'to_do', due_date: today }],
      [],
      [
        { status: 'in_progress', estimated_date: '2026-10-01', started_at: '2026-09-28T10:00:00Z' },
        { status: 'pending', estimated_date: today, started_at: null },
      ],
      today,
    )
    expect(s).toEqual({ dueToday: 2, pending: 2, inReview: 0, overdue: 1, completed: 0 })
  })

  it('does not count an edit in review twice', () => {
    const s = workSummary([], [{ status: 'submitted' }], [{ status: 'review', estimated_date: '2026-09-01', started_at: 'x' }], today)
    expect(s.inReview).toBe(1)
    expect(s.overdue).toBe(0)
  })
})
