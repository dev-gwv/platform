import { Hono } from 'hono'
import {
  attendanceDayRow,
  attendanceRecord,
  checkInRequest,
  companyFence,
  setAttendanceRequest,
  setFenceRequest,
  z,
  leaveRequest,
  createLeaveRequest,
  decideRequest,
  companyHoliday,
  createHolidayRequest,
  attendancePolicy,
  attendanceCorrection,
  createCorrectionRequest,
} from '@ipc/contracts'
import { matchesRoster, summariseRoster } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam, dateParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { rpcJson } from '../../lib/rpc'
import { audit } from '../../lib/audit'

const list = attendanceRecord.array()
const idOnly = z.object({ id: z.string() })
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The database's own words for a refused request ("you already have leave on
 * some of these days") as a sentence -- they are written for people.
 */
function explain(code: string, err: unknown): undefined {
  const msg = String((err as { message?: string })?.message ?? '')
  const sentence = msg ? `${msg[0]!.toUpperCase()}${msg.slice(1)}.` : ''
  if (code === 'P0002') fail(404, sentence || 'Not found.')
  if (code === '22023' && msg) fail(422, sentence)
  if (code === '42501' && msg && msg !== 'not allowed') fail(403, sentence)
  return undefined
}

/** The RPCs signal their own refusals as P0001 with a leading keyword. */
const rpcReason = (err: unknown): string => String((err as { message?: string })?.message ?? '')

export const hrRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ── Leave ────────────────────────────────────────────────────
  // ?scope=team is for whoever decides (RLS returns everyone's to an owner,
  // admin or manager, and only your own to anyone else); the default is yours.
  .get('/leave', async (c) => {
    const auth = c.get('auth')
    const team = c.req.query('scope') === 'team'
    const status = c.req.query('status')
    if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) fail(422, 'Unknown status.')
    const rows = await attempt(c, 'hr.leave.list', () =>
      withUser(c.env, auth.userId, (sql) => sql`
        select l.id, l.user_id, u.name as user_name, l.kind, l.start_date, l.end_date, l.half_day, l.reason,
               l.status, d.name as decided_by_name, l.decided_at, l.decision_note, l.created_at
          from leave_requests l
          join users u on u.user_id = l.user_id
          left join users d on d.user_id = l.decided_by
         where ${team ? sql`true` : sql`l.user_id = ${auth.userId}`}
           and ${status ? sql`l.status = ${status}` : sql`true`}
         order by case when l.status = 'pending' then 0 else 1 end, l.start_date desc
         limit 300`),
    )
    if (!rows) fail(400, 'We could not load leave.')
    return c.json(leaveRequest.array().parse(rows))
  })

  .post('/leave', async (c) => {
    const parsed = createLeaveRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the dates.')
    const v = parsed.data
    const row = await attempt(c, 'hr.leave.request', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ id: string }[]>`
          select request_leave(p_kind => ${v.kind}, p_start => ${v.start_date}::date, p_end => ${v.end_date}::date,
                               p_half_day => ${v.half_day}, p_reason => ${v.reason ?? null}) as id`
        return r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not send your leave request.')
    await audit(c, { action: 'leave.request', entityType: 'leave', entityId: row.id, after: v })
    return c.json(idOnly.parse(row), 201)
  })

  .post('/leave/:id/decide', async (c) => {
    const parsed = decideRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Approve or decline, with a note.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'hr.leave.decide', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select decide_leave(p_id => ${id}, p_approve => ${parsed.data.approve}, p_note => ${parsed.data.note ?? null})`
        return true
      }),
    { onCode: explain })
    if (!ok) fail(400, 'We could not save that decision.')
    await audit(c, { action: parsed.data.approve ? 'leave.approve' : 'leave.reject', entityType: 'leave', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .post('/leave/:id/cancel', async (c) => {
    const id = uuidParam(c)
    const ok = await attempt(c, 'hr.leave.cancel', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select cancel_leave(${id})`
        return true
      }),
    { onCode: explain })
    if (!ok) fail(400, 'We could not cancel that.')
    await audit(c, { action: 'leave.cancel', entityType: 'leave', entityId: id })
    return c.body(null, 204)
  })

  // ── Holidays and weekly off (everyone reads; managers change) ─
  .get('/holidays', async (c) => {
    const year = Number(c.req.query('year') ?? new Date().getFullYear())
    if (!(year >= 2000 && year <= 2100)) fail(422, 'Invalid year.')
    const rows = await attempt(c, 'hr.holidays.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, holiday_date, name from company_holidays
         where extract(year from holiday_date)::int = ${year}
         order by holiday_date`),
    )
    if (!rows) fail(400, 'We could not load holidays.')
    return c.json(companyHoliday.array().parse(rows))
  })

  .post('/holidays', async (c) => {
    const parsed = createHolidayRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Give the holiday a date and a name.')
    const auth = c.get('auth')
    const row = await attempt(c, 'hr.holidays.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          insert into company_holidays ${sql({ ...parsed.data, company_id: auth.companyId })}
          on conflict (company_id, holiday_date) do update set name = excluded.name
          returning id, holiday_date, name`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(403, 'Only an owner, admin or manager can add holidays.')
    await audit(c, { action: 'holiday.save', entityType: 'holiday', entityId: String((row as { id: string }).id), after: parsed.data })
    return c.json(companyHoliday.parse(row), 201)
  })

  .delete('/holidays/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'hr.holidays.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`delete from company_holidays where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not remove that holiday.')
    if (!rows.length) fail(404, 'That holiday was not found.')
    await audit(c, { action: 'holiday.delete', entityType: 'holiday', entityId: id })
    return c.body(null, 204)
  })

  .get('/policy', async (c) => {
    const rows = await attempt(c, 'hr.policy.get', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ weekly_off: number[] }[]>`
        select weekly_off from attendance_policy where company_id = ${c.get('auth').companyId}`),
    )
    if (!rows) fail(400, 'We could not load the weekly off-days.')
    return c.json(attendancePolicy.parse({ weekly_off: (rows[0]?.weekly_off ?? []).map(Number) }))
  })

  .patch('/policy', async (c) => {
    const parsed = attendancePolicy.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick days of the week.')
    const row = await attempt(c, 'hr.policy.set', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ days: number[] }[]>`select set_weekly_off(${parsed.data.weekly_off}::smallint[]) as days`
        return r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not save the weekly off-days.')
    await audit(c, { action: 'attendance.weekly_off', entityType: 'company', entityId: c.get('auth').companyId, after: parsed.data })
    return c.json(attendancePolicy.parse({ weekly_off: row.days.map(Number) }))
  })

  // ── "I forgot to check in" ───────────────────────────────────
  .get('/corrections', async (c) => {
    const auth = c.get('auth')
    const team = c.req.query('scope') === 'team'
    const status = c.req.query('status')
    if (status && !['pending', 'approved', 'rejected'].includes(status)) fail(422, 'Unknown status.')
    const rows = await attempt(c, 'hr.corrections.list', () =>
      withUser(c.env, auth.userId, (sql) => sql`
        select a.id, a.user_id, u.name as user_name, a.a_date, a.check_in_at, a.check_out_at, a.reason,
               a.status, a.decision_note, a.created_at
          from attendance_corrections a
          join users u on u.user_id = a.user_id
         where ${team ? sql`true` : sql`a.user_id = ${auth.userId}`}
           and ${status ? sql`a.status = ${status}` : sql`true`}
         order by case when a.status = 'pending' then 0 else 1 end, a.a_date desc
         limit 300`),
    )
    if (!rows) fail(400, 'We could not load correction requests.')
    return c.json(attendanceCorrection.array().parse(rows))
  })

  .post('/corrections', async (c) => {
    const parsed = createCorrectionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the times.')
    const v = parsed.data
    const row = await attempt(c, 'hr.corrections.request', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ id: string }[]>`
          select request_attendance_correction(p_date => ${v.a_date}::date, p_check_in => ${v.check_in_at}::timestamptz,
                                               p_check_out => ${v.check_out_at ?? null}::timestamptz, p_reason => ${v.reason}) as id`
        return r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not send your request.')
    await audit(c, { action: 'attendance.correction_request', entityType: 'attendance', entityId: row.id, after: v })
    return c.json(idOnly.parse(row), 201)
  })

  .post('/corrections/:id/decide', async (c) => {
    const parsed = decideRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Approve or decline.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'hr.corrections.decide', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select decide_attendance_correction(p_id => ${id}, p_approve => ${parsed.data.approve}, p_note => ${parsed.data.note ?? null})`
        return true
      }),
    { onCode: explain })
    if (!ok) fail(400, 'We could not save that decision.')
    await audit(c, { action: parsed.data.approve ? 'attendance.correction_approve' : 'attendance.correction_reject', entityType: 'attendance', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .get('/attendance/my', async (c) => {
    const auth = c.get('auth')
    const monthRaw = c.req.query('month')
    const yearRaw = c.req.query('year')
    const month = monthRaw ? Number(monthRaw) : null
    const year = yearRaw ? Number(yearRaw) : null
    if (monthRaw && !(month && month >= 1 && month <= 12)) fail(422, 'Invalid month.')
    if (yearRaw && !(year && year >= 2000 && year <= 2100)) fail(422, 'Invalid year.')
    const rows = await attempt(c, 'hr.attendance_my', () =>
      withUser(
        c.env,
        auth.userId,
        (sql) => sql`
          select id, a_date, check_in_at, check_out_at, status, late_minutes
          from attendance where user_id = ${auth.userId}
            and ${month ? sql`extract(month from a_date)::int = ${month}` : sql`true`}
            and ${year ? sql`extract(year from a_date)::int = ${year}` : sql`true`}
          order by a_date desc limit 120`,
      ),
    )
    if (!rows) fail(400, 'We could not load attendance.')
    return c.json(list.parse(rows))
  })

  // One member's history for the /attendance/$uid stub. Self, owner, admin or
  // manager only — RLS still scopes the underlying read.
  .get('/attendance/user/:userId', requireModule('attendance'), async (c) => {
    const userId = uuidParam(c, 'userId')
    const auth = c.get('auth')
    const allowed =
      auth.isOwner || auth.role === 'admin' || auth.role === 'manager' || auth.userId === userId
    if (!allowed) fail(403, 'You do not have access to this record.')
    const monthRaw = c.req.query('month')
    const yearRaw = c.req.query('year')
    const month = monthRaw ? Number(monthRaw) : null
    const year = yearRaw ? Number(yearRaw) : null
    if (monthRaw && !(month && month >= 1 && month <= 12)) fail(422, 'Invalid month.')
    if (yearRaw && !(year && year >= 2000 && year <= 2100)) fail(422, 'Invalid year.')
    const rows = await attempt(c, 'hr.attendance_user', () =>
      withUser(
        c.env,
        auth.userId,
        (sql) => sql`
          select id, a_date, check_in_at, check_out_at, status, late_minutes
          from attendance where user_id = ${userId}
            and ${month ? sql`extract(month from a_date)::int = ${month}` : sql`true`}
            and ${year ? sql`extract(year from a_date)::int = ${year}` : sql`true`}
          order by a_date desc limit 120`,
      ),
    )
    if (!rows) fail(400, 'We could not load attendance.')
    return c.json(list.parse(rows))
  })

  // The whole team's day. RLS decides what comes back: an admin or manager
  // sees everyone, anyone else sees themselves — so this needs no gate of its
  // own beyond the module.
  //
  // Lovable parity: page/page_size/search/status are honoured on the server.
  // Without page/page_size the historical array shape is returned untouched.
  .get('/attendance', requireModule('attendance'), async (c) => {
    const date = c.req.query('date') ?? null
    if (date !== null && !DATE.test(date)) fail(422, 'Invalid date.')
    const pageRaw = c.req.query('page')
    const sizeRaw = c.req.query('page_size')
    const search = c.req.query('search')?.trim().toLowerCase() ?? ''
    const status = c.req.query('status')?.trim() ?? ''
    const type = c.req.query('type')?.trim() ?? ''
    if (type && !['in_house', 'freelancer'].includes(type)) fail(422, 'That engagement type is not one we use.')
    const paged = pageRaw !== undefined || sizeRaw !== undefined
    const page = Math.max(1, Number(pageRaw ?? 1) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(sizeRaw ?? 25) || 25))
    const offset = (page - 1) * pageSize

    // A day roster is one row per active member (tens of rows), so the status
    // filter — derived from the join, not stored — is applied in memory and
    // the page is sliced afterwards. No extra round trip, correct totals.
    const rows = await attempt(c, 'hr.attendance_day', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select u.user_id, u.name, u.email, u.phone, u.engagement_type,
                 coalesce(a.status, 'absent') as status,
                 a.check_in_at, a.check_out_at, a.corrected_by, a.correction_note,
                 coalesce(a.late_minutes, 0) as late_minutes,
                 on_leave(u.user_id, coalesce(${date}::date, (now() at time zone 'Asia/Kolkata')::date)) as on_leave,
                 day_off(u.company_id, coalesce(${date}::date, (now() at time zone 'Asia/Kolkata')::date)) as day_off
          from users u
          left join attendance a
            on a.user_id = u.user_id
           -- The studio's today (India), not the database's UTC date.
           and a.a_date = coalesce(${date}::date, (now() at time zone 'Asia/Kolkata')::date)
          where u.deleted_at is null and u.status = 'active'
            and ${search ? sql`(lower(u.name) like ${`%${search}%`} or lower(coalesce(u.email, '')) like ${`%${search}%`} or coalesce(u.phone, '') like ${`%${search}%`})` : sql`true`}
          order by u.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load attendance.')
    const items = attendanceDayRow.array().parse(rows)
    if (!paged && !status && !type) return c.json(items)
    // matchesRoster is the same function the dashboard used to apply in the
    // browser. `not_checked_out` is derived from the two timestamps rather
    // than stored, and one implementation of that rule is the only way a row's
    // badge and the filter that found it cannot disagree.
    const filtered = items.filter((r) => matchesRoster(r, { status, type }))
    if (!paged) return c.json(filtered)
    // Counted over the WHOLE filtered roster, before the page is cut. The
    // page used to compute these from whichever 25 rows it held, so a studio
    // of forty read "Total 25" on page one of its own attendance.
    const sum = summariseRoster(filtered)
    return c.json({
      items: filtered.slice(offset, offset + pageSize),
      total: filtered.length,
      page,
      page_size: pageSize,
      summary: {
        total: sum.total,
        present: sum.present,
        absent: sum.absent,
        not_checked_out: sum.notCheckedOut,
        on_leave: sum.onLeave,
        percent: sum.percent,
      },
    })
  })

  // Manual correction: the owner or an admin fixes a day for someone who
  // forgot to tap in, or tapped in from the wrong side of the fence. Recorded
  // as a correction on the row AND in the audit trail.
  .put('/attendance/:userId/:date', requireModule('attendance'), async (c) => {
    const userId = uuidParam(c, 'userId')
    const date = dateParam(c, 'date')
    const parsed = setAttendanceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the times and status.')
    const v = parsed.data
    const auth = c.get('auth')
    if (!auth.isOwner && auth.role !== 'admin') fail(403, 'You do not have access to this action.')

    const row = await attempt(
      c,
      'hr.attendance_correct',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const rows = await sql<{ id: string }[]>`
            select set_attendance_manual(
              p_user_id => ${userId},
              p_date => ${date}::date,
              p_status => ${v.status},
              p_check_in_at => ${v.check_in_at ?? null},
              p_check_out_at => ${v.check_out_at ?? null},
              p_note => ${v.note ?? null}
            ) as id`
          return rows[0] ?? null
        }),
      { onCode: (code, err) => (code === 'P0001' && rpcReason(err).includes('unknown_member') ? 'missing' : undefined) },
    )
    if (row === 'missing') fail(404, 'We could not find that team member.')
    if (!row) fail(400, 'We could not save the correction.')
    await audit(c, {
      action: 'attendance.correct',
      entityType: 'attendance',
      entityId: row.id,
      after: { user_id: userId, date, ...v },
    })
    return c.json(idOnly.parse(row))
  })

  .post('/check-out', async (c) => {
    const id = await attempt(
      c,
      'hr.check_out',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ id: string }[]>`select check_out() as id`
          return rows[0]?.id ?? null
        }),
      { onCode: (code, err) => (code === 'P0001' && rpcReason(err).includes('no_open_check_in') ? 'no_open' : undefined) },
    )
    if (id === 'no_open') fail(422, 'You have not checked in today, or you already checked out.')
    if (!id) fail(400, 'We could not record your check-out.')
    await audit(c, { action: 'attendance.check_out', entityType: 'attendance', entityId: id })
    return c.json(idOnly.parse({ id }))
  })

  .get('/location', async (c) => {
    const row = await attempt(c, 'hr.location', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          select lat, lng, radius_m, timezone, is_active,
                 expected_checkin_time, late_grace_minutes, missed_cutoff_time
            from company_location`
        return rows[0] ?? null
      }),
    )
    return c.json(row ? companyFence.parse(row) : null)
  })

  // Owner-only, and enforced by the company_location RLS policy rather than a
  // check here: the function runs as the caller precisely so that holds.
  .patch('/location', async (c) => {
    const parsed = setFenceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the location and radius.')
    const v = parsed.data

    const row = await attempt(c, 'hr.location_set', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          select * from set_company_location(
            ${v.lat}, ${v.lng}, ${v.radius_m}, ${v.timezone}, ${v.is_active},
            ${v.expected_checkin_time}::time, ${v.late_grace_minutes}, ${v.missed_cutoff_time}::time)`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(403, 'Only the studio owner can set the attendance location.')
    await audit(c, { action: 'attendance.fence_set', entityType: 'company_location', after: v })
    return c.json(companyFence.parse(row))
  })

  .post('/check-in', async (c) => {
    const parsed = checkInRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Location is required to check in.')
    const id = await attempt(
      c,
      'hr.check_in',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ id: string }[]>`
            select check_in(p_lat => ${parsed.data.lat}, p_lng => ${parsed.data.lng}) as id`
          return rows[0]?.id ?? null
        }),
      { onCode: (code, err) => (code === 'P0001' && rpcReason(err).includes('outside_fence') ? 'outside' : undefined) },
    )
    if (id === 'outside') fail(422, 'You are too far from the studio to check in.')
    if (!id) fail(400, 'We could not record your check-in.')
    await audit(c, { action: 'attendance.check_in', entityType: 'attendance', entityId: id })
    return c.json(idOnly.parse({ id }), 201)
  })

  // ── Attendance Streak ────────────────────────────────────────
  .get('/attendance/streak', async (c) => {
    const rows = await attempt(c, 'hr.attendance_streak', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const result = await sql<{ get_attendance_streak: unknown }[]>`
          select get_attendance_streak() as get_attendance_streak`
        return rpcJson(result[0]?.get_attendance_streak, { streak: 0, last_check_date: null })
      }),
    )
    if (!rows) fail(400, 'We could not load your streak.')
    return c.json(rows)
  })

  // (Auto check-in was removed: it marked someone present from anywhere,
  // skipping the location check and the lateness rules, and nothing used it.)
