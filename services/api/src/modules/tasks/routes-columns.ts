import { Hono } from 'hono'
import { taskColumnPage, taskColumns } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { uuidQuery } from '../../lib/params'
import { readOpenFilter } from './routes-open'
import { readDoneSince, readLimit, selectTasks, type RawTask, type TaskFilter } from './task-query'
import {
  BOARD_STATUSES,
  TASK_COLUMN_PAGE,
  assembleColumns,
  assemblePage,
  decodeBoardCursor,
  selectColumnKeys,
  selectColumnPageKeys,
  type BoardKey,
  type BoardStatus,
} from './task-columns'

type Query = (k: string) => string | undefined

/** How far back Done reaches when the page does not say (the web's TASK_WINDOW_DAYS). */
const WINDOW_DAYS = 30

/** The start of the India day `days` before today, as a moment. */
export function defaultSince(now = new Date(), days = WINDOW_DAYS): string {
  const ist = new Date(now.getTime() + 330 * 60_000 - days * 86_400_000)
  return `${ist.toISOString().slice(0, 10)}T00:00:00+05:30`
}

/**
 * The board's filters: exactly GET /tasks/open's toolbar (whose, due date,
 * search, today; someone who cannot view the studio's tasks always gets
 * their own), plus `project_id` (the production board's project filter) and
 * `done_since` for the Done column's window.
 */
export function readBoardQuery(query: Query, me: string, seesStudio: boolean) {
  const filter: TaskFilter = { ...readOpenFilter(query, me, seesStudio), tab: undefined }
  const since = readDoneSince(query('done_since'))
  if (since === 'bad') fail(422, 'done_since must be a date (YYYY-MM-DD).')
  return { filter, since: since ?? defaultSince() }
}

/**
 * GET /tasks/columns and GET /tasks/columns/page: the Tasks board a page at a
 * time (speed audit, 21 Nov), as the Leads pipeline reads its columns. The
 * board downloaded every open task and 30 days of done ones on every open.
 * Scoped as GET /tasks/open is: no extra permission, the toolbar read by
 * readOpenFilter, and RLS (withUser) deciding whose tasks are there at all.
 */
export const columnRoutes = new Hono<AppEnv>()
  // Every column's first 30 cards with its own total, in two reads.
  .get('/columns', async (c) => {
    const auth = c.get('auth')
    const query: Query = (k) => c.req.query(k)
    const { filter, since } = readBoardQuery(query, auth.userId, auth.access.hasAction('tasks', 'view'))
    const project = uuidQuery(c, 'project_id') ?? undefined
    const f = { ...filter, project }
    const result = await attempt(c, 'tasks.columns', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const keys = (await selectColumnKeys(sql, f, since, TASK_COLUMN_PAGE)) as unknown as BoardKey[]
        const shown = keys.filter((k) => Number(k.k_n) <= TASK_COLUMN_PAGE).map((k) => k.id)
        const rows: RawTask[] = shown.length ? await selectTasks(sql, { ids: shown, since }) : []
        return { keys, rows }
      }),
    )
    if (!result) fail(400, 'We could not load the board.')
    return c.json(taskColumns.parse({ columns: assembleColumns(result.keys, result.rows, TASK_COLUMN_PAGE) }))
  })

  // Show more on one column: the next cards of that status after the cursor.
  .get('/columns/page', async (c) => {
    const auth = c.get('auth')
    const query: Query = (k) => c.req.query(k)
    const { filter, since } = readBoardQuery(query, auth.userId, auth.access.hasAction('tasks', 'view'))
    const project = uuidQuery(c, 'project_id') ?? undefined
    const status = c.req.query('status') as BoardStatus | undefined
    if (!status || !BOARD_STATUSES.includes(status)) fail(422, 'Invalid status.')
    const after = decodeBoardCursor(c.req.query('cursor'))
    if (after === 'bad') fail(422, 'Invalid cursor.')
    const limit = readLimit(c.req.query('limit'), TASK_COLUMN_PAGE, 100)
    const f = { ...filter, project }
    const result = await attempt(c, 'tasks.columns_page', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const keys = (await selectColumnPageKeys(sql, f, since, status, after, limit)) as unknown as BoardKey[]
        const shown = keys.slice(0, limit).map((k) => k.id)
        const rows: RawTask[] = shown.length ? await selectTasks(sql, { ids: shown, since }) : []
        return { keys, rows }
      }),
    )
    if (!result) fail(400, 'We could not load more tasks.')
    return c.json(taskColumnPage.parse(assemblePage(result.keys, result.rows, limit)))
  })
