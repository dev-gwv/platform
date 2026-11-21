import type { TaskListItem, TaskOpenSummary } from '@ipc/contracts'
import type { TaskTab } from './board'
import { weekStart } from './delegation'

/**
 * The Tasks page reads open work a page at a time (GET /tasks/open, speed
 * audit 21 Nov) and finished work from the 30-day window. These are the pure
 * parts: the address a page is asked at, and the counts the tabs, tiles and
 * people's columns show from the server's summary plus the finished rows.
 */

/** The toolbar as the server reads it. */
export interface OpenTaskQuery {
  /** Only tasks I am on. */
  mine: boolean
  /** One person ('none' = nobody on it); '' = everyone. */
  member: string
  /** The Due date filter ('all' = any date). */
  due: string
  /** The List's tab ('all' for every open task, and for the People view). */
  tab: TaskTab
  /** The search box. */
  q: string
  /** The viewer's day, so "overdue" and "due today" mean their today. */
  today: string
}

/** `/tasks/open?…` for one page; only what narrows is sent, so equal toolbars share a cache entry. */
export function openTasksPath(query: OpenTaskQuery, cursor?: string | null, limit?: number): string {
  const p = new URLSearchParams()
  if (query.mine) p.set('mine', '1')
  else if (query.member) p.set('member', query.member)
  if (query.due && query.due !== 'all') p.set('due', query.due)
  if (query.tab !== 'all' && query.tab !== 'completed') p.set('tab', query.tab)
  const q = query.q.trim()
  if (q) p.set('q', q.slice(0, 100))
  p.set('today', query.today)
  if (cursor) p.set('cursor', cursor)
  if (limit) p.set('limit', String(limit))
  return `/tasks/open?${p.toString()}`
}

export interface PageCounts {
  tabs: Record<TaskTab, number>
  stats: { highPriority: number; inProgress: number; dueToday: number; doneThisWeek: number }
}

/**
 * Tab and tile counts: open work from the server's summary (never from the
 * rows on screen, which are only the first page), finished work from the
 * rows the window brought.
 */
export function pageCounts(summary: TaskOpenSummary | null | undefined, done: readonly TaskListItem[], today: string): PageCounts {
  const monday = weekStart(today)
  const completed = done.filter((t) => t.status === 'completed')
  const doneThisWeek = completed.filter((t) => (t.updated_at ?? '').slice(0, 10) >= monday).length
  const s = summary
  return {
    tabs: {
      all: (s?.open ?? 0) + completed.length,
      to_do: s?.to_do ?? 0,
      in_progress: s?.in_progress ?? 0,
      completed: completed.length,
      overdue: s?.overdue ?? 0,
    },
    stats: {
      highPriority: s?.high_priority ?? 0,
      inProgress: s?.in_progress ?? 0,
      dueToday: s?.due_today ?? 0,
      doneThisWeek,
    },
  }
}

/** Each person's open and late count from the summary, keyed by user id ('none' = nobody on it). */
export function peopleCounts(summary: TaskOpenSummary | null | undefined): Map<string, { open: number; late: number }> | undefined {
  if (!summary) return undefined
  return new Map(summary.people.map((p) => [p.user_id ?? 'none', { open: p.open, late: p.late }]))
}

/** "Showing 100 of 1,158". */
export function showingLine(shown: number, total: number): string {
  const n = (v: number) => v.toLocaleString('en-IN')
  return `Showing ${n(Math.min(shown, total))} of ${n(total)}`
}
