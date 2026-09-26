import { Hono } from 'hono'
import {
  applyBundleRequest,
  blockTaskRequest,
  companyTaskPriority,
  reviewTaskRequest,
  submitTaskRequest,
  taskActivityItem,
  taskSubmissionItem,
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
  tag: string
  blocked_reason: string | null
  created_by: string | null
  created_by_name: string | null
  latest_submission: { id: string; link: string | null; status: string; submitted_at: string } | null
  updated_at: string | null
}

/**
 * A database check with a message meant for people (0192's "Say what is
 * blocking this task.", "This task is closed.") reaches them as it is,
 * instead of the generic "please check the details".
 */
const sayIt = (code: string, err: unknown): undefined => {
  if (code === '22023' && err instanceof Error && err.message) fail(422, err.message)
  return undefined
}

function toItems(rows: RawTask[], order: Map<string, number>) {
  return rows.map((r) => ({ ...r, sort_order: order.get(r.id) ?? 0 }))
}

// Flat select with the project name joined in (was PostgREST `projects(name)`).
// `assignee` narrows to tasks assigned to one person, for an admin previewing
// what a specific team member's board looks like. `project` narrows to one
// project, for its detail page's own Tasks tab. `deliverable` narrows to one
// deliverable (per-deliverable tasks UI). `id` is one task (the detail dialog).
// Each row carries who gave it and the newest work handed in against it, so a
// card can say "by AO" and "Submitted · Open submission" without a second trip.
interface TaskFilter {
  assignee?: string | undefined
  project?: string | undefined
  deliverable?: string | undefined
  id?: string | undefined
}
const selectTasks = (sql: TransactionSql, f: TaskFilter = {}) => sql<RawTask[]>`
  select t.id, t.title, t.description, t.status, t.priority, t.due_date, t.project_id,
         p.name as project_name,
         cp.code as custom_priority_code, cp.label as custom_priority_label, cp.tone as custom_priority_tone,
         t.custom_status_code, cs.label as custom_status_label,
         t.deliverable_id, t.parent_task_id, t.voice_note_url,
         t.tag, t.blocked_reason, t.created_by, t.updated_at,
         (select cu.name from users cu where cu.user_id = t.created_by) as created_by_name,
         (select json_build_object('id', s.id, 'link', s.submission_link, 'status', s.status, 'submitted_at', s.created_at)
            from team_work_submissions s
           where s.task_id = t.id
           order by s.created_at desc
           limit 1) as latest_submission,
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
  where ${f.assignee ? sql`exists (select 1 from task_assignees a2 where a2.task_id = t.id and a2.user_id = ${f.assignee})` : sql`true`}
    and ${f.project ? sql`t.project_id = ${f.project}` : sql`true`}
    and ${f.deliverable ? sql`t.deliverable_id = ${f.deliverable}` : sql`true`}
    and ${f.id ? sql`t.id = ${f.id}` : sql`true`}
  group by t.id, p.name, cp.code, cp.label, cp.tone, cs.label
  order by t.created_at desc`

/** The task as the caller may see it (RLS decides), with who is on it and who gave it. */
async function taskAccess(sql: TransactionSql, id: string) {
  const rows = await sql<{ status: string; created_by: string | null; project_id: string | null; deliverable_id: string | null; assignee_ids: string[] }[]>`
    select t.status, t.created_by, t.project_id, t.deliverable_id,
           coalesce(array(select a.user_id from task_assignees a where a.task_id = t.id), '{}'::uuid[]) as assignee_ids
      from tasks t where t.id = ${id}`
  return rows[0] ?? null
}

const activityList = taskActivityItem.array()
const submissionList = taskSubmissionItem.array()

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
    const rows = await attempt(c, 'tasks.my', () => withUser(c.env, me, (sql) => selectTasks(sql, { assignee: me, project })))
    if (!rows) fail(400, 'We could not load your tasks.')
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
           and t.due_date < coalesce(${today}::date, current_date)`),
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
    const rows = await attempt(c, 'tasks.list', () => withUser(c.env, c.get('auth').userId, (sql) => selectTasks(sql, { assignee, project, deliverable })))
    if (!rows) fail(400, 'We could not load tasks.')
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

  // ── The delegation loop (0192) ──────────────────────────────
  // Stuck: the person on the task (or a manager) says why.
  .post('/:id/block', async (c) => {
    const parsed = blockTaskRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Say what is blocking this task.')
    const id = uuidParam(c)
    const auth = c.get('auth')
    const reason = parsed.data.reason
    const ok = await attempt(
      c,
      'tasks.block',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const t = await taskAccess(sql, id)
          if (!t) return 'missing' as const
          if (t.assignee_ids.includes(auth.userId)) {
            await sql`select update_my_task_status(p_task_id => ${id}, p_status => 'blocked', p_reason => ${reason})`
            return true
          }
          if (!auth.access.hasAction('tasks', 'edit')) return 'denied' as const
          const rows = await sql`
            update tasks set status = 'blocked', blocked_reason = ${reason} where id = ${id} returning id`
          return rows.length > 0
        }),
      { onCode: sayIt },
    )
    if (ok === 'missing') fail(404, 'That task was not found.')
    if (ok === 'denied') fail(403, 'Only the person on this task, or a manager, can mark it blocked.')
    if (!ok) fail(400, 'We could not update the task.')
    await audit(c, { action: 'task.block', entityType: 'task', entityId: id, after: { reason } })
    return c.body(null, 204)
  })

  // Hand in the work: a link (and a note). The task goes to Review and the
  // person who gave it is told (triggers, 0192).
  .post('/:id/submit', async (c) => {
    const parsed = submitTaskRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Paste a link to your work.')
    const id = uuidParam(c)
    const auth = c.get('auth')
    const d = parsed.data
    const row = await attempt(c, 'tasks.submit', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const t = await taskAccess(sql, id)
        if (!t) return 'missing' as const
        if (!t.assignee_ids.includes(auth.userId)) return 'denied' as const
        if (t.status === 'completed' || t.status === 'cancelled') return 'closed' as const
        const rows = await sql<{ id: string }[]>`
          insert into team_work_submissions ${sql({
            company_id: auth.companyId,
            task_id: id,
            project_id: t.project_id,
            deliverable_id: t.deliverable_id,
            submitted_by: auth.userId,
            submission_link: d.link,
            notes: d.note ?? null,
          })} returning id`
        return rows[0] ?? null
      }),
    )
    if (row === 'missing') fail(404, 'That task was not found.')
    if (row === 'denied') fail(403, 'Only the person on this task can submit work for it.')
    if (row === 'closed') fail(409, 'This task is already closed.')
    if (!row) fail(400, 'We could not submit your work.')
    await audit(c, { action: 'task.submit', entityType: 'task', entityId: id, after: { submission_id: row.id, link: d.link } })
    return c.json({ id: row.id }, 201)
  })

  // Approve, or send back with a note. The person who gave the task or a
  // manager; review_task() checks which.
  .post('/:id/review', async (c) => {
    const parsed = reviewTaskRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Invalid review.')
    const id = uuidParam(c)
    const d = parsed.data
    const ok = await attempt(
      c,
      'tasks.review',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select review_task(p_task_id => ${id}, p_approve => ${d.approve}, p_note => ${d.note ?? null})`
          return true
        }),
      {
        onCode: (code, err) => {
          if (code === '42501') fail(403, 'Only the person who gave this task, or a manager, can review it.')
          return sayIt(code, err)
        },
      },
    )
    if (!ok) fail(400, 'We could not record the review.')
    await audit(c, { action: d.approve ? 'task.approve' : 'task.send_back', entityType: 'task', entityId: id, after: d })
    return c.body(null, 204)
  })

  // What happened to a task, newest first. RLS: whoever can see the task.
  .get('/:id/activity', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'tasks.activity', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select a.id, a.user_id, u.name as user_name, a.action, a.created_at
          from task_activity a
          left join users u on u.user_id = a.user_id
         where a.task_id = ${id}
         order by a.created_at desc, a.id
         limit 100`),
    )
    if (!rows) fail(400, 'We could not load the history.')
    return c.json(activityList.parse(rows))
  })

  // Work handed in against a task, newest first.
  .get('/:id/submissions', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'tasks.submissions', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select s.id, s.submission_link as link, s.notes as note, s.status, s.review_notes,
               s.submitted_by, u.name as submitted_by_name, s.created_at
          from team_work_submissions s
          left join users u on u.user_id = s.submitted_by
         where s.task_id = ${id}
         order by s.created_at desc
         limit 50`),
    )
    if (!rows) fail(400, 'We could not load the submissions.')
    return c.json(submissionList.parse(rows))
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
      withUser(c.env, c.get('auth').userId, (sql) => selectTasks(sql, { id })),
    )
    if (!rows) fail(400, 'We could not load this task.')
    if (!rows.length) fail(404, 'That task was not found.')
    return c.json(taskListItem.parse({ ...rows[0], sort_order: 0 }))
  })
