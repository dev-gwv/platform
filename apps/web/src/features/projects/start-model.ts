import type { MyDeliverable, TaskListItem } from '@ipc/contracts'

/**
 * What a team member should begin now so it is ready on time.
 *
 * A deliverable's start date comes from the server (due, minus the days the
 * work needs, minus a day for review). A task has no estimate, so it should be
 * picked up the day before it is due. Things already started, handed in or
 * done never show.
 */
export interface StartItem {
  kind: 'deliverable' | 'task'
  id: string
  title: string
  project: string | null
  due: string | null
  startBy: string
  /** Days until the start date; negative when it has passed. */
  left: number
  workDays: number | null
}

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
const minusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)

/** Everything to begin within the next two days, most overdue first. */
export function toStart(
  deliverables: readonly MyDeliverable[],
  tasks: readonly Pick<TaskListItem, 'id' | 'title' | 'status' | 'due_date' | 'project_name'>[],
  today: string,
  horizon = 2,
): StartItem[] {
  const out: StartItem[] = []
  for (const d of deliverables) {
    if (d.started_at || !d.start_by || ['review', 'completed', 'cancelled'].includes(d.status)) continue
    const left = days(d.start_by, today)
    if (left > horizon) continue
    out.push({
      kind: 'deliverable',
      id: d.id,
      title: d.title,
      project: d.project_name,
      due: d.estimated_date ?? null,
      startBy: d.start_by,
      left,
      workDays: d.work_days ?? null,
    })
  }
  for (const t of tasks) {
    if (t.status !== 'to_do' || !t.due_date) continue
    const startBy = minusDays(t.due_date, 1)
    const left = days(startBy, today)
    if (left > horizon) continue
    out.push({ kind: 'task', id: t.id, title: t.title, project: t.project_name ?? null, due: t.due_date, startBy, left, workDays: null })
  }
  return out.sort((a, b) => a.left - b.left || (a.due ?? '').localeCompare(b.due ?? ''))
}

/** "Start today", "Start by Fri 3 Oct", "3 days behind". */
export function startLabel(i: Pick<StartItem, 'left' | 'startBy'>): string {
  if (i.left === 0) return 'Start today'
  if (i.left < 0) return i.left === -1 ? '1 day behind' : `${-i.left} days behind`
  return `Start by ${new Date(`${i.startBy}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`
}
