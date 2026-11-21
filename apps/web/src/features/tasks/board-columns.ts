import type { TaskColumnPage, TaskColumns, TaskListItem, TaskStatus } from '@ipc/contracts'

/**
 * The Tasks board a page at a time (GET /tasks/columns, speed audit 21 Nov),
 * as the Leads pipeline reads its columns. These are the pure parts: the
 * address a board and a column's Show more are asked at, and the changes a
 * drag or the bulk bar makes to the cached columns before the server answers.
 */

/** A column's first page and each Show more (`TASK_COLUMN_PAGE` in task-columns.ts). */
export const TASK_COLUMN_PAGE = 30

/** The board's filters as the server reads them (GET /tasks/open's toolbar, plus a project). */
export interface BoardQuery {
  /** Only tasks I am on. */
  mine: boolean
  /** One person ('none' = nobody on it); '' = everyone. */
  member: string
  /** The Due date filter ('all' = any date). */
  due: string
  /** The search box. */
  q: string
  /** The viewer's day. */
  today: string
  /** One project (the production board's filter); '' = every project. */
  project: string
  /** Done reaches back to this India day (YYYY-MM-DD). */
  since: string
}

function boardParams(b: BoardQuery): URLSearchParams {
  const p = new URLSearchParams()
  if (b.mine) p.set('mine', '1')
  else if (b.member) p.set('member', b.member)
  if (b.due && b.due !== 'all') p.set('due', b.due)
  const q = b.q.trim()
  if (q) p.set('q', q.slice(0, 100))
  if (b.project) p.set('project_id', b.project)
  p.set('today', b.today)
  p.set('done_since', b.since)
  return p
}

/** `/tasks/columns?…`: only what narrows is sent, so equal toolbars share a cache entry. */
export function taskColumnsPath(b: BoardQuery): string {
  return `/tasks/columns?${boardParams(b).toString()}`
}

/** `/tasks/columns/page?…`: the next cards of one column. */
export function taskColumnPagePath(b: BoardQuery, status: TaskStatus, cursor: string, limit = TASK_COLUMN_PAGE): string {
  const p = boardParams(b)
  p.set('status', status)
  p.set('cursor', cursor)
  p.set('limit', String(limit))
  return `/tasks/columns/page?${p.toString()}`
}

/** A Show more page added under the cards already in its column. */
export function appendToColumn(data: TaskColumns, status: TaskStatus, page: TaskColumnPage): TaskColumns {
  return {
    ...data,
    columns: data.columns.map((c) => {
      if (c.status !== status) return c
      const have = new Set(c.items.map((r) => r.id))
      return { ...c, items: [...c.items, ...page.items.filter((r) => !have.has(r.id))], next_cursor: page.next_cursor }
    }),
  }
}

/** How many more a column holds than it shows: the N in "Show N more". */
export function moreInColumn(c: TaskColumns['columns'][number] | undefined): number {
  if (!c?.next_cursor) return 0
  return Math.max(0, c.total - c.items.length)
}

/**
 * The columns with these tasks moved to `to`, at `at` in it (the top when
 * not given). Each column a task leaves loses one from its total and the one
 * it joins gains one, so the header counts move with the card. A task that is
 * in no column (an older done one, paged in below Done) only joins. Tasks
 * already in `to` stay where they are.
 */
export function moveTasks(data: TaskColumns, tasks: readonly TaskListItem[], to: TaskStatus, at = 0): TaskColumns {
  const inTarget = new Set(data.columns.find((c) => c.status === to)?.items.map((r) => r.id) ?? [])
  const moving = tasks.filter((t) => !inTarget.has(t.id))
  if (moving.length === 0) return data
  const ids = new Set(moving.map((t) => t.id))
  const landed = moving.map((t) => ({ ...t, status: to }))
  const columns = data.columns.map((c) => {
    if (c.status === to) {
      const items = [...c.items]
      items.splice(Math.max(0, Math.min(at, items.length)), 0, ...landed)
      return { ...c, items, total: c.total + landed.length }
    }
    const leaving = c.items.filter((r) => ids.has(r.id)).length
    if (leaving === 0) return c
    return { ...c, items: c.items.filter((r) => !ids.has(r.id)), total: Math.max(0, c.total - leaving) }
  })
  return { ...data, columns }
}

/** One column's cards in a new order (a drag inside it); totals unchanged. */
export function reorderColumn(data: TaskColumns, status: TaskStatus, ids: readonly string[]): TaskColumns {
  return {
    ...data,
    columns: data.columns.map((c) => {
      if (c.status !== status) return c
      const byId = new Map(c.items.map((r) => [r.id, r]))
      const placed = ids.map((id) => byId.get(id)).filter((r): r is TaskListItem => !!r)
      const rest = c.items.filter((r) => !ids.includes(r.id))
      return { ...c, items: [...placed, ...rest] }
    }),
  }
}

/** A column's cards and header count; Done adds the older finished ones paged in below it. */
export function laneOf(
  data: TaskColumns | undefined,
  status: TaskStatus,
  older: readonly TaskListItem[] = [],
): { items: TaskListItem[]; count: number; more: number; cursor: string | null } {
  const c = data?.columns.find((x) => x.status === status)
  const items = c?.items ?? []
  const extra = status === 'completed' && !c?.next_cursor ? older.filter((t) => t.status === 'completed' && !items.some((r) => r.id === t.id)) : []
  return {
    items: extra.length ? [...items, ...extra] : items,
    count: (c?.total ?? 0) + extra.length,
    more: moreInColumn(c),
    cursor: c?.next_cursor ?? null,
  }
}
