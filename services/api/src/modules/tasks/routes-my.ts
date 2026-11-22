import { Hono } from 'hono'
import { updateTaskStatusRequest, z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { readLimit, selectTasks } from './task-query'
import { fail } from '../../middleware/errors'
import { uuidParam, uuidQuery } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { donePage, isOwnTask, list, sayIt, toItems, windowOf } from './shared'

/** A person's own tasks (any active member): GET /tasks/my, overdue, and the status of one of theirs. */
export const myRoutes = new Hono<AppEnv>()
  // ── Employee subset (any active member) ─────────────────────
  .get('/my', async (c) => {
    // Mine means assigned to me -- for everyone. RLS caps an employee to their
    // assigned tasks anyway, but it lets a manager see all of them, and "My
    // tasks" listed the whole studio's work for a manager as their own.
    // ?project_id narrows to one project (My Work's project page).
    // ?open=1 is open tasks only (Home, Submit work); ?done_since and
    // ?done_before window and page the finished ones as on GET /tasks.
    const me = c.get('auth').userId
    const project = uuidQuery(c, 'project_id') ?? undefined
    const openOnly = c.req.query('open') === '1'
    // ?done_only=1 with ?done_since: only the window's finished tasks (the
    // Tasks page pages its open ones through GET /tasks/open).
    const doneOnly = c.req.query('done_only') === '1'
    const { since, before } = windowOf(c)
    const limit = before ? readLimit(c.req.query('limit'), 50, 100) : undefined
    const rows = await attempt(c, 'tasks.my', () =>
      withUser(c.env, me, (sql) =>
        selectTasks(sql, { assignee: me, project, openOnly, doneOnly, since, before, limit: limit === undefined ? undefined : limit + 1 }),
      ),
    )
    if (!rows) fail(400, 'We could not load your tasks.')
    if (before && limit) return c.json(donePage(rows, limit))
    return c.json(list.parse(toItems(rows, new Map())))
  })

  // How many of my open tasks are past their date — the sidebar's badge.
  // `today` is the viewer's own date (their timezone, not the server's).
  .get('/my/overdue', async (c) => {
    const me = c.get('auth').userId
    const q = c.req.query('today')
    const today = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : null
    const rows = await attempt(c, 'tasks.my_overdue', () =>
      withUser(c.env, me, (sql) => sql<{ count: number }[]>`
        select count(*)::int as count
          from tasks t
         where exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = ${me})
           and t.status not in ('completed', 'cancelled')
           and t.due_date < coalesce(${today}::date, (now() at time zone 'Asia/Kolkata')::date)`),
    )
    if (!rows) fail(400, 'We could not count your tasks.')
    return c.json({ count: rows[0]?.count ?? 0 })
  })

  .patch('/my/:id/status', async (c) => {
    // Lovable parity: a voice-note link can ride along with the status move.
    const withVoice = updateTaskStatusRequest
      .extend({
        voice_note_url: z.string().trim().max(500).nullable().optional(),
        reason: z.string().trim().max(500).optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!withVoice.success) fail(422, 'Invalid status.')
    const id = uuidParam(c)
    const d = withVoice.data
    // Closing a task is a manager's (or a review's) call; someone who manages
    // tasks can close their own from here too.
    const manages = c.get('auth').access.hasAction('tasks', 'edit')
    const ok = await attempt(
      c,
      'tasks.my_status',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          if (manages && (d.status === 'completed' || d.status === 'cancelled')) {
            const rows = await sql`update tasks set status = ${d.status} where id = ${id} returning id`
            if (!rows.length) return false
          } else if (d.status !== 'blocked' && d.status !== 'review' && (await isOwnTask(sql, id))) {
            // A task someone made for themselves is theirs to tick done and to
            // reopen (0285); nobody else has to review it.
            await sql`select update_own_task(${id}, ${sql.json({ status: d.status })}::jsonb)`
          } else {
            await sql`select update_my_task_status(p_task_id => ${id}, p_status => ${d.status}, p_reason => ${d.reason ?? null})`
          }
          if (d.voice_note_url !== undefined) {
            await sql`update tasks set voice_note_url = ${d.voice_note_url} where id = ${id}`
          }
          return true
        }),
      { onCode: sayIt },
    )
    if (!ok) fail(403, 'You can only update tasks assigned to you.')
    await audit(c, { action: 'task.status', entityType: 'task', entityId: id, after: d })
    return c.body(null, 204)
  })
