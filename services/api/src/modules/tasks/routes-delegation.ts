import { Hono } from 'hono'
import { blockTaskRequest, reviewTaskRequest, submitTaskRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { activityList, sayIt, submissionList, taskAccess } from './shared'

/** The delegation loop (0192): blocked, submitted, reviewed, and each task's history. */
export const delegationRoutes = new Hono<AppEnv>()
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
