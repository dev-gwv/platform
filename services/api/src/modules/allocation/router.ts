import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import type { BookSlotRequest } from '@ipc/contracts'
import { bookSlotRequest, bookSlotsBatchRequest, bookSlotsBatchResult, setSlotStatusRequest, setSlotCostRequest, setSlotDataRequest, teamSlot, updateSlotRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/** The overlap guard's two spellings: 23P01 on Postgres, the trigger's text on pglite. */
const isDoubleBooking = (code: string, err: unknown) =>
  code === '23P01' || String((err as { message?: string })?.message ?? '').includes('double_booking')

/**
 * One booking, with its payout set in the same breath -- the assign dialog
 * asks for status and notes up front, and a booking left at the defaults
 * until someone remembers to open it again is how payouts go missing.
 */
async function bookOne(sql: TransactionSql, d: BookSlotRequest): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    select book_team_slot(
      p_user_id => ${d.user_id},
      p_shoot_id => ${d.shoot_id},
      p_service_name => ${d.service_name ?? null},
      p_start_at => ${d.start_at},
      p_end_at => ${d.end_at},
      p_estimated_cost => ${d.estimated_cost ?? null}
    ) as id`
  const id = rows[0]?.id ?? null
  if (id && (d.cost_status || d.cost_notes)) {
    await sql`select set_slot_cost(
      p_slot_id => ${id},
      p_cost_status => ${d.cost_status ?? null},
      p_cost_notes => ${d.cost_notes ?? null}
    )`
  }
  return id
}

export const allocationRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'allocation.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select s.id, s.user_id, s.shoot_id, s.service_name, s.start_at, s.end_at, s.status,
                 s.estimated_cost, s.final_cost, s.cost_status, s.cost_notes,
                 coalesce(s.data_required, false) as data_required,
                 s.data_not_required_reason, u.name as user_name
          from team_assignment_slots s
          left join users u on u.user_id = s.user_id
          order by s.start_at`,
      ),
    )
    if (!rows) fail(400, 'We could not load the schedule.')
    return c.json(teamSlot.array().parse(rows))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = bookSlotRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the booking details.')
    const d = parsed.data
    const id = await attempt(
      c,
      'allocation.book',
      () =>
        withUser(c.env, c.get('auth').userId, (sql) => bookOne(sql, d)),
      {
        // The overlap guard raises SQLSTATE 23P01 (exclusion violation), or
        // the pglite fallback trigger raises with 'double_booking' in the text.
        onCode: (code, err) => (isDoubleBooking(code, err) ? 'double_booked' : undefined),
      },
    )
    if (id === 'double_booked') fail(409, 'That member is already booked during this time.')
    if (!id) fail(400, 'We could not create the booking.')
    await audit(c, { action: 'allocation.book', entityType: 'team_assignment_slot', entityId: id, after: d })
    return c.json({ id }, 201)
  })

  // Bulk assign: many people onto one shoot, or one person onto many. Each
  // booking runs in its own savepoint, so a clash on one leaves the others
  // booked and the caller is told exactly which, instead of all-or-nothing.
  .post('/batch', requireAction('projects', 'edit'), async (c) => {
    const parsed = bookSlotsBatchRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the booking details.')
    const items = parsed.data.items
    const results = await attempt(c, 'allocation.book_batch', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const out: { index: number; id: string | null; error: 'double_booked' | 'failed' | null }[] = []
        for (const [index, d] of items.entries()) {
          try {
            const id = await sql.savepoint((sp) => bookOne(sp, d))
            out.push({ index, id, error: id ? null : 'failed' })
          } catch (err) {
            const code = String((err as { code?: string })?.code ?? '')
            out.push({ index, id: null, error: isDoubleBooking(code, err) ? 'double_booked' : 'failed' })
          }
        }
        return out
      }),
    )
    if (!results) fail(400, 'We could not create the bookings.')
    const booked = results.filter((r) => r.id)
    if (booked.length) {
      await audit(c, {
        action: 'allocation.book_batch',
        entityType: 'team_assignment_slot',
        entityId: booked[0]!.id!,
        after: { booked: booked.length, skipped: results.length - booked.length },
      })
    }
    return c.json(bookSlotsBatchResult.parse({ results }), 201)
  })

  .post('/:id/status', requireAction('projects', 'edit'), async (c) => {
    const parsed = setSlotStatusRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid status.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'allocation.status', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select set_team_slot_status(p_slot_id => ${id}, p_status => ${parsed.data.status})`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not update the booking.')
    await audit(c, { action: 'allocation.status', entityType: 'team_assignment_slot', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  // Cost is settled separately from the booking -- what a shoot is worth to
  // pay out, distinct from when/who/where it happens.
  .post('/:id/cost', requireAction('projects', 'edit'), async (c) => {
    const parsed = setSlotCostRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the cost details.')
    const id = uuidParam(c)
    const d = parsed.data
    const ok = await attempt(c, 'allocation.set_cost', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select set_slot_cost(
          p_slot_id => ${id},
          p_estimated_cost => ${d.estimated_cost ?? null},
          p_final_cost => ${d.final_cost ?? null},
          p_cost_status => ${d.cost_status ?? null},
          p_cost_notes => ${d.cost_notes ?? null}
        )`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not update the cost.')
    await audit(c, { action: 'allocation.set_cost', entityType: 'team_assignment_slot', entityId: id, after: d })
    return c.body(null, 204)
  })

  // Edit a booking's who/when/what (member, shoot, service, time window).
  // Overlap guard runs in the trigger — a double-booked move is refused
  // with 409, same as creating one.
  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateSlotRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the booking details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const d = parsed.data
    const outcome = await attempt(
      c,
      'allocation.update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ id: string }[]>`
            update team_assignment_slots set ${sql({
              ...(d.user_id !== undefined ? { user_id: d.user_id } : {}),
              ...(d.shoot_id !== undefined ? { shoot_id: d.shoot_id } : {}),
              ...(d.service_name !== undefined ? { service_name: d.service_name } : {}),
              ...(d.start_at !== undefined ? { start_at: d.start_at } : {}),
              ...(d.end_at !== undefined ? { end_at: d.end_at } : {}),
            })} where id = ${id} returning id`
          return rows.length ? ('ok' as const) : ('missing' as const)
        }),
      {
        onCode: (code, err) =>
          code === '23P01' || String((err as { message?: string })?.message ?? '').includes('double_booking')
            ? 'double_booked'
            : undefined,
      },
    )
    if (outcome === 'double_booked') fail(409, 'That member is already booked during this time.')
    if (outcome === 'missing') fail(404, 'We could not find that booking.')
    if (!outcome) fail(400, 'We could not update the booking.')
    await audit(c, { action: 'allocation.update', entityType: 'team_assignment_slot', entityId: id, after: d })
    return c.body(null, 204)
  })

  // Data-required flag: does this booking still owe footage/cards?
  .post('/:id/data', requireAction('projects', 'edit'), async (c) => {
    const parsed = setSlotDataRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the data requirement.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'allocation.set_data', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          update team_assignment_slots set
            data_required = ${parsed.data.data_required},
            data_not_required_reason = ${parsed.data.data_not_required_reason ?? null}
          where id = ${id} returning id`,
      ),
    )
    if (!ok) fail(400, 'We could not update the data requirement.')
    if (!ok.length) fail(404, 'We could not find that booking.')
    await audit(c, { action: 'allocation.set_data', entityType: 'team_assignment_slot', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })
