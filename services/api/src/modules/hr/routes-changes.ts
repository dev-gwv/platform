import { Hono } from 'hono'
import { companyHoliday, createLeaveRequest, reopenLeaveRequest, updateHolidayRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { explain } from './shared'

/**
 * Changing things back (owner, 26 Oct; 0286). Every write is a function that
 * checks who is asking; its refusals are sentences and reach the person as is.
 */
export const hrChangeRoutes = new Hono<AppEnv>()
  // A manager puts a decided request back to waiting, to decide again.
  .post('/leave/:id/reopen', async (c) => {
    const parsed = reopenLeaveRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Keep the note under 500 characters.')
    const id = uuidParam(c)
    const ok = await attempt(
      c,
      'hr.leave.reopen',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select reopen_leave(${id}, ${parsed.data.note ?? null})`
          return true
        }),
      { onCode: explain },
    )
    if (!ok) fail(400, 'We could not reopen that request.')
    await audit(c, { action: 'leave.reopen', entityType: 'leave', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  // Whoever asked changes their own waiting request: other days, another kind.
  .patch('/leave/:id', async (c) => {
    const parsed = createLeaveRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the dates.')
    const v = parsed.data
    const id = uuidParam(c)
    const ok = await attempt(
      c,
      'hr.leave.update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select update_leave_request(${id}, ${v.kind}, ${v.start_date}::date, ${v.end_date}::date,
                                                ${v.half_day}, ${v.reason ?? null})`
          return true
        }),
      { onCode: explain },
    )
    if (!ok) fail(400, 'We could not change that request.')
    await audit(c, { action: 'leave.update', entityType: 'leave', entityId: id, after: v })
    return c.body(null, 204)
  })

  // Asked to fix a day by mistake: take it back while nobody has answered.
  .post('/corrections/:id/cancel', async (c) => {
    const id = uuidParam(c)
    const ok = await attempt(
      c,
      'hr.corrections.cancel',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select cancel_attendance_correction(${id})`
          return true
        }),
      { onCode: explain },
    )
    if (!ok) fail(400, 'We could not take that request back.')
    await audit(c, { action: 'attendance.correction_cancel', entityType: 'attendance', entityId: id })
    return c.body(null, 204)
  })

  // Rename a holiday or move it to another day. RLS lets only an owner,
  // admin or manager write holidays, the same as adding one.
  .patch('/holidays/:id', async (c) => {
    const parsed = updateHolidayRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Give the holiday a date and a name.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(
      c,
      'hr.holidays.update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql`
            update company_holidays set ${sql(parsed.data)}
             where id = ${id}
            returning id, holiday_date, name`
          return rows[0] ?? 'missing'
        }),
      { onCode: (code) => (code === '23505' ? ('taken' as const) : undefined) },
    )
    if (row === 'taken') fail(409, 'There is already a holiday on that day.')
    if (row === 'missing') fail(404, 'That holiday was not found, or only a manager can change it.')
    if (!row) fail(400, 'We could not change that holiday.')
    await audit(c, { action: 'holiday.update', entityType: 'holiday', entityId: id, after: parsed.data })
    return c.json(companyHoliday.parse(row))
  })
