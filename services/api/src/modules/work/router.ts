import { Hono } from 'hono'
import { z } from '@ipc/contracts'
import {
  reviewWorkRequest,
  submitWorkRequest,
  updateWorkSubmissionRequest,
  workReminderSettings,
  updateWorkReminderSettingsRequest,
  workSubmission,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam, uuidQuery } from '../../lib/params'
import { withUser, withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { rpcJson } from '../../lib/rpc'

const list = workSubmission.array()
// Every other issuer (quotation, receipt, terms) hands back a ready link
// built from APP_URL; this one returned a bare token, so the only caller
// would have had to know the public route's shape to use it. `token` stays
// for anything already reading it.
const deliverResponse = z.object({ token: z.string(), link: z.string() })

export const workRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Any active member sees their own submissions. Everyone's is for someone
  // who reviews work (team_work_preview) or runs projects -- decided here, not
  // left to RLS alone, which goes by users.role and so let a "manager" with a
  // photographer's access read the whole studio's work. ?mine=1 asks for only
  // one's own even when allowed more (My Work). `user_id` narrows to one person.
  .get('/submissions', async (c) => {
    const access = c.get('auth').access
    const seesAll = access.hasAction('team_work_preview', 'view') || access.hasAction('projects', 'edit')
    const onlyMine = !seesAll || c.req.query('mine') === '1'
    const me = c.get('auth').userId
    const userId = onlyMine ? me : c.req.query('user_id')
    const uc = userId ? z.string().uuid().safeParse(userId) : null
    if (userId && !uc?.success) fail(422, 'Invalid user id.')
    const project = uuidQuery(c, 'project_id')
    const rows = await attempt(c, 'work.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) =>
          sql`select id, project_id, task_id, title, work_type, method, storage_ref,
                      hard_disk_label, review_required, review_state, version,
                      client_sent_at, client_channel, revoked_at,
                      submission_link, location_note, notes, status, review_notes, created_at,
                      disk_name, disk_location, folder_path, deliverable_id,
                      (select d.title from deliverables d where d.id = team_work_submissions.deliverable_id) as deliverable_title,
                      (select u.name from users u where u.user_id = team_work_submissions.submitted_by) as submitted_by_name
              from team_work_submissions
              where ${userId ? sql`submitted_by = ${userId}` : sql`true`}
                and ${project ? sql`project_id = ${project}` : sql`true`}
              order by created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load submissions.')
    return c.json(list.parse(rows))
  })

  .post('/submissions', async (c) => {
    const parsed = submitWorkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please add a link to your work.')
    const id = await attempt(
      c,
      'work.submit',
      () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        // submit_work RPC predates handover columns; insert directly so disk fields persist.
        const rows = await sql<{ id: string }[]>`
          insert into team_work_submissions ${sql({
            company_id: c.get('auth').companyId,
            task_id: parsed.data.task_id,
            project_id: parsed.data.project_id,
            deliverable_id: parsed.data.deliverable_id,
            submitted_by: c.get('auth').userId,
            title: parsed.data.title ?? null,
            work_type: parsed.data.work_type ?? null,
            method: parsed.data.method ?? null,
            storage_ref: parsed.data.storage_ref ?? null,
            hard_disk_label: parsed.data.hard_disk_label ?? parsed.data.disk_name ?? null,
            review_required: parsed.data.review_required ?? true,
            submission_link: parsed.data.submission_link,
            location_note: parsed.data.location_note ?? null,
            notes: parsed.data.notes ?? null,
            disk_name: parsed.data.disk_name ?? null,
            disk_location: parsed.data.disk_location ?? null,
            folder_path: parsed.data.folder_path ?? null,
          })} returning id`
        return rows[0]?.id ?? null
      }),
      {
        // The deliverable must be this studio's and from the same project (0166).
        onCode: (code) =>
          code === '42501' || code === '23514' ? fail(422, 'That deliverable is not part of this project.') : undefined,
      },
    )
    if (!id) fail(400, 'We could not submit your work.')
    await audit(c, { action: 'work.submit', entityType: 'work_submission', entityId: id, after: { task_id: parsed.data.task_id, project_id: parsed.data.project_id, deliverable_id: parsed.data.deliverable_id } })
    return c.json({ id }, 201)
  })

  // The RPC itself checks the caller is the submitter (or an admin/manager)
  // and refuses once the submission has been reviewed.
  .patch('/submissions/:id', async (c) => {
    const parsed = updateWorkSubmissionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please add a link to your work.')
    const id = uuidParam(c)
    const ok = await attempt(
      c,
      'work.update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          // Direct update keeps handover fields (disk/folder) alongside link/notes.
          const rows = await sql<{ id: string }[]>`
            update team_work_submissions set ${sql(parsed.data)} where id = ${id} returning id`
          return (rows as unknown[]).length > 0
        }),
      { onCode: (code) => (code === '23514' ? 'reviewed' : undefined) },
    )
    if (ok === 'reviewed') fail(409, 'This submission has already been reviewed and can no longer be edited.')
    if (!ok) fail(400, 'We could not update this submission.')
    await audit(c, { action: 'work.update', entityType: 'work_submission', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .post('/submissions/:id/review', requireAction('team_work_preview', 'edit'), async (c) => {
    const parsed = reviewWorkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid review.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'work.review', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`
          select review_work(
            p_submission_id => ${id},
            p_approve => ${parsed.data.approve},
            p_review_notes => ${parsed.data.review_notes ?? null}
          )`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not record the review.')
    await audit(c, { action: parsed.data.approve ? 'work.approve' : 'work.reject', entityType: 'work_submission', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .post('/submissions/:id/deliver', requireAction('team_work_preview', 'edit'), async (c) => {
    const id = uuidParam(c)
    const body = await c.req.json().catch(() => ({})) as { ttl_days?: unknown; channel?: unknown }
    // Lovable parity: TTL configurable (default 365d), channel logged to client_deliveries.
    const ttlDays = typeof body.ttl_days === 'number' && Number.isFinite(body.ttl_days)
      ? Math.min(Math.max(Math.trunc(body.ttl_days), 1), 3650)
      : 365
    const channel = typeof body.channel === 'string' && body.channel.trim() ? body.channel.trim().slice(0, 40) : 'email'
    const token = await attempt(c, 'work.deliver', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ token: string | null }[]>`
          select deliver_work_to_client(
            p_submission_id => ${id},
            p_channel => ${channel},
            p_ttl_hours => ${ttlDays * 24}
          ) as token`
        return rows[0]?.token ?? null
      }),
    )
    if (!token) fail(400, 'The submission must be submitted or approved before delivery.')
    await audit(c, { action: 'work.deliver', entityType: 'work_submission', entityId: id })
    return c.json(deliverResponse.parse({ token, link: `${c.env.APP_URL}/delivery?token=${token}` }))
  })

  // Revoke a delivery link: the client's link stops opening, and the studio
  // can see that it has.
  //
  // This used to run the three statements inline and return `true` whatever
  // happened. The submission's UPDATE matched no row every single time —
  // tws_update is scoped to `status = 'submitted'` and work is only ever sent
  // once approved — and RLS filters an UPDATE rather than refusing it, so
  // nothing failed and nothing was marked. 0144 does all three behind one
  // permission check and says whether it found the row.
  .post('/submissions/:id/revoke-delivery', requireAction('team_work_preview', 'edit'), async (c) => {
    const id = uuidParam(c)
    const ok = await attempt(c, 'work.revoke_delivery', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ revoke_work_delivery: boolean }[]>`
          select revoke_work_delivery(${id}) as revoke_work_delivery`
        return rows[0]?.revoke_work_delivery ?? false
      }),
    )
    if (!ok) fail(404, 'We could not find that delivery to revoke.')
    await audit(c, { action: 'work.delivery_revoke', entityType: 'work_submission', entityId: id })
    return c.json({ ok: true })
  })

  // Stamp which channel a submission went out on (email/whatsapp/log).
  // Surfaced in the preview as "sent to client".
  .post('/submissions/:id/client-sent', requireAction('team_work_preview', 'edit'), async (c) => {
    const id = uuidParam(c)
    const body = await c.req.json().catch(() => ({})) as { channel?: unknown }
    const channel = typeof body.channel === 'string' && body.channel.trim()
      ? body.channel.trim().slice(0, 40)
      : 'email'
    const ok = await attempt(c, 'work.client_sent', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          update team_work_submissions set client_sent_at = now(), client_channel = ${channel},
            review_state = 'sent'
          where id = ${id} returning id`
        return rows.length > 0
      }),
    )
    if (!ok) fail(404, 'We could not find that submission.')
    await audit(c, { action: 'work.client_sent', entityType: 'work_submission', entityId: id, after: { channel } })
    return c.json({ ok: true })
  })

  // Run the work-submission reminder sweep now (same sweep cron runs hourly).
  .post('/reminders/run', requireOwner(), async (c) => {
    const summary = await attempt(c, 'work.reminders_run', () =>
      withService(c.env, async (sql) => {
        const rows = await sql<{ summary: unknown }[]>`
          select run_work_submission_reminder_cron(p_dry_run => false) as summary`
        return (rows[0]?.summary ?? {}) as Record<string, unknown>
      }),
    )
    if (!summary) fail(400, 'The reminder run could not start.')
    await audit(c, { action: 'work.reminders_run', entityType: 'company', entityId: c.get('auth').companyId })
    return c.json({ ok: true, summary })
  })

/**
 * Owner-only: when a team member is nudged to submit pending work, and how
 * many days before the task's due date. Read by anyone active; only the
 * owner can change it, matching crm_settings' shape.
 */
export const workReminderSettingsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const row = await attempt(c, 'work.reminder_settings.get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ get_work_submission_reminder_settings: unknown }[]>`
          select get_work_submission_reminder_settings() as get_work_submission_reminder_settings`
        return rows[0]?.get_work_submission_reminder_settings ?? null
      }),
    )
    if (!row) fail(400, 'We could not load reminder settings.')
    return c.json(workReminderSettings.parse(rpcJson(row, {})))
  })

  .patch('/', requireOwner(), async (c) => {
    const parsed = updateWorkReminderSettingsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the reminder settings.')
    const ok = await attempt(c, 'work.reminder_settings.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select set_work_submission_reminder_settings(
          p_enabled => ${parsed.data.enabled}, p_reminder_days => ${parsed.data.reminder_days}::int[])`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not save reminder settings.')
    await audit(c, { action: 'work_reminder_settings.update', entityType: 'company', entityId: c.get('auth').companyId, after: parsed.data })
    return c.body(null, 204)
  })
