/**
 * The five tiles on My work: tasks AND edits together. They counted tasks
 * only, so an editor with two edits read "0" on every tile right above
 * "Your edits · 2".
 */
interface TaskLike {
  status: string
  due_date?: string | null | undefined
}
interface SubmissionLike {
  status: string
}
interface EditLike {
  status: string
  estimated_date?: string | null | undefined
  started_at?: string | null | undefined
}

export interface WorkSummary {
  dueToday: number
  pending: number
  inReview: number
  overdue: number
  completed: number
}

const isOpen = (s: string) => s !== 'completed' && s !== 'cancelled'

export function workSummary(
  tasks: readonly TaskLike[],
  submissions: readonly SubmissionLike[],
  edits: readonly EditLike[],
  today: string,
): WorkSummary {
  const openTasks = tasks.filter((t) => isOpen(t.status))
  // An edit in review is counted by its hand-in (submissions), so it is not counted twice.
  const openEdits = edits.filter((e) => isOpen(e.status) && e.status !== 'review')
  const due = (d?: string | null) => d ?? null
  return {
    dueToday: openTasks.filter((t) => due(t.due_date) === today).length + openEdits.filter((e) => due(e.estimated_date) === today).length,
    pending: openTasks.filter((t) => t.status === 'to_do').length + openEdits.filter((e) => !e.started_at).length,
    inReview: submissions.filter((s) => s.status === 'submitted').length,
    overdue:
      openTasks.filter((t) => !!t.due_date && t.due_date < today).length +
      openEdits.filter((e) => !!e.estimated_date && e.estimated_date < today).length,
    completed:
      tasks.filter((t) => t.status === 'completed').length +
      submissions.filter((s) => s.status === 'approved').length,
  }
}
