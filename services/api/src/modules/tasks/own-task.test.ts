import { describe, expect, it } from 'vitest'
import { ownTaskPatch } from './router'

describe('what a person may change on a task they made for themselves', () => {
  it('keeps its words, date, priority and status', () => {
    expect(ownTaskPatch({ title: 'Back up cards', due_date: null, status: 'completed' })).toEqual({
      title: 'Back up cards',
      due_date: null,
      status: 'completed',
    })
  })

  it('refuses anything more: people, project, a review', () => {
    expect(ownTaskPatch({ title: 'x', assignees: ['00000000-0000-4000-8000-000000000001'] })).toBeNull()
    expect(ownTaskPatch({ project_id: null })).toBeNull()
    expect(ownTaskPatch({ status: 'review' })).toBeNull()
    expect(ownTaskPatch({})).toBeNull()
  })
})
