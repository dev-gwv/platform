import type { TaskListItem, TaskStatus } from '@ipc/contracts'
import { initialsFor } from '@/shared/ui/identity'
import { byUrgency, isOverdue } from './board'

/**
 * The delegation loop's arithmetic: assign → work → submit → review → done.
 * Pure, so the cards, the People view and the dashboard card all agree, and a
 * test can argue with it. Dates come in as arguments (`today`), never from the
 * clock.
 */

/** Still somebody's work: to do, in progress, waiting for review, or stuck. */
export const isOpen = (t: Pick<TaskListItem, 'status'>): boolean =>
  t.status !== 'completed' && t.status !== 'cancelled'

/** The board's lanes, left to right. Cancelled work is off the board. */
export const BOARD_LANES: ReadonlyArray<{ key: TaskStatus; label: string; hint: string }> = [
  { key: 'to_do', label: 'To do', hint: 'Not started yet' },
  { key: 'in_progress', label: 'In progress', hint: 'Being worked on' },
  { key: 'review', label: 'Review', hint: 'Submitted, waiting for a check' },
  { key: 'blocked', label: 'Blocked', hint: 'Stuck; the reason is on the card' },
  { key: 'completed', label: 'Done', hint: 'Approved and finished' },
]

/** What the person on a task can set it to themselves. Done comes from review. */
export const ASSIGNEE_STATUSES: readonly TaskStatus[] = ['to_do', 'in_progress', 'review', 'blocked']

/**
 * A plain status dropdown for the person on a task (My Work, My Tasks):
 * the moves they can make without a question, plus where it is now so the
 * control never shows the wrong thing. Blocked asks why, so it lives on the
 * task's own page.
 */
export function assigneeStatusOptions(current: TaskStatus): TaskStatus[] {
  const base: TaskStatus[] = ['to_do', 'in_progress', 'review']
  return base.includes(current) ? base : [...base, current]
}

// ── links ───────────────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s<>"')]+/gi

/** Every web link in a piece of text, in order, once each, trailing punctuation trimmed. */
export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return []
  const found = text.match(URL_RE) ?? []
  return [...new Set(found.map((u) => u.replace(/[.,;:!?)\]]+$/, '')))]
}

/** "drive.google.com" for a link, for an "Open drive.google.com" chip. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'link'
  } catch {
    return 'link'
  }
}

/** Only http(s) links are ones we will open. */
export function isWebLink(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// ── dates ───────────────────────────────────────────────────────
/** An ISO date `n` days from another, calendar arithmetic only. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

/** Monday of the week `today` falls in. */
export function weekStart(today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(today, -((dow + 6) % 7))
}

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none'

export const DUE_FILTERS: ReadonlyArray<{ value: DueFilter; label: string }> = [
  { value: 'all', label: 'Any date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'none', label: 'No date' },
]

export function matchesDue(t: TaskListItem, filter: DueFilter, today: string): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'overdue':
      return isOverdue(t, today)
    case 'today':
      return isOpen(t) && t.due_date === today
    case 'week':
      return isOpen(t) && !!t.due_date && t.due_date >= today && t.due_date <= addDays(today, 7)
    case 'none':
      return !t.due_date
  }
}

// ── the stat chips ──────────────────────────────────────────────
export interface TaskStats {
  highPriority: number
  inProgress: number
  dueToday: number
  doneThisWeek: number
}

/**
 * High priority counts open work only — a finished urgent task is not
 * pressing. "Done this week" is from Monday, by when the task last changed
 * (a completed task's last change is its completion).
 */
export function taskStats(tasks: readonly TaskListItem[], today: string): TaskStats {
  const monday = weekStart(today)
  let highPriority = 0
  let inProgress = 0
  let dueToday = 0
  let doneThisWeek = 0
  for (const t of tasks) {
    if (isOpen(t) && (t.priority === 'high' || t.priority === 'urgent')) highPriority++
    if (t.status === 'in_progress') inProgress++
    if (isOpen(t) && t.due_date === today) dueToday++
    if (t.status === 'completed' && t.updated_at && t.updated_at.slice(0, 10) >= monday) doneThisWeek++
  }
  return { highPriority, inProgress, dueToday, doneThisWeek }
}

// ── who may do what ─────────────────────────────────────────────
export type QuickAction = 'submit' | 'in_progress' | 'review' | 'blocked' | 'done'

export const QUICK_LABEL: Record<QuickAction, string> = {
  submit: 'Submit',
  in_progress: '→ In progress',
  review: '→ Review',
  blocked: '→ Blocked',
  done: '✓ Done',
}

/**
 * The buttons a card offers on hover. The person on the task submits and
 * moves it along; someone who manages tasks can move any of them and close
 * them. Nobody is offered the status a task already has.
 */
export function quickActions(
  t: Pick<TaskListItem, 'status'>,
  who: { isAssignee: boolean; canManage: boolean },
): QuickAction[] {
  if (!isOpen(t)) return []
  const mover = who.isAssignee || who.canManage
  const out: QuickAction[] = []
  if (who.isAssignee) out.push('submit')
  if (mover && t.status !== 'in_progress') out.push('in_progress')
  if (mover && t.status !== 'review') out.push('review')
  if (mover && t.status !== 'blocked') out.push('blocked')
  if (who.canManage) out.push('done')
  return out
}

/** Approve / Send back: a task waiting for review, seen by whoever gave it or a manager. */
export function canReview(
  t: Pick<TaskListItem, 'status' | 'created_by'>,
  me: string | null,
  canManage: boolean,
): boolean {
  return t.status === 'review' && (canManage || (!!me && t.created_by === me))
}

/** "by AO" on a card: shown when someone other than the people on it gave the task. */
export function creatorInitials(t: Pick<TaskListItem, 'created_by' | 'created_by_name' | 'assignee_ids'>): string | null {
  if (!t.created_by || !t.created_by_name) return null
  if (t.assignee_ids.includes(t.created_by)) return null
  return initialsFor(t.created_by_name)
}

// ── lists ───────────────────────────────────────────────────────
/** The next few things on my plate: open, late first, then soonest due. */
export function soonestOpen(tasks: readonly TaskListItem[], today: string, n = 3): TaskListItem[] {
  return tasks.filter(isOpen).sort(byUrgency(today)).slice(0, n)
}

/**
 * Who a task goes to after a card is dragged from one person's column to
 * another's: the person it came from is swapped for the one it was dropped
 * on; everyone else on it stays. Dropping on "Unassigned" takes the person
 * off. Returns null when nothing would change.
 */
export function reassigned(assignees: readonly string[], from: string | null, to: string | null): string[] | null {
  if (from === to) return null
  const rest = assignees.filter((id) => id !== from)
  const next = to && !rest.includes(to) ? [...rest, to] : rest
  const same = next.length === assignees.length && next.every((id) => assignees.includes(id))
  return same ? null : next
}

export interface ScopeFilter {
  /** Only tasks I am on. */
  mine: boolean
  me: string | null
  /** One person's tasks ('none' = nobody on them); '' = everyone. */
  member: string
}

export function matchesScope(t: TaskListItem, f: ScopeFilter): boolean {
  if (f.mine && (!f.me || !t.assignee_ids.includes(f.me))) return false
  if (f.member === 'none') return t.assignee_ids.length === 0
  if (f.member && !t.assignee_ids.includes(f.member)) return false
  return true
}
