import { Hono } from 'hono'
import { taskListItem } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { selectTasks } from './task-query'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'

/** One task, for the detail dialog. Mounted last: every static GET shape (/my, /board, /priorities, /bundles) matches first. */
export const detailRoutes = new Hono<AppEnv>()
  // Single task for the detail dialog. Registered last so the static GET
  // shapes above (/my, /board, /priorities, /bundles) keep matching first.
  // RLS scopes the read: assignees see their own, managers/admins the studio's.
  .get('/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'tasks.detail', () =>
      withUser(c.env, c.get('auth').userId, (sql) => selectTasks(sql, { id })),
    )
    if (!rows) fail(400, 'We could not load this task.')
    if (!rows.length) fail(404, 'That task was not found.')
    return c.json(taskListItem.parse({ ...rows[0], sort_order: 0 }))
  })
