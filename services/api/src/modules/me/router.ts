import { Hono } from 'hono'
import { myFollowUp, myPayouts, z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/**
 * A person's own things that live in other people's areas -- today, the CRM
 * follow-ups given to them. Staff without the CRM still get calls to make
 * ("Call Mehta at 4 PM"), and had no way to see them. Read and closed here,
 * scoped to the caller and their studio, without opening the CRM to them.
 *
 * Whose a follow-up is: the person it was given to, else the lead's owner
 * (as the morning email reads it), else whoever wrote it.
 */
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

  // Email copies of my alerts (0227): on unless I turned them off.
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
    return c.json(myPayouts.parse({ ...data, owed, paid }))
  })
