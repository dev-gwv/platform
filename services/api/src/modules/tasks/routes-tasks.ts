import { Hono } from 'hono'
import { createTaskRequest, generateTasksRequest, updateTaskRequest, updateTaskStatusRequest, z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { readLimit, selectTasks } from './task-query'
import { fail } from '../../middleware/errors'
import { uuidParam, uuidQuery } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { donePage, list, ownTaskPatch, sayIt, toItems, windowOf } from './shared'

/** The studio's tasks: list, add, generate from deliverables, change, delete. */
export const taskRoutes = new Hono<AppEnv>()
  // ── Admin/manager task ops ──────────────────────────────────
  .get('/', requireAction('tasks', 'view'), async (c) => {
    const assignee = c.req.query('assignee')
    const ac = assignee ? z.string().uuid().safeParse(assignee) : null
    if (assignee && !ac?.success) fail(422, 'Invalid assignee id.')
    const project = uuidQuery(c, 'project_id') ?? undefined
    const deliverable = uuidQuery(c, 'deliverable_id') ?? undefined
    const parent = uuidQuery(c, 'parent_id') ?? undefined
    const { since, before } = windowOf(c)
    const doneOnly = c.req.query('done_only') === '1'
    // ?q= searches titles for a picker: twenty at most, never the whole studio.
    // An empty ?q= is the newest twenty, the picker's first look.
    const rawQ = c.req.query('q')
    const q = rawQ?.trim().slice(0, 100) || undefined
    const limit = before ? readLimit(c.req.query('limit'), 50, 100) : rawQ !== undefined ? readLimit(c.req.query('limit'), 20, 20) : undefined
    const rows = await attempt(c, 'tasks.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) =>
        selectTasks(sql, { assignee, project, deliverable, parent, q, doneOnly, since, before, limit: before && limit ? limit + 1 : limit }),
      ),
    )
    if (!rows) fail(400, 'We could not load tasks.')
    if (before && limit) return c.json(donePage(rows, limit))
    return c.json(list.parse(toItems(rows, new Map())))
  })

  // Someone who manages tasks gives them to anyone. Everyone else may add a
  // task for themselves only — a personal to-do that still goes through the
  // same submit → review loop (RLS enforces this too, 0192).
  .post('/', async (c) => {
    const parsed = createTaskRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the task details.')
    const d = parsed.data
    const auth = c.get('auth')
    const manages = auth.access.hasAction('tasks', 'create')
    if (!manages && d.assignees.some((u) => u !== auth.userId)) {
      fail(403, 'You can add tasks for yourself. A manager gives tasks to others.')
    }
    const id = await attempt(c, 'tasks.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        let created: string | null
        if (manages) {
          const rows = await sql<{ id: string }[]>`
            select create_task_with_assignees(
              p_project_id => ${d.project_id},
              p_deliverable_id => ${d.deliverable_id},
              p_title => ${d.title},
              p_status => ${d.status},
              p_priority => ${d.priority},
              p_due_date => ${d.due_date ?? null},
              p_assignees => ${d.assignees}::uuid[]
            ) as id`
          created = rows[0]?.id ?? null
        } else {
          const rows = await sql<{ id: string }[]>`
            insert into tasks ${sql({
              company_id: auth.companyId,
              title: d.title,
              status: d.status === 'in_progress' ? 'in_progress' : 'to_do',
              priority: d.priority,
              due_date: d.due_date ?? null,
              tag: d.tag,
              created_by: auth.userId,
            })} returning id`
          created = rows[0]?.id ?? null
          if (created) {
            await sql`insert into task_assignees (task_id, user_id, company_id) values (${created}, ${auth.userId}, ${auth.companyId})`
          }
        }
        // The RPC predates descriptions, tags, custom priorities, voice notes
        // and subtask links; set them alongside rather than changing a
        // signature the board and the generator also call.
        if (created) {
          await sql`update tasks set ${sql({
            tag: d.tag,
            ...(d.description ? { description: d.description } : {}),
            ...(manages && d.custom_priority_code !== undefined ? { custom_priority_code: d.custom_priority_code } : {}),
            ...(d.voice_note_url !== undefined ? { voice_note_url: d.voice_note_url } : {}),
            ...(manages && d.parent_task_id !== undefined ? { parent_task_id: d.parent_task_id } : {}),
          })} where id = ${created}`
        }
        return created
      }),
    )
    if (!id) fail(400, 'We could not create the task.')
    await audit(c, { action: 'task.create', entityType: 'task', entityId: id, after: { title: d.title, project_id: d.project_id, assignees: d.assignees, own: !manages } })
    return c.json({ id }, 201)
  })

  .post('/generate', requireAction('tasks', 'create'), async (c) => {
    const parsed = generateTasksRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A project is required.')
    const d = parsed.data
    const created = await attempt(c, 'tasks.generate', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          select * from generate_tasks_for_project_deliverables(
            p_project_id => ${d.project_id}, p_assignees => ${d.assignees}::uuid[])`
        return rows.length
      }),
    )
    if (created === null) fail(400, 'We could not generate tasks.')
    await audit(c, { action: 'task.generate', entityType: 'project', entityId: d.project_id, after: { created } })
    return c.json({ created }, 201)
  })

  .patch('/:id/status', requireAction('tasks', 'edit'), async (c) => {
    const parsed = updateTaskStatusRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid status.')
    const id = uuidParam(c)
    const rows = await attempt(c, 'tasks.status', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update tasks set ${sql({ status: parsed.data.status })} where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update the task.')
    if (!rows.length) fail(404, 'That task was not found.')
    await audit(c, { action: 'task.status', entityType: 'task', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .patch('/:id', async (c) => {
    const parsed = updateTaskRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the task details.')
    const { assignees, ...patch } = parsed.data
    if (Object.keys(patch).length === 0 && assignees === undefined) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const auth = c.get('auth')
    // Someone who does not manage tasks edits only a task they made for
    // themselves, and only its own words, date, priority and status (0285).
    if (!auth.access.hasAction('tasks', 'edit')) {
      const own = ownTaskPatch(parsed.data)
      if (!own) fail(403, 'You can change only the title, details, date, priority and status of a task you made for yourself.')
      const ok = await attempt(
        c,
        'tasks.update_own',
        () =>
          withUser(c.env, auth.userId, async (sql) => {
            await sql`select update_own_task(${id}, ${sql.json(own as never)}::jsonb)`
            return true as const
          }),
        { onCode: (code, err) => (code === '42501' ? ('denied' as const) : sayIt(code, err)) },
      )
      if (ok === 'denied') fail(403, 'You can change only tasks you made for yourself.')
      if (!ok) fail(400, 'We could not update the task.')
      await audit(c, { action: 'task.update', entityType: 'task', entityId: id, after: own })
      return c.body(null, 204)
    }
    const found = await attempt(c, 'tasks.update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows =
          Object.keys(patch).length > 0
            ? await sql<{ id: string }[]>`update tasks set ${sql(patch)} where id = ${id} returning id`
            : await sql<{ id: string }[]>`select id from tasks where id = ${id}`
        if (!rows.length) return false
        if (assignees !== undefined) {
          // Only the difference: re-inserting everyone would tell people
          // already on the task that they had just been given it (0192).
          const want = [...new Set(assignees)]
          await sql`delete from task_assignees where task_id = ${id} and not (user_id = any(${want}::uuid[]))`
          await sql`
            insert into task_assignees (task_id, user_id, company_id)
            select ${id}, u, ${auth.companyId} from unnest(${want}::uuid[]) as u
            on conflict (task_id, user_id) do nothing`
        }
        return true
      }),
    )
    if (!found) fail(404, 'That task was not found.')
    await audit(c, { action: 'task.update', entityType: 'task', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/:id', async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    // Without delete access, only a task made for oneself goes (0285).
    if (!auth.access.hasAction('tasks', 'delete')) {
      const gone = await attempt(c, 'tasks.delete_own', () =>
        withUser(c.env, auth.userId, async (sql) => {
          const [r] = await sql<{ ok: boolean }[]>`select delete_own_task(${id}) as ok`
          return r?.ok ? ('ok' as const) : ('denied' as const)
        }),
      )
      if (gone === 'denied') fail(403, 'You can delete only tasks you made for yourself.')
      if (!gone) fail(400, 'We could not delete this task.')
      await audit(c, { action: 'task.delete', entityType: 'task', entityId: id, after: { own: true } })
      return c.body(null, 204)
    }
    const rows = await attempt(c, 'tasks.delete', () =>
      withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`delete from tasks where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this task.')
    if (!rows.length) fail(404, 'That task was not found.')
    await audit(c, { action: 'task.delete', entityType: 'task', entityId: id })
    return c.body(null, 204)
  })
