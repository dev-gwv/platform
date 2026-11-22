import { Hono } from 'hono'
import { companyTaskPriority, createTaskPriorityRequest, updateTaskPriorityRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/** The custom priority catalogue: a studio's own priorities beside the four built in. */
export const priorityRoutes = new Hono<AppEnv>()
  // Declared before '/:id'-shaped routes so "priorities" is never read as one.
  .get('/priorities', requireAction('tasks', 'view'), async (c) => {
    const rows = await attempt(c, 'tasks.priorities.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select id, code, label, tone, sort_order from company_task_priorities order by sort_order, label`,
      ),
    )
    if (!rows) fail(400, 'We could not load priorities.')
    return c.json(companyTaskPriority.array().parse(rows))
  })

  .post('/priorities', requireAction('tasks', 'edit'), async (c) => {
    const parsed = createTaskPriorityRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the priority details.')
    const auth = c.get('auth')
    const row = await attempt(
      c,
      'tasks.priorities.create',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const nextRow = await sql<{ next: number }[]>`
            select coalesce(max(sort_order), 0) + 10 as next from company_task_priorities where company_id = ${auth.companyId}`
          const next = nextRow[0]?.next ?? 10
          const rows = await sql`
            insert into company_task_priorities ${sql({ company_id: auth.companyId, ...parsed.data, sort_order: next })}
            returning id, code, label, tone, sort_order`
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (row === 'taken') fail(409, 'A priority with this code already exists.')
    if (!row) fail(400, 'We could not add this priority.')
    await audit(c, { action: 'task_priority.create', entityType: 'task_priority', entityId: row.id, after: parsed.data })
    return c.json(companyTaskPriority.parse(row), 201)
  })

  .patch('/priorities/:id', requireAction('tasks', 'edit'), async (c) => {
    const parsed = updateTaskPriorityRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the priority details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'tasks.priorities.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          update company_task_priorities set ${sql(parsed.data)} where id = ${id}
          returning id, code, label, tone, sort_order`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That priority was not found.')
    const updated = companyTaskPriority.parse(row)
    await audit(c, { action: 'task_priority.update', entityType: 'task_priority', entityId: id, after: parsed.data })
    return c.json(updated)
  })

  .delete('/priorities/:id', requireAction('tasks', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'tasks.priorities.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from company_task_priorities where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this priority.')
    if (!rows.length) fail(404, 'That priority was not found.')
    await audit(c, { action: 'task_priority.delete', entityType: 'task_priority', entityId: id })
    return c.body(null, 204)
  })
