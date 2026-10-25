import { Hono } from 'hono'
import {
  myDueItem,
  myFollowUp,
  myFollowUpMoveRequest,
  myLead,
  myLeadDetail,
  myLeadFollowUpRequest,
  myLeadNoteRequest,
  myPayouts,
  myProject,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import type { TransactionSql } from 'postgres'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { selectMyDeliverables } from '../../lib/my-work'
import { studioWork, worksOn } from '../../lib/scope'
import { todayInIndia } from '../../lib/dates'
import { summarizeCrewOwed } from '@ipc/domain'

/**
 * A person's own things that live in other people's areas -- today, the CRM
 * follow-ups given to them. Staff without the CRM still get calls to make
 * ("Call Mehta at 4 PM"), and had no way to see them. Read and closed here,
 * scoped to the caller and their studio, without opening the CRM to them.
 *
 * Whose a follow-up is: the person it was given to, else the lead's owner
 * (as the morning email reads it), else whoever wrote it.
 */
/** One of my leads, as the My leads page lists it (0282). */
const selectMyLead = (sql: TransactionSql, detail = false) => sql`
  select l.id, l.name, l.phone, l.email, l.status, s.name as stage_name, s.color as stage_color, l.quality,
         l.event_type, l.event_date, l.city,
         (select pt.name from enquiry_partners pt where pt.id = l.partner_id) as partner_name,
         l.enquiry_occasion, l.follow_up_at,
         (select a.subject from crm_activities a
           where a.lead_id = l.id and a.type = 'task' and a.done_at is null and a.due_at is not null
           order by a.due_at limit 1) as next_subject,
         n.body as last_note, n.created_at as last_note_at, l.created_at
         ${detail ? sql`, l.enquiry_answers, l.notes` : sql``}
    from crm_leads l
    left join crm_pipeline_stages s on s.id = l.stage_id
    left join lateral (
      select a.body, a.created_at from crm_activities a
       where a.lead_id = l.id and a.type in ('note', 'call') and a.body is not null
       order by a.created_at desc limit 1
    ) n on true`

export const meRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/follow-ups', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'me.follow_ups', () =>
      withService(c.env, (sql) => sql`
        select a.id, a.lead_id, l.name as lead_name, l.phone as lead_phone,
               a.subject, a.due_at, a.priority
          from crm_activities a
          join crm_leads l on l.id = a.lead_id
         where a.company_id = ${auth.companyId}
           and a.type = 'task' and a.done_at is null and a.due_at is not null
           and coalesce(a.assigned_to, l.assigned_to, a.actor_id) = ${auth.userId}
           and a.due_at < now() + interval '8 days'
           and coalesce(l.is_archived, false) = false
         order by a.due_at
         limit 50`),
    )
    if (!rows) fail(400, 'We could not load your follow-ups.')
    return c.json(myFollowUp.array().parse(rows))
  })

  .post('/follow-ups/:id/done', async (c) => {
    const auth = c.get('auth')
    const id = uuidParam(c)
    const rows = await attempt(c, 'me.follow_up_done', () =>
      withService(c.env, (sql) => sql<{ id: string }[]>`
        update crm_activities a
           set done_at = now()
          from crm_leads l
         where a.id = ${id} and l.id = a.lead_id
           and a.company_id = ${auth.companyId}
           and a.type = 'task' and a.done_at is null
           and coalesce(a.assigned_to, l.assigned_to, a.actor_id) = ${auth.userId}
        returning a.id`),
    )
    if (!rows) fail(400, 'We could not mark that done.')
    if (!rows.length) fail(404, 'That follow-up is not yours, or it is already done.')
    await audit(c, { action: 'activity.update', entityType: 'crm_activity', entityId: id, after: { done: true } })
    return c.json({ ok: true })
  })

  // A follow-up moved to another time from Home or My leads (Tomorrow).
  .patch('/follow-ups/:id', async (c) => {
    const auth = c.get('auth')
    const id = uuidParam(c)
    const parsed = myFollowUpMoveRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a time.')
    const rows = await attempt(c, 'me.follow_up_move', () =>
      withService(c.env, (sql) => sql<{ id: string }[]>`
        update crm_activities a
           set due_at = ${parsed.data.due_at}
          from crm_leads l
         where a.id = ${id} and l.id = a.lead_id
           and a.company_id = ${auth.companyId}
           and a.type = 'task' and a.done_at is null
           and coalesce(a.assigned_to, l.assigned_to, a.actor_id) = ${auth.userId}
        returning a.id`),
    )
    if (!rows) fail(400, 'We could not move that.')
    if (!rows.length) fail(404, 'That follow-up is not yours, or it is already done.')
    await audit(c, { action: 'activity.update', entityType: 'crm_activity', entityId: id, after: { due_at: parsed.data.due_at } })
    return c.json({ ok: true })
  })

  // The leads given to me (0282): a team member's own list, without the CRM.
  // Only leads whose owner is the caller; archived ones stay out.
  .get('/leads', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'me.leads', () =>
      withService(c.env, (sql) => sql`
        ${selectMyLead(sql)}
         where l.company_id = ${auth.companyId} and l.assigned_to = ${auth.userId}
           and coalesce(l.is_archived, false) = false and l.merged_into is null
         order by (l.status = 'lost' or l.converted_at is not null), l.follow_up_at asc nulls last, l.created_at desc
         limit 500`),
    )
    if (!rows) fail(400, 'We could not load your leads.')
    return c.json(myLead.array().parse(rows))
  })

  .get('/leads/:id', async (c) => {
    const auth = c.get('auth')
    const id = uuidParam(c)
    const out = await attempt(c, 'me.lead', () =>
      withService(c.env, async (sql) => {
        const [lead] = await sql`
          ${selectMyLead(sql, true)}
           where l.id = ${id} and l.company_id = ${auth.companyId} and l.assigned_to = ${auth.userId}`
        if (!lead) return null
        const activities = await sql`
          select a.id, a.type, a.subject, a.body, a.outcome, a.due_at, a.done_at, u.name as actor_name, a.created_at
            from crm_activities a
            left join users u on u.user_id = a.actor_id
           where a.lead_id = ${id} and a.type in ('task', 'note', 'call', 'whatsapp', 'email', 'meeting', 'sms')
           order by coalesce(a.done_at, a.created_at) desc
           limit 40`
        return { ...lead, activities }
      }),
    )
    if (out === null) fail(404, 'That lead is not given to you.')
    if (!out) fail(400, 'We could not load this lead.')
    return c.json(myLeadDetail.parse(out))
  })

  // What was said, written on my lead.
  .post('/leads/:id/notes', async (c) => {
    const auth = c.get('auth')
    const id = uuidParam(c)
    const parsed = myLeadNoteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Write what was said.')
    const rows = await attempt(c, 'me.lead_note', () =>
      withService(c.env, (sql) => sql<{ id: string }[]>`
        insert into crm_activities (company_id, lead_id, type, direction, body, actor_id)
        select l.company_id, l.id, 'note', 'none', ${parsed.data.body}, ${auth.userId}
          from crm_leads l
         where l.id = ${id} and l.company_id = ${auth.companyId} and l.assigned_to = ${auth.userId}
        returning id`),
    )
    if (!rows) fail(400, 'We could not save the note.')
    if (!rows.length) fail(404, 'That lead is not given to you.')
    await audit(c, { action: 'activity.create', entityType: 'crm_activity', entityId: rows[0]!.id, after: { type: 'note', lead_id: id } })
    return c.json({ ok: true }, 201)
  })

  // The next follow-up on my lead: mine, so its reminder comes to me.
  .post('/leads/:id/follow-ups', async (c) => {
    const auth = c.get('auth')
    const id = uuidParam(c)
    const parsed = myLeadFollowUpRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick when to follow up.')
    const v = parsed.data
    const rows = await attempt(c, 'me.lead_follow_up', () =>
      withService(c.env, (sql) => sql<{ id: string }[]>`
        insert into crm_activities (company_id, lead_id, type, direction, subject, body, due_at, assigned_to, actor_id, priority)
        select l.company_id, l.id, 'task', 'none', ${v.subject}, ${v.body ?? null}, ${v.due_at}, ${auth.userId}, ${auth.userId}, 'Normal'
          from crm_leads l
         where l.id = ${id} and l.company_id = ${auth.companyId} and l.assigned_to = ${auth.userId}
        returning id`),
    )
    if (!rows) fail(400, 'We could not set the follow-up.')
    if (!rows.length) fail(404, 'That lead is not given to you.')
    await audit(c, { action: 'activity.create', entityType: 'crm_activity', entityId: rows[0]!.id, after: { type: 'task', lead_id: id } })
    return c.json({ ok: true }, 201)
  })

  // Email copies of my alerts (0227): on unless I turned them off.
  // The notes on one of their deliverables have been heard: its alerts are
  // read, so Home stops putting it at the top. Only the caller's own alerts.
  .post('/deliverables/:id/notes-read', async (c) => {
    const auth = c.get('auth')
    const id = uuidParam(c)
    const rows = await attempt(c, 'me.notes_read', () =>
      withService(c.env, (sql) => sql<{ id: string }[]>`
        update notifications
           set read_at = now()
         where company_id = ${auth.companyId} and recipient_uid = ${auth.userId}
           and type = 'deliverable_note' and entity_type = 'deliverable'
           and entity_id = ${id} and read_at is null
        returning id`),
    )
    if (!rows) fail(400, 'We could not mark those notes as heard.')
    return c.json({ read: rows.length })
  })

  .get('/alert-emails', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'me.alert_emails', () =>
      withService(c.env, (sql) => sql<{ on: boolean; email: string | null }[]>`
        select alert_emails as on, email from users
         where user_id = ${auth.userId} and company_id = ${auth.companyId} and deleted_at is null`),
    )
    if (!rows) fail(400, 'We could not load your email setting.')
    return c.json({ on: rows[0]?.on ?? true, email: rows[0]?.email ?? null })
  })

  .put('/alert-emails', async (c) => {
    const parsed = z.object({ on: z.boolean() }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Say on or off.')
    const rows = await attempt(c, 'me.alert_emails_set', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ on: boolean }[]>`select set_my_alert_emails(${parsed.data.on}) as on`),
    )
    if (!rows) fail(400, 'We could not save your email setting.')
    return c.json({ on: rows[0]?.on ?? parsed.data.on })
  })

  /**
   * My payouts: what every shoot I was booked on pays me, what the studio
   * has paid and when. Read for the caller alone, in their own studio; the
   * ledger is managers-only under RLS, so this reads as the service and
   * filters to the caller. No client details.
   */
  .get('/payouts', async (c) => {
    const auth = c.get('auth')
    const data = await attempt(c, 'me.payouts', () =>
      withService(c.env, async (sql) => {
        const bookings = await sql`
          select t.id as slot_id, t.service_name as role, s.name as shoot_name, p.name as project_name,
                 s.shoot_date::text as shoot_date,
                 coalesce(t.final_cost, t.estimated_cost, 0)::float8 as amount,
                 (t.cost_status = 'final') as is_final,
                 coalesce((select sum(ss.amount_paid) from team_slot_settlements ss where ss.slot_id = t.id), 0)::float8 as paid
            from team_assignment_slots t
            join shoots s on s.id = t.shoot_id
            left join projects p on p.id = s.project_id
           where t.company_id = ${auth.companyId} and t.user_id = ${auth.userId}
             and t.status not in ('cancelled', 'released')
           order by s.shoot_date desc nulls first, s.name
           limit 300`
        const payments = await sql`
          select ss.id, ss.slot_id, s.name as shoot_name, ss.amount_paid::float8 as amount, ss.paid_date::text as paid_date,
                 ss.payment_mode, ss.payment_reference, ss.entry_type
            from team_slot_settlements ss
            join team_assignment_slots t on t.id = ss.slot_id
            left join shoots s on s.id = t.shoot_id
           where t.company_id = ${auth.companyId} and t.user_id = ${auth.userId}
           order by ss.paid_date desc, ss.created_at desc
           limit 200`
        const [pd] = await sql<{ ok: boolean }[]>`
          select exists (
            select 1 from member_profiles mp
             where mp.user_id = ${auth.userId}
               and (nullif(btrim(mp.upi_id), '') is not null
                    or (nullif(btrim(mp.bank_account_number), '') is not null and nullif(btrim(mp.bank_ifsc), '') is not null))
          ) as ok`
        return { bookings, payments, has_pay_details: pd?.ok ?? false }
      }),
    )
    if (!data) fail(400, 'We could not load your payouts.')
    const bookings = data.bookings as unknown as Array<{ amount: number; paid: number }>
    const round = (n: number) => Math.round(n * 100) / 100
    const owed = round(bookings.reduce((a, b) => a + Math.max(0, Number(b.amount) - Number(b.paid)), 0))
    const paid = round(bookings.reduce((a, b) => a + Number(b.paid), 0))
    // A booking with no shoot date yet is still to come.
    const today = todayInIndia()
    const split = summarizeCrewOwed(
      (data.bookings as unknown as Array<{ amount: number; paid: number; shoot_date: string | null }>).map((b) => ({
        user_id: auth.userId,
        user_name: null,
        shoot_date: b.shoot_date ?? '9999-12-31',
        amount: Number(b.amount),
        paid: Number(b.paid),
      })),
      today,
    )
    return c.json(
      myPayouts.parse({ ...data, owed, paid, owed_now: split.owed_now, upcoming: split.upcoming, paid_ahead: split.paid_ahead }),
    )
  })

  // What is coming due, for the chip in the top bar: the caller's own edits
  // and tasks, late or due in the next three days. Someone who runs the
  // studio's work also sees the studio's edits that are late or due in two
  // days, with who has each.
  .get('/due', async (c) => {
    const auth = c.get('auth')
    const studio = studioWork(c)
    const rows = await attempt(c, 'me.due', () =>
      withService(c.env, (sql) => sql`
        with t as (select (now() at time zone 'Asia/Kolkata')::date as today)
        select * from (
          select 'edit'::text as kind, d.id, d.title, d.project_id, p.name as project_name,
                 d.estimated_date as due, (d.estimated_date - t.today)::int as days,
                 case when d.assignee_id = ${auth.userId} then null else coalesce(u.name, 'Nobody yet') end as who,
                 coalesce(d.assignee_id = ${auth.userId}, false) as mine
            from deliverables d
            cross join t
            join projects p on p.id = d.project_id
            left join users u on u.user_id = d.assignee_id and u.company_id = d.company_id
           where d.company_id = ${auth.companyId}
             and d.status not in ('completed', 'cancelled')
             and d.estimated_date is not null
             and ((d.assignee_id = ${auth.userId} and d.estimated_date <= t.today + 3)
                  or (${studio} and d.estimated_date <= t.today + 2))
          union all
          select 'task', tk.id, tk.title, tk.project_id, p.name, tk.due_date,
                 (tk.due_date - t.today)::int, null, true
            from tasks tk
            cross join t
            left join projects p on p.id = tk.project_id
           where tk.company_id = ${auth.companyId}
             and tk.status not in ('completed', 'cancelled')
             and tk.due_date is not null and tk.due_date <= t.today + 3
             and exists (select 1 from task_assignees a where a.task_id = tk.id and a.user_id = ${auth.userId})
        ) x
        order by x.due, x.mine desc, x.title
        limit 40`),
    )
    if (!rows) fail(400, 'We could not load what is due.')
    return c.json(myDueItem.array().parse(rows))
  })

  // One project as someone who works on it sees it: its days and who shot
  // them, where each day's data is, and their own work on it. Never money,
  // never the client's phone, never what anyone is paid.
  .get('/projects/:id', async (c) => {
    const auth = c.get('auth')
    const id = uuidParam(c)
    const out = await attempt(c, 'me.project', () =>
      withService(c.env, async (sql) => {
        const [p] = await sql<{ id: string; name: string; client_name: string | null }[]>`
          select p.id, p.name, cl.name as client_name
            from projects p left join clients cl on cl.id = p.client_id
           where p.id = ${id} and p.company_id = ${auth.companyId}
             and ${studioWork(c) ? sql`true` : worksOn(sql, auth.userId)}`
        if (!p) return 'not_found' as const
        const shoots = await sql<Record<string, unknown>[]>`
          select s.id, s.name, s.shoot_date, s.start_at, s.end_at, s.location, s.map_link, s.status,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'user_id', t.user_id, 'name', coalesce(u.name, 'Someone'),
                            'role', t.service_name, 'me', t.user_id = ${auth.userId})
                          order by t.start_at, u.name)
                     from team_assignment_slots t
                     left join users u on u.user_id = t.user_id
                    where t.shoot_id = s.id and t.status <> 'cancelled' and t.released_at is null
                      and t.user_id is not null
                 ), '[]'::jsonb) as crew,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', r.id, 'label', r.data_label,
                            'whose', coalesce(wu.name, r.team_member_name),
                            'main', pl.name, 'folder_path', r.folder_path, 'cloud_link', r.cloud_link,
                            'backup', bl.name, 'backup_folder_path', r.backup_folder_path,
                            'backup_cloud_link', r.backup_cloud_link,
                            'stage', r.data_status,
                            'copied_by', coalesce(cu.name, r.copied_by_name),
                            'date_received', r.date_received,
                            'handed_to_editor_at', r.handed_to_editor_at,
                            'card_count', coalesce(r.card_count, 0), 'card_labels', coalesce(r.card_labels, '{}'), 'size_gb', coalesce(r.size_gb, 0),
                            'notes', r.notes)
                          order by r.created_at)
                     from shoot_data_records r
                     left join storage_locations pl on pl.id = r.primary_location_id
                     left join storage_locations bl on bl.id = r.backup_location_id
                     left join users wu on wu.user_id = r.user_id
                     left join users cu on cu.user_id = r.copied_by_uid
                    where r.shoot_id = s.id
                 ), '[]'::jsonb) as data
            from shoots s
           where s.project_id = ${id} and s.status <> 'cancelled'
           order by s.shoot_date nulls last, s.start_at nulls last, s.name`
        const deliverables = await selectMyDeliverables(sql, { companyId: auth.companyId, userId: auth.userId, projectId: id, done: 60 })
        const tasks = await sql<Record<string, unknown>[]>`
          select tk.id, tk.title, tk.status, tk.due_date
            from tasks tk
           where tk.project_id = ${id} and tk.company_id = ${auth.companyId}
             and exists (select 1 from task_assignees a where a.task_id = tk.id and a.user_id = ${auth.userId})
           order by tk.status in ('completed', 'cancelled'), tk.due_date nulls last
           limit 100`
        const submissions = await sql<Record<string, unknown>[]>`
          select w.id, w.deliverable_id, d.title as deliverable_title, w.submission_link, w.status,
                 w.review_notes, w.version, w.created_at
            from team_work_submissions w
            left join deliverables d on d.id = w.deliverable_id
           where w.project_id = ${id} and w.company_id = ${auth.companyId} and w.submitted_by = ${auth.userId}
           order by w.created_at desc
           limit 50`
        const dates = shoots.map((s) => s.shoot_date as string | null).filter((d): d is string => !!d).sort()
        return {
          ...p,
          first_date: dates[0] ?? null,
          last_date: dates[dates.length - 1] ?? null,
          shoots,
          deliverables,
          tasks,
          submissions,
        }
      }),
    )
    if (!out) fail(400, 'We could not load this project.')
    if (out === 'not_found') fail(404, 'This project is not one you work on.')
    return c.json(myProject.parse(out))
  })
