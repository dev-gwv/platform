import { Hono } from 'hono'
import {
  createTeamPayoutRequest,
  updateTeamPayoutRequest,
  teamPayoutList,
  createPayoutSettlementRequest,
  payoutSettlementList,
  createPayoutSettlementResponse,
  projectPayoutRow,
  slotPayStatus,
  paySlotRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { rpcJson } from '../../lib/rpc'

const okResponse = z.object({ ok: z.boolean() })

/**
 * Team payouts — settlement management for team members.
 * Admin only (owner or super_admin).
 */
export const teamPayoutsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireModule('team_payouts'))

  .get('/', async (c) => {
    const userId = c.req.query('user_id')
    const status = c.req.query('status')
    const rows = await attempt(c, 'team-payouts.list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const items = await sql`
          select tp.id, tp.company_id, tp.user_id, u.name as user_name,
                 tp.amount, tp.period_start, tp.period_end, tp.status,
                 tp.payment_mode, tp.reference, tp.notes, tp.created_at
            from team_payouts tp
            left join users u on u.user_id = tp.user_id
           where tp.company_id = ${c.get('auth').companyId}
             and ${userId ? sql`tp.user_id = ${userId}` : sql`true`}
             and ${status ? sql`tp.status = ${status}` : sql`true`}
           order by tp.created_at desc`
        const summary = await sql`
          select count(*)::int as total_payouts,
                 coalesce(sum(amount), 0)::numeric as total_amount,
                 coalesce(sum(amount) filter (where status = 'pending'), 0)::numeric as pending_amount,
                 coalesce(sum(amount) filter (where status = 'completed'), 0)::numeric as completed_amount,
                 coalesce(sum(amount) filter (where period_start >= date_trunc('month', current_date)), 0)::numeric as this_month_amount
            from team_payouts
           where company_id = ${c.get('auth').companyId}`
        return { items, summary: summary[0] }
      }),
    )
    if (!rows) fail(400, 'We could not load payouts.')
    return c.json(teamPayoutList.parse(rows))
  })

  .post('/', async (c) => {
    const parsed = createTeamPayoutRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payout details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'team-payouts.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const result = await sql<{ create_team_payout: string }[]>`
          select create_team_payout(
            p_user_id => ${d.user_id}::uuid,
            p_amount => ${d.amount}::numeric,
            p_period_start => ${d.period_start}::date,
            p_period_end => ${d.period_end}::date,
            p_payment_mode => ${d.payment_mode ?? null},
            p_reference => ${d.reference ?? null},
            p_notes => ${d.notes ?? null}
          ) as create_team_payout`
        return result
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not create this payout.')
    await audit(c, { action: 'team_payout.create', entityType: 'team_payout', entityId: rows[0].create_team_payout, after: d })
    return c.json({ id: rows[0].create_team_payout }, 201)
  })

  // A wrong amount or period is only safe to correct before the payout has
  // actually moved -- once it's processing or completed, that number is what
  // was paid, not a draft.
  .patch('/:id', async (c) => {
    const parsed = updateTeamPayoutRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payout details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'team-payouts.update', () =>
      withUser(c.env, auth.userId, (sql) => sql<{ id: string }[]>`
        update team_payouts set ${sql(parsed.data)}
        where id = ${id} and company_id = ${auth.companyId} and status = 'pending'
        returning id`),
    )
    if (!rows) fail(400, 'We could not update this payout.')
    if (!rows.length) fail(404, 'That payout was not found, or is no longer pending.')
    await audit(c, { action: 'team_payout.update', entityType: 'team_payout', entityId: id, after: parsed.data })
    return c.json(okResponse.parse({ ok: true }))
  })

  .patch('/:id/status', async (c) => {
    const id = uuidParam(c)
    const body = await c.req.json().catch(() => ({}))
    const status = z.enum(['pending', 'processing', 'completed', 'failed']).safeParse(body.status)
    if (!status.success) fail(422, 'Invalid status.')
    const auth = c.get('auth')
    const rows = await attempt(c, 'team-payouts.status', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update team_payouts
             set status = ${status.data}
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update this payout.')
    if (!rows.length) fail(404, 'We could not find that payout.')
    await audit(c, { action: 'team_payout.status', entityType: 'team_payout', entityId: id, after: { status: status.data } })
    return c.json(okResponse.parse({ ok: true }))
  })

  .delete('/:id', async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'team-payouts.delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from team_payouts where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this payout.')
    if (!rows.length) fail(404, 'We could not find that payout.')
    await audit(c, { action: 'team_payout.delete', entityType: 'team_payout', entityId: id })
    return c.json(okResponse.parse({ ok: true }))
  })

  // ── Shoot-derived tracker: a cash ledger against booked slots ────
  // Kept alongside the manual payouts above, not replacing them -- neither
  // reads nor writes team_assignment_slots' own cost fields.
  /**
   * Every booking on one project with what it pays and what has gone out --
   * the project's Finance → Payouts tab. "data_in" says the person's cards
   * have been copied, which is when most studios pay a freelancer.
   */
  .get('/project/:id', async (c) => {
    const projectId = uuidParam(c)
    const rows = await attempt(c, 'team-payouts.project', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select t.id as slot_id, t.user_id, u.name as user_name, u.engagement_type, t.service_name as role,
               s.id as shoot_id, s.name as shoot_name, s.shoot_date::text as shoot_date,
               coalesce(t.final_cost, t.estimated_cost, 0)::float8 as amount, t.cost_status,
               coalesce(pay.paid, 0)::float8 as paid, pay.last_paid::text as last_paid_date,
               exists (select 1 from shoot_data_records d where d.slot_id = t.id) as data_in
          from team_assignment_slots t
          join shoots s on s.id = t.shoot_id
          left join users u on u.user_id = t.user_id and u.company_id = t.company_id
          left join lateral (
            select sum(ss.amount_paid) as paid, max(ss.paid_date) as last_paid
              from team_slot_settlements ss where ss.slot_id = t.id
          ) pay on true
         where s.project_id = ${projectId} and t.status not in ('cancelled', 'released')
         order by s.shoot_date nulls last, s.name, u.name`),
    )
    if (!rows) fail(400, 'We could not load the payouts.')
    return c.json(projectPayoutRow.array().parse(rows))
  })

  // Where one booking's payout stands: the starting point of a "pay now" form.
  .get('/slot/:id', async (c) => {
    const slotId = uuidParam(c)
    const rows = await attempt(c, 'team-payouts.slot', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select t.id as slot_id, u.name as user_name,
               coalesce(t.final_cost, t.estimated_cost, 0)::float8 as amount, t.cost_status,
               coalesce((select sum(ss.amount_paid) from team_slot_settlements ss where ss.slot_id = t.id), 0)::float8 as paid
          from team_assignment_slots t
          left join users u on u.user_id = t.user_id and u.company_id = t.company_id
         where t.id = ${slotId}`),
    )
    if (!rows) fail(400, 'We could not load the payout.')
    if (!rows.length) fail(404, 'That booking was not found.')
    return c.json(slotPayStatus.parse(rows[0]))
  })

  /**
   * Set what a booking pays and record what was handed over, together -- so
   * paying a freelancer as their cards are copied is one step. A changed
   * amount is the final amount; a payment past it is refused (409).
   */
  .post('/slot/:id/pay', async (c) => {
    const parsed = paySlotRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the amount.')
    const d = parsed.data
    const slotId = uuidParam(c)
    const row = await attempt(
      c,
      'team-payouts.slot_pay',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [cur] = await sql<{ amount: number }[]>`
            select coalesce(final_cost, estimated_cost, 0)::float8 as amount from team_assignment_slots where id = ${slotId}`
          if (!cur) return 'missing' as const
          if (d.amount !== undefined && Math.abs(d.amount - cur.amount) > 0.001) {
            await sql`select set_slot_cost(p_slot_id => ${slotId}, p_final_cost => ${d.amount}, p_cost_status => 'final')`
          }
          if (d.paid_now > 0) {
            await sql`
              select * from create_payout_settlement(
                p_slot_id => ${slotId},
                p_amount_paid => ${d.paid_now},
                p_paid_date => ${d.paid_date ?? null},
                p_payment_mode => ${d.payment_mode ?? null},
                p_payment_reference => ${d.payment_reference ?? null},
                p_notes => ${null},
                p_entry_type => 'payment',
                p_reverses_settlement_id => ${null}
              )`
          }
          const [after] = await sql`
            select t.id as slot_id, u.name as user_name,
                   coalesce(t.final_cost, t.estimated_cost, 0)::float8 as amount, t.cost_status,
                   coalesce((select sum(ss.amount_paid) from team_slot_settlements ss where ss.slot_id = t.id), 0)::float8 as paid
              from team_assignment_slots t
              left join users u on u.user_id = t.user_id and u.company_id = t.company_id
             where t.id = ${slotId}`
          return after ?? null
        }),
      {
        onCode: (code, err) => {
          const msg = String((err as { message?: string })?.message ?? '')
          if (msg.includes('exceed amount due')) return fail(409, 'That is more than this booking pays. Change the amount first.')
          if (code === '42501') return fail(403, 'Only an owner or a manager can record a payout.')
          return undefined
        },
      },
    )
    if (row === 'missing') fail(404, 'That booking was not found.')
    if (!row) fail(400, 'We could not save the payout.')
    await audit(c, { action: 'payout.pay', entityType: 'team_assignment_slot', entityId: slotId, after: d })
    return c.json(slotPayStatus.parse(row))
  })

  .get('/settlements', async (c) => {
    const raw = c.req.query('slot_ids')
    const slotIds = raw ? raw.split(',').filter(Boolean) : null
    const data = await attempt(c, 'team-payouts.settlements_list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const result = await sql<{ list_payout_settlements: unknown }[]>`
          select list_payout_settlements(${slotIds}::uuid[]) as list_payout_settlements`
        return rpcJson(result[0]?.list_payout_settlements, { entries: [], aggregates: [] })
      }),
    )
    if (!data) fail(400, 'We could not load settlements.')
    return c.json(payoutSettlementList.parse(data))
  })

  .post('/settlements', async (c) => {
    const parsed = createPayoutSettlementRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the settlement details.')
    const d = parsed.data
    const row = await attempt(
      c,
      'team-payouts.settlement_create',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ id: string; paid_total: string; amount_due: string }[]>`
            select * from create_payout_settlement(
              p_slot_id => ${d.slot_id},
              p_amount_paid => ${d.amount_paid},
              p_paid_date => ${d.paid_date ?? null},
              p_payment_mode => ${d.payment_mode ?? null},
              p_payment_reference => ${d.payment_reference ?? null},
              p_notes => ${d.notes ?? null},
              p_entry_type => ${d.entry_type},
              p_reverses_settlement_id => ${d.reverses_settlement_id ?? null}
            )`
          return rows[0] ?? null
        }),
      { onCode: (code, err) => (String((err as { message?: string })?.message ?? '').includes('exceed amount due') ? 'over_due' : undefined) },
    )
    if (row === 'over_due') fail(409, 'That payment would exceed the amount due for this slot.')
    if (!row) fail(400, 'We could not save this settlement.')
    await audit(c, { action: 'payout_settlement.create', entityType: 'team_slot_settlement', entityId: row.id, after: d })
    return c.json(createPayoutSettlementResponse.parse(row), 201)
  })
