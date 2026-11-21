import { Hono } from 'hono'
import { taskOpenPage } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import {
  decodeUrgencyCursor,
  encodeUrgencyCursor,
  openSummary,
  readLimit,
  selectTasks,
  type DueFilter,
  type OpenTab,
  type TaskFilter,
} from './task-query'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DUES: readonly DueFilter[] = ['overdue', 'today', 'week', 'none']
const TABS: readonly OpenTab[] = ['to_do', 'in_progress', 'overdue']

/** The first page of open tasks, and how many more a Show more brings. */
export const OPEN_PAGE_SIZE = 100

type Query = (k: string) => string | undefined

/**
 * The Tasks page's toolbar, read off the query string: whose (`mine=1`, or
 * `member=<id>|none`), `due`, `tab`, `q` and `today` (the viewer's day).
 * Someone who cannot view the studio's tasks always gets their own, whatever
 * they ask for (RLS caps them anyway; this keeps "mine" meaning mine).
 */
export function readOpenFilter(query: Query, me: string, seesStudio: boolean): TaskFilter {
  const member = query('member') || undefined
  if (member && member !== 'none' && !UUID_RE.test(member)) fail(422, 'Invalid member.')
  const due = query('due') || undefined
  if (due && due !== 'all' && !DUES.includes(due as DueFilter)) fail(422, 'Invalid due filter.')
  const tab = query('tab') || undefined
  if (tab && tab !== 'all' && !TABS.includes(tab as OpenTab)) fail(422, 'Invalid tab.')
  const today = query('today') || undefined
  if (today && (!DAY_RE.test(today) || Number.isNaN(Date.parse(today)))) fail(422, 'today must be a date (YYYY-MM-DD).')
  const mine = !seesStudio || query('mine') === '1'
  return {
    assignee: mine ? me : undefined,
    member: mine ? undefined : member,
    due: due && due !== 'all' ? (due as DueFilter) : undefined,
    tab: tab && tab !== 'all' ? (tab as OpenTab) : undefined,
    today,
    search: query('q')?.trim().slice(0, 100) || undefined,
  }
}

/**
 * GET /tasks/open: open tasks a page at a time (speed audit, 21 Nov: a studio
 * with 1,158 open tasks downloaded 0.99 MB on every open of Tasks). Late
 * first, then by due date, priority and title -- the order the page shows --
 * with a keyset cursor, never OFFSET. The first page (no cursor) also carries
 * the counts for the tabs, the tiles and each person's column. Finished work
 * still comes from GET /tasks?done_since=…&done_only=1 and done_before pages.
 */
export const openRoutes = new Hono<AppEnv>().get('/open', async (c) => {
  const auth = c.get('auth')
  const query: Query = (k) => c.req.query(k)
  const filter = readOpenFilter(query, auth.userId, auth.access.hasAction('tasks', 'view'))
  const after = decodeUrgencyCursor(c.req.query('cursor'))
  if (after === 'bad') fail(422, 'Invalid cursor.')
  const limit = readLimit(c.req.query('limit'), OPEN_PAGE_SIZE, 200)
  const result = await attempt(c, 'tasks.open', () =>
    withUser(c.env, auth.userId, async (sql) => {
      const rows = await selectTasks(sql, { ...filter, urgency: true, after: after ?? undefined, limit: limit + 1 })
      const summary = after ? null : ((await openSummary(sql, filter))[0] ?? null)
      return { rows, summary }
    }),
  )
  if (!result) fail(400, 'We could not load tasks.')
  const items = result.rows.slice(0, limit)
  const last = items[items.length - 1]
  return c.json(
    taskOpenPage.parse({
      items: items.map((r) => ({ ...r, sort_order: 0 })),
      next_cursor: result.rows.length > limit && last ? encodeUrgencyCursor(last) : null,
      summary: result.summary,
    }),
  )
})
