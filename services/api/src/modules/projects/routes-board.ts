import { Hono } from 'hono'
import { productionBoard, bulkDeliverableRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { requireStudioWork } from '../../lib/scope'
import { deliverableRuleBroken } from './shared'

export const productionBoardRoutes = new Hono<AppEnv>()
  // Board deliverables: every deliverable with project context (for the production board).
  // Declared before /:id so "board" is never read as a project id.
  /**
   * The production board: every deliverable in flight across the studio, the
   * stages it moves through, and the people who carry it. Open work plus what
   * was delivered in the last fortnight; the counts cover all open work even
   * when the list is capped.
   */
  .get('/board', requireAction('projects', 'view'), requireStudioWork, async (c) => {
    const data = await attempt(c, 'projects.board', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const stages = await sql`
          select id, code, label, stage, color, team_allowed, sort_order
            from company_deliverable_statuses
           where stage is not null and scope in ('deliverable', 'both')
           order by array_position(array['pending','in_progress','review','completed'], stage), sort_order, label`
        const items = await sql`
          select d.id, d.project_id, p.name as project_name, cl.name as client_name,
                 d.title, d.description, d.status, d.custom_status_code, d.estimated_date,
                 d.delivered_at, d.started_at, d.delivery_link, d.visibility_scope,
                 d.shoot_id, s.name as shoot_name, s.shoot_date,
                 d.assignee_id, u.name as assignee_name,
                 (select count(*)::int from deliverable_notes n where n.deliverable_id = d.id and n.kind <> 'event') as notes_count,
                 (select count(*)::int from deliverable_notes n where n.deliverable_id = d.id and n.kind = 'voice') as voice_count,
                 la.created_at as last_activity_at, la.author_name as last_activity_by,
                 la.kind as last_activity_kind, la.body as last_activity_body
            from deliverables d
            join projects p on p.id = d.project_id
            left join clients cl on cl.id = p.client_id
            left join shoots s on s.id = d.shoot_id
            left join users u on u.user_id = d.assignee_id
            left join lateral (
              select n.created_at, n.kind, n.body, a.name as author_name
                from deliverable_notes n left join users a on a.user_id = n.author_id
               where n.deliverable_id = d.id
               order by n.created_at desc limit 1
            ) la on true
           where p.status <> 'cancelled'
             and (d.status not in ('cancelled', 'completed')
                  -- Delivered in the last fortnight: years of history must
                  -- not crowd today's work out of the limit.
                  or (d.status = 'completed' and d.delivered_at > now() - interval '14 days'))
           order by (d.status = 'completed'), d.estimated_date nulls last, d.created_at
           limit 1000`
        const counts = await sql<{ open: number; late: number; due_today: number; in_review: number; unassigned: number; dropped: number }[]>`
          select count(*) filter (where d.status not in ('completed', 'cancelled'))::int as open,
                 count(*) filter (where d.status not in ('completed', 'cancelled') and d.estimated_date < current_date)::int as late,
                 count(*) filter (where d.status not in ('completed', 'cancelled') and d.estimated_date = current_date)::int as due_today,
                 count(*) filter (where d.status = 'review')::int as in_review,
                 count(*) filter (where d.status not in ('completed', 'cancelled') and d.assignee_id is null)::int as unassigned,
                 count(*) filter (where d.status = 'cancelled' and d.updated_at > now() - interval '14 days')::int as dropped
            from deliverables d
            join projects p on p.id = d.project_id
           where p.status <> 'cancelled'`
        const people = await sql`
          select u.user_id, u.name, u.role,
                 exists (
                   select 1 from team_assignment_slots t
                    where t.user_id = u.user_id and t.status = 'booked'
                      and t.start_at < (current_date + 1)::timestamptz and t.end_at > current_date::timestamptz
                 ) as on_shoot_today,
                 (select count(*)::int from task_assignees ta join tasks tk on tk.id = ta.task_id
                   where ta.user_id = u.user_id and tk.status in ('to_do', 'in_progress')) as open_tasks
            from users u
           where u.deleted_at is null and u.status = 'active' and u.role <> 'super_admin'
           order by u.name`
        const c0 = counts[0]!
        const openListed = items.filter((i) => i.status !== 'completed').length
        return { stages, items, people, counts: { ...c0, truncated: openListed < c0.open } }
      }),
    )
    if (!data) fail(400, 'We could not load the production board.')
    return c.json(productionBoard.parse(data))
  })

  /**
   * One change to many deliverables: hand them to an editor, move them to a
   * stage, or give them a due date. The same rules as one at a time -- the
   * database checks each row as it is written.
   */
  .post('/deliverables/bulk', requireAction('projects', 'edit'), async (c) => {
    const parsed = bulkDeliverableRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check what to change.')
    const { ids, assignee_id, stage, estimated_date } = parsed.data
    const outcome = await attempt(
      c,
      'projects.deliverables_bulk',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          let patch: Record<string, unknown>
          if (stage) {
            const code = stage.custom_status_code || null
            if (code) {
              const st = await sql<{ stage: string | null }[]>`
                select stage from company_deliverable_statuses where code = ${code}`
              if (!st[0] || st[0].stage !== stage.status) return 'bad_stage' as const
            }
            patch = { status: stage.status, custom_status_code: code }
          } else if (assignee_id !== undefined) {
            patch = { assignee_id }
          } else {
            patch = { estimated_date: estimated_date ?? null }
          }
          const rows = await sql<{ id: string }[]>`
            update deliverables set ${sql(patch)} where id = any(${ids}::uuid[]) returning id`
          return rows.length
        }),
      { onCode: deliverableRuleBroken },
    )
    if (outcome === 'bad_stage') fail(422, 'That stage does not belong to this step. Pick one from the list.')
    if (outcome === null || outcome === undefined) fail(400, 'We could not update the deliverables.')
    await audit(c, { action: 'deliverable.bulk', entityType: 'deliverable', entityId: ids[0]!, after: parsed.data })
    return c.json({ updated: outcome })
  })
