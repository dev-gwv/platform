import { Hono } from 'hono'
import {
  setDeliverableStageRequest,
  myDeliverable,
  deliverableWorkload,
  deliverableNote,
  createDeliverableNoteRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { selectMyDeliverables } from '../../lib/my-work'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { studioWork } from '../../lib/scope'

export const deliverableRoutes = new Hono<AppEnv>()
  // How much each person already has, for "Who will edit it?": open edits,
  // how many are late, due this week, and the next due date.
  .get('/deliverables/workload', requireAction('projects', 'edit'), async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'projects.deliverables_workload', () =>
      withUser(c.env, auth.userId, (sql) => sql`
        with t as (select (now() at time zone 'Asia/Kolkata')::date as today)
        select d.assignee_id as user_id,
               count(*)::int as open,
               count(*) filter (where d.estimated_date < t.today)::int as late,
               count(*) filter (where d.estimated_date between t.today and t.today + 6)::int as due_week,
               min(d.estimated_date) filter (where d.estimated_date >= t.today) as next_due
          from deliverables d, t
         where d.company_id = ${auth.companyId}
           and d.assignee_id is not null
           and d.status not in ('completed', 'cancelled')
         group by d.assignee_id`),
    )
    if (!rows) fail(400, 'We could not load who is busy.')
    return c.json(deliverableWorkload.array().parse(rows))
  })

  /**
   * What the caller is editing: every open deliverable they are the editor on,
   * soonest due first. Any member -- an editor need not see whole projects to
   * see their own work. Each says whether it was sent back, what the reviewer
   * said and the last version handed in (0180), so a revision is one tap.
   */

  .get('/deliverables/mine', async (c) => {
    const auth = c.get('auth')
    // ?done=14 also brings what was delivered in the last 14 days.
    const done = Math.max(0, Math.min(Number(c.req.query('done') ?? 0) || 0, 60))
    // ?user= is "See what Nitin sees": someone else's list, for whoever may
    // preview the team's work. Always inside the caller's own studio.
    const other = c.req.query('user')
    let userId = auth.userId
    if (other && other !== auth.userId) {
      if (!/^[0-9a-f-]{36}$/i.test(other)) fail(422, 'That is not a team member.')
      if (!auth.isOwner && !auth.access.hasModule('team_work_preview')) fail(403, 'You cannot preview other people’s work.')
      userId = other
    }
    // A service read, scoped here to one person's edits in the caller's studio:
    // row security would hide the shooters' data records, and whether the
    // data is in -- and where -- is the point.
    const rows = await attempt(c, 'projects.deliverables_mine', () =>
      withService(c.env, (sql) => selectMyDeliverables(sql, { companyId: auth.companyId, userId, done })),
    )
    if (!rows) fail(400, 'We could not load your deliverables.')
    return c.json(myDeliverable.array().parse(rows))
  })

  // The editor on it says "I've started" -- which stops the start reminders.
  .post('/deliverables/:did/start', async (c) => {
    const id = uuidParam(c, 'did')
    const ok = await attempt(
      c,
      'projects.deliverables_start',
      () => withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select start_deliverable(${id})`
        return true
      }),
      { onCode: (code) => (code === 'P0002' ? fail(404, 'That deliverable was not found.') : undefined) },
    )
    if (!ok) fail(400, 'We could not start that.')
    await audit(c, { action: 'deliverable.start', entityType: 'deliverable', entityId: id })
    return c.body(null, 204)
  })

  /**
   * Move a deliverable to a stage, with the link that was sent. The editor on
   * it may do this as well as anyone who can edit projects.
   */
  .post('/deliverables/:did/stage', async (c) => {
    const parsed = setDeliverableStageRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please pick a stage.')
    const did = uuidParam(c, 'did')
    const auth = c.get('auth')
    const canEdit = auth.access.hasAction('projects', 'edit')
    const outcome = await attempt(c, 'projects.deliverable_stage', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const found = await sql<{ project_id: string; assignee_id: string | null }[]>`
          select project_id, assignee_id from deliverables where id = ${did}`
        const d = found[0]
        if (!d) return 'missing' as const
        if (!canEdit && d.assignee_id !== auth.userId) return 'forbidden' as const
        const code = parsed.data.custom_status_code || null
        if (code) {
          const st = await sql<{ stage: string | null; team_allowed: boolean }[]>`
            select stage, team_allowed from company_deliverable_statuses where code = ${code}`
          if (!st[0] || st[0].stage !== parsed.data.status) return 'bad_stage' as const
          // The editor picks from the stages the studio lets the team use;
          // "Approved" and the like are for whoever reviews.
          if (!canEdit && !st[0].team_allowed) return 'not_team' as const
        }
        const patch: Record<string, unknown> = { status: parsed.data.status, custom_status_code: code }
        if (parsed.data.delivery_link !== undefined) patch.delivery_link = parsed.data.delivery_link || null
        await sql`update deliverables set ${sql(patch)} where id = ${did}`
        return d.project_id
      }),
    )
    if (outcome === 'missing') fail(404, 'That deliverable was not found.')
    if (outcome === 'forbidden') fail(403, 'Only the editor on it, or a manager, can move this.')
    if (outcome === 'bad_stage') fail(422, 'That stage does not belong to this step. Pick one from the list.')
    if (outcome === 'not_team') fail(403, 'A manager moves it to that stage.')
    if (!outcome) fail(400, 'We could not update the deliverable.')
    await audit(c, {
      action: 'deliverable.stage',
      entityType: 'project',
      entityId: outcome,
      after: { deliverable_id: did, ...parsed.data },
    })
    return c.body(null, 204)
  })

  /**
   * A deliverable's timeline: notes, voice notes and stage changes, oldest
   * first, read like a conversation. Anyone in the studio who can see the
   * deliverable can read it; RLS keeps it to the studio.
   */
  .get('/deliverables/:did/notes', async (c) => {
    const did = uuidParam(c, 'did')
    // Staff read the notes on their own edits only.
    const me = c.get('auth').userId
    const anyOne = studioWork(c)
    const rows = await attempt(c, 'projects.deliverable_notes', () =>
      withUser(c.env, me, async (sql) => {
        const found = await sql`
          select 1 from deliverables where id = ${did} and ${anyOne ? sql`true` : sql`assignee_id = ${me}`}`
        if (!found.length) return null
        return sql`
          select n.id, n.deliverable_id, n.kind, n.body, n.file_id, n.duration_seconds,
                 n.author_id, u.name as author_name, n.created_at, w.submission_link as link
            from deliverable_notes n
            left join users u on u.user_id = n.author_id
            -- submitted:<id>, approved:<id>, sent_back:<id>: the work's link.
            left join team_work_submissions w
              on n.kind = 'event'
             and n.body ~ '^(submitted|resubmitted|approved|sent_back|sent_to_client):[0-9a-f-]{36}$'
             and w.id = split_part(n.body, ':', 2)::uuid
           where n.deliverable_id = ${did}
           order by n.created_at, n.id`
      }),
    )
    if (rows === null) fail(404, 'That deliverable was not found.')
    if (!rows) fail(400, 'We could not load the notes.')
    return c.json(deliverableNote.array().parse(rows))
  })

  /**
   * Leave a written or voice note. Same rule as moving the stage: the editor
   * on it, or anyone who can edit projects. The database tells the other side.
   */
  .post('/deliverables/:did/notes', async (c) => {
    const parsed = createDeliverableNoteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the note.')
    const did = uuidParam(c, 'did')
    const auth = c.get('auth')
    const canEdit = auth.access.hasAction('projects', 'edit')
    const n = parsed.data
    const outcome = await attempt(
      c,
      'projects.deliverable_note_add',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const found = await sql<{ assignee_id: string | null }[]>`
            select assignee_id from deliverables where id = ${did}`
          const d = found[0]
          if (!d) return 'missing' as const
          if (!canEdit && d.assignee_id !== auth.userId) return 'forbidden' as const
          const rows = await sql`
            insert into deliverable_notes (deliverable_id, kind, body, file_id, duration_seconds, author_id)
            values (${did}, ${n.kind}, ${n.body ?? null},
                    ${n.kind === 'voice' ? n.file_id : null},
                    ${n.kind === 'voice' ? (n.duration_seconds ?? null) : null}, ${auth.userId})
            returning id, deliverable_id, kind, body, file_id, duration_seconds, author_id, created_at`
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '42501' ? fail(403, 'That recording is not one of this studio’s files.') : undefined) },
    )
    if (outcome === 'missing') fail(404, 'That deliverable was not found.')
    if (outcome === 'forbidden') fail(403, 'Only the editor on it, or a manager, can leave notes here.')
    if (!outcome) fail(400, 'We could not save the note.')
    await audit(c, { action: `deliverable.note.${n.kind}`, entityType: 'deliverable', entityId: did })
    return c.json(deliverableNote.parse({ ...outcome, author_name: null }), 201)
  })

  /** Take a note back: its author, or an admin or manager. Stage events stay. */
  .delete('/deliverables/notes/:nid', async (c) => {
    const nid = uuidParam(c, 'nid')
    const rows = await attempt(c, 'projects.deliverable_note_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`delete from deliverable_notes where id = ${nid} returning id`),
    )
    if (!rows) fail(400, 'We could not delete the note.')
    if (!rows.length) fail(404, 'That note was not found, or it is not yours to delete.')
    return c.body(null, 204)
  })
