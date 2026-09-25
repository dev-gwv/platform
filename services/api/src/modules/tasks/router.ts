import { Hono } from 'hono'
import {
  applyBundleRequest,
  companyTaskPriority,
  createBundleRequest,
  updateBundleRequest,
  createTaskPriorityRequest,
  updateTaskPriorityRequest,
  createTaskRequest,
  generateTasksRequest,
  setBoardOrderRequest,
  taskBundle,
  taskListItem,
  updateTaskRequest,
  updateTaskStatusRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { textParam, uuidParam, uuidQuery } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import type { TransactionSql } from 'postgres'

const list = taskListItem.array()

interface RawTask {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  due_date: string | null
  project_id: string | null
  project_name: string | null
  custom_priority_code: string | null
  custom_priority_label: string | null
  custom_priority_tone: string | null
  custom_status_code: string | null
  custom_status_label: string | null
  deliverable_id: string | null
  parent_task_id: string | null
  voice_note_url: string | null
  assignee_names: string[]
  assignee_ids: string[]
}

function toItems(rows: RawTask[], order: Map<string, number>) {
  return rows.map((r) => ({ ...r, sort_order: order.get(r.id) ?? 0 }))
}

// Flat select with the project name joined in (was PostgREST `projects(name)`).
// `assignee` narrows to tasks assigned to one person, for an admin previewing
// what a specific team member's board looks like. `project` narrows to one
// project, for its detail page's own Tasks tab. `deliverable` narrows to one
// deliverable (per-deliverable tasks UI).
const selectTasks = (sql: TransactionSql, assignee?: string, project?: string, deliverable?: string) => sql<RawTask[]>`
  select t.id, t.title, t.description, t.status, t.priority, t.due_date, t.project_id,
         p.name as project_name,
         cp.code as custom_priority_code, cp.label as custom_priority_label, cp.tone as custom_priority_tone,
         t.custom_status_code, cs.label as custom_status_label,
         t.deliverable_id, t.parent_task_id, t.voice_note_url,
         coalesce(
           array_agg(u.name order by u.name) filter (where u.user_id is not null),
           '{}'::text[]
         ) as assignee_names,
         coalesce(
           array_agg(u.user_id order by u.name) filter (where u.user_id is not null),
           '{}'::uuid[]
         ) as assignee_ids
  from tasks t
  left join projects p on p.id = t.project_id
  left join task_assignees a on a.task_id = t.id
  left join users u on u.user_id = a.user_id
  left join company_task_priorities cp on cp.company_id = t.company_id and cp.code = t.custom_priority_code
  left join company_deliverable_statuses cs on cs.company_id = t.company_id and cs.code = t.custom_status_code
  where ${assignee ? sql`exists (select 1 from task_assignees a2 where a2.task_id = t.id and a2.user_id = ${assignee})` : sql`true`}
    and ${project ? sql`t.project_id = ${project}` : sql`true`}
    and ${deliverable ? sql`t.deliverable_id = ${deliverable}` : sql`true`}
  group by t.id, p.name, cp.code, cp.label, cp.tone, cs.label
  order by t.created_at desc`

export const tasksRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ── Custom priority catalogue ────────────────────────────────
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

  // ── Employee subset (any active member) ─────────────────────
  .get('/my', async (c) => {
    // Mine means assigned to me -- for everyone. RLS caps an employee to their
    // assigned tasks anyway, but it lets a manager see all of them, and "My
    // tasks" listed the whole studio's work for a manager as their own.
    // ?project_id narrows to one project (My Work's project page).
    const me = c.get('auth').userId
    const project = uuidQuery(c, 'project_id') ?? undefined
    const rows = await attempt(c, 'tasks.my', () => withUser(c.env, me, (sql) => selectTasks(sql, me, project)))
    if (!rows) fail(400, 'We could not load your tasks.')
    return c.json(list.parse(toItems(rows, new Map())))
  })

  .patch('/my/:id/status', async (c) => {
    // Lovable parity: a voice-note link can ride along with the status move.
    const withVoice = updateTaskStatusRequest
      .extend({ voice_note_url: z.string().trim().max(500).nullable().optional() })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!withVoice.success) fail(422, 'Invalid status.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'tasks.my_status', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select update_my_task_status(p_task_id => ${id}, p_status => ${withVoice.data.status})`
        if (withVoice.data.voice_note_url !== undefined) {
          await sql`update tasks set voice_note_url = ${withVoice.data.voice_note_url} where id = ${id}`
        }
        return true
      }),
    )
    if (!ok) fail(403, 'You can only update tasks assigned to you.')
    await audit(c, { action: 'task.status', entityType: 'task', entityId: id, after: withVoice.data })
    return c.body(null, 204)
  })

  // ── Board (persisted drag order) ────────────────────────────
  .get('/board', requireAction('tasks', 'view'), async (c) => {
    const view = c.req.query('view') ?? 'default'
    const result = await attempt(c, 'tasks.board', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const tasks = await selectTasks(sql)
        const orders = await sql<{ task_id: string; sort_order: number }[]>`
          select task_id, sort_order from production_board_card_order where board_view = ${view}`
        return { tasks, orders }
      }),
    )
    if (!result) fail(400, 'We could not load the board.')
    const orderMap = new Map(result.orders.map((o) => [o.task_id, o.sort_order]))
    return c.json(list.parse(toItems(result.tasks, orderMap)))
  })

  /** Per-lane colour, so a studio can tint the piles it cares about. */
  .get('/board/lanes', requireAction('tasks', 'view'), async (c) => {
    const rows = await attempt(c, 'tasks.board_lanes', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select lane_key, color from board_lane_prefs where board_view = 'default'`),
    )
    if (!rows) fail(400, 'We could not load the board settings.')
    return c.json(z.object({ lane_key: z.string(), color: z.string() }).array().parse(rows))
  })

  .put('/board/lanes/:lane', requireAction('tasks', 'edit'), async (c) => {
    const lane = textParam(c, 'lane', 60)
    const parsed = z
      .object({ color: z.enum(['default', 'slate', 'blue', 'green', 'amber', 'rose', 'violet']) })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'That is not a colour this board uses.')
    const auth = c.get('auth')
    const ok = await attempt(c, 'tasks.board_lane_color', () =>
      withUser(c.env, auth.userId, async (sql) => {
        await sql`
          insert into board_lane_prefs (company_id, board_view, lane_key, color)
          values (${auth.companyId}, 'default', ${lane}, ${parsed.data.color})
          on conflict (company_id, board_view, lane_key)
            do update set color = excluded.color, updated_at = now()`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not save that colour.')
    return c.body(null, 204)
  })

  .post('/board/order', requireAction('tasks', 'edit'), async (c) => {
    const parsed = setBoardOrderRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid board order payload.')
    const d = parsed.data
    const ok = await attempt(c, 'tasks.board_order', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select set_board_lane_order(
          p_board_view => ${d.board_view}, p_lane_key => ${d.lane_key}, p_task_ids => ${d.task_ids}::uuid[])`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not save the board order.')
    await audit(c, { action: 'board.reorder', entityType: 'board', entityId: d.board_view, after: { lane: d.lane_key, count: d.task_ids.length } })
    return c.body(null, 204)
  })

  // ── Admin/manager task ops ──────────────────────────────────
  .get('/', requireAction('tasks', 'view'), async (c) => {
    const assignee = c.req.query('assignee')
    const ac = assignee ? z.string().uuid().safeParse(assignee) : null
    if (assignee && !ac?.success) fail(422, 'Invalid assignee id.')
    const project = uuidQuery(c, 'project_id') ?? undefined
    const deliverable = uuidQuery(c, 'deliverable_id') ?? undefined
    const rows = await attempt(c, 'tasks.list', () => withUser(c.env, c.get('auth').userId, (sql) => selectTasks(sql, assignee, project, deliverable)))
    if (!rows) fail(400, 'We could not load tasks.')
    return c.json(list.parse(toItems(rows, new Map())))
  })

  .post('/', requireAction('tasks', 'create'), async (c) => {
    const parsed = createTaskRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the task details.')
    const d = parsed.data
    const id = await attempt(c, 'tasks.create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
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
        const created = rows[0]?.id ?? null
        // The RPC predates descriptions, custom priorities, voice notes and
        // subtask links; set them alongside rather than changing a signature
        // the board and the generator also call.
        if (
          created &&
          (d.description ||
            d.custom_priority_code !== undefined ||
            d.voice_note_url !== undefined ||
            d.parent_task_id !== undefined)
        ) {
          await sql`update tasks set ${sql({
            ...(d.description ? { description: d.description } : {}),
            ...(d.custom_priority_code !== undefined ? { custom_priority_code: d.custom_priority_code } : {}),
            ...(d.voice_note_url !== undefined ? { voice_note_url: d.voice_note_url } : {}),
            ...(d.parent_task_id !== undefined ? { parent_task_id: d.parent_task_id } : {}),
          })} where id = ${created}`
        }
        return created
      }),
    )
    if (!id) fail(400, 'We could not create the task.')
    await audit(c, { action: 'task.create', entityType: 'task', entityId: id, after: { title: d.title, project_id: d.project_id, assignees: d.assignees } })
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

  .patch('/:id', requireAction('tasks', 'edit'), async (c) => {
    const parsed = updateTaskRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the task details.')
    const { assignees, ...patch } = parsed.data
    if (Object.keys(patch).length === 0 && assignees === undefined) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const auth = c.get('auth')
    const found = await attempt(c, 'tasks.update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows =
          Object.keys(patch).length > 0
            ? await sql<{ id: string }[]>`update tasks set ${sql(patch)} where id = ${id} returning id`
            : await sql<{ id: string }[]>`select id from tasks where id = ${id}`
        if (!rows.length) return false
        if (assignees !== undefined) {
          await sql`delete from task_assignees where task_id = ${id}`
          for (const userId of assignees) {
            await sql`insert into task_assignees (task_id, user_id, company_id) values (${id}, ${userId}, ${auth.companyId})`
          }
        }
        return true
      }),
    )
    if (!found) fail(404, 'That task was not found.')
    await audit(c, { action: 'task.update', entityType: 'task', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/:id', requireAction('tasks', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'tasks.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`delete from tasks where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this task.')
    if (!rows.length) fail(404, 'That task was not found.')
    await audit(c, { action: 'task.delete', entityType: 'task', entityId: id })
    return c.body(null, 204)
  })

  // ── Task bundles ────────────────────────────────────────────
  // The checklists a studio repeats. These tables existed from Phase 5 but had
  // RLS on with no policy, so nothing could read them until 0031.
  .get('/bundles', requireAction('tasks', 'view'), async (c) => {
    const rows = await attempt(c, 'tasks.bundles', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select b.id, b.name,
                 coalesce(
                   jsonb_agg(
                     jsonb_build_object(
                       'id', i.id, 'title', i.title,
                       'priority', i.priority, 'sort_order', i.sort_order
                     ) order by i.sort_order, i.title
                   ) filter (where i.id is not null),
                   '[]'::jsonb
                 ) as items
          from task_bundles b
          left join task_bundle_items i on i.bundle_id = b.id
          group by b.id
          order by b.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load task bundles.')
    return c.json(taskBundle.array().parse(rows))
  })

  .post('/bundles', requireAction('tasks', 'create'), async (c) => {
    const parsed = createBundleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A bundle needs a name and at least one task.')
    const { name, items } = parsed.data
    const companyId = c.get('auth').companyId

    const id = await attempt(c, 'tasks.bundle_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [bundle] = await sql<{ id: string }[]>`
          insert into task_bundles (company_id, name) values (${companyId}, ${name}) returning id`
        if (!bundle) return null
        for (const [index, item] of items.entries()) {
          await sql`
            insert into task_bundle_items (bundle_id, company_id, title, priority, sort_order)
            values (${bundle.id}, ${companyId}, ${item.title}, ${item.priority}, ${index})`
        }
        return bundle.id
      }),
    )
    if (!id) fail(400, 'We could not create this bundle.')
    await audit(c, { action: 'task_bundle.create', entityType: 'task_bundle', entityId: id, after: { name, items: items.length } })
    return c.json({ id }, 201)
  })

  .patch('/bundles/:id', requireAction('tasks', 'edit'), async (c) => {
    const parsed = updateBundleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A bundle needs a name and at least one task.')
    const { name, items } = parsed.data
    const id = uuidParam(c)
    const companyId = c.get('auth').companyId
    const ok = await attempt(c, 'tasks.bundle_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`update task_bundles set name = ${name} where id = ${id} returning id`
        if (!rows.length) return false
        await sql`delete from task_bundle_items where bundle_id = ${id}`
        for (const [index, item] of items.entries()) {
          await sql`
            insert into task_bundle_items (bundle_id, company_id, title, priority, sort_order)
            values (${id}, ${companyId}, ${item.title}, ${item.priority}, ${index})`
        }
        return true
      }),
    )
    if (!ok) fail(404, 'We could not find that bundle.')
    await audit(c, { action: 'task_bundle.update', entityType: 'task_bundle', entityId: id, after: { name, items: items.length } })
    return c.body(null, 204)
  })

  .delete('/bundles/:id', requireAction('tasks', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'tasks.bundle_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from task_bundles where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not delete this bundle.')
    if (!rows.length) fail(404, 'We could not find that bundle.')
    await audit(c, { action: 'task_bundle.delete', entityType: 'task_bundle', entityId: id })
    return c.body(null, 204)
  })

  // Stamp the checklist out as real tasks.
  .post('/bundles/:id/apply', requireAction('tasks', 'create'), async (c) => {
    const parsed = applyBundleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project and assignees.')
    const d = parsed.data
    const id = uuidParam(c)

    const created = await attempt(c, 'tasks.bundle_apply', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ count: number }[]>`
          select apply_task_bundle(
            ${id}::uuid, ${d.project_id}, ${d.assignees}::uuid[]
          ) as count`
        return rows[0]?.count ?? null
      }),
    )
    if (created === null) fail(400, 'We could not apply this bundle.')
    await audit(c, { action: 'task_bundle.apply', entityType: 'task_bundle', entityId: id, after: { ...d, created } })
    return c.json({ created }, 201)
  })

  // Single task for the detail dialog. Registered last so the static GET
  // shapes above (/my, /board, /priorities, /bundles) keep matching first.
  // RLS scopes the read: assignees see their own, managers/admins the studio's.
  .get('/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'tasks.detail', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<RawTask[]>`
        select t.id, t.title, t.description, t.status, t.priority, t.due_date, t.project_id,
               p.name as project_name,
               cp.code as custom_priority_code, cp.label as custom_priority_label, cp.tone as custom_priority_tone,
               t.custom_status_code, cs.label as custom_status_label,
               t.deliverable_id, t.parent_task_id, t.voice_note_url,
               coalesce(
                 array_agg(u.name order by u.name) filter (where u.user_id is not null),
                 '{}'::text[]
               ) as assignee_names,
               coalesce(
                 array_agg(u.user_id order by u.name) filter (where u.user_id is not null),
                 '{}'::uuid[]
               ) as assignee_ids
        from tasks t
        left join projects p on p.id = t.project_id
        left join task_assignees a on a.task_id = t.id
        left join users u on u.user_id = a.user_id
        left join company_task_priorities cp on cp.company_id = t.company_id and cp.code = t.custom_priority_code
        left join company_deliverable_statuses cs on cs.company_id = t.company_id and cs.code = t.custom_status_code
        where t.id = ${id}
        group by t.id, p.name, cp.code, cp.label, cp.tone, cs.label`),
    )
    if (!rows) fail(400, 'We could not load this task.')
    if (!rows.length) fail(404, 'That task was not found.')
    return c.json(taskListItem.parse({ ...rows[0], sort_order: 0 }))
  })
