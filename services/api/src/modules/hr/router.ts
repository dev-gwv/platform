import { Hono, type Context } from 'hono'
import {
  attendanceDayRow,
  attendancePlace,
  attendancePlaceInput,
  attendanceRecord,
  attendanceRule,
  attendanceRuleInput,
  checkInRequest,
  checkOutRequest,
  myAttendanceToday,
  companyFence,
  setAttendanceRequest,
  setFenceRequest,
  z,
  leaveRequest,
  createLeaveRequest,
  decideRequest,
  companyHoliday,
  createHolidayRequest,
  attendanceSettings,
  updateAttendanceSettings,
  checkInResponse,
  todayBoard,
  monthRegister,
  resolveLinkRequest,
  resolvedPin,
  attendanceCorrection,
  createCorrectionRequest,
} from '@ipc/contracts'
import { coordsFromText, isMapsHost, matchesRoster, summariseRoster } from '@ipc/domain'
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

/** The studio's attendance settings as the app reads them; defaults when none are saved. */
async function readSettings(c: Context<AppEnv>) {
  const rows = await attempt(c, 'hr.policy.get', () =>
    withUser(c.env, c.get('auth').userId, (sql) => sql`
      select weekly_off, enabled, enabled_at, to_char(day_start, 'HH24:MI') as day_start, grace_min,
             to_char(day_end, 'HH24:MI') as day_end, half_day_hours::float8 as half_day_hours,
             selfie_required, late_marks_per_half_day
        from attendance_policy where company_id = ${c.get('auth').companyId}`),
  )
  if (!rows) return null
  const r = rows[0]
  return attendanceSettings.parse({
    weekly_off: ((r?.weekly_off as number[] | undefined) ?? []).map(Number),
    enabled: r?.enabled ?? false,
    enabled_at: r?.enabled_at ?? null,
    day_start: r?.day_start ?? null,
    grace_min: r?.grace_min ?? 15,
    day_end: r?.day_end ?? null,
    half_day_hours: r?.half_day_hours ?? null,
    selfie_required: r?.selfie_required ?? false,
    late_marks_per_half_day: r?.late_marks_per_half_day ?? 0,
  })
}

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

  // Everything the owner sets about attendance (0224). Anyone in the studio
  // may read it -- the app needs the hours -- but only the owner changes it,
  // except the weekly off-days, which admins and managers keep as before.
  .get('/policy', async (c) => {
    const out = await readSettings(c)
    if (!out) fail(400, 'We could not load the attendance settings.')
    return c.json(out)
  })

  .patch('/policy', async (c) => {
    const parsed = updateAttendanceSettings.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the attendance settings.')
    const v = parsed.data
    const auth = c.get('auth')
    const onlyWeeklyOff = Object.keys(v).every((k) => k === 'weekly_off')
    if (!onlyWeeklyOff && !auth.isOwner) fail(403, 'Only the studio owner can change attendance settings.')
    const ok = await attempt(c, 'hr.policy.set', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (v.weekly_off) await sql`select set_weekly_off(${v.weekly_off}::smallint[])`
        if (onlyWeeklyOff) return true
        const [cur] = await sql`
          select enabled, to_char(day_start, 'HH24:MI') as day_start, grace_min, to_char(day_end, 'HH24:MI') as day_end,
                 half_day_hours::float8 as half_day_hours, selfie_required, late_marks_per_half_day
            from attendance_policy where company_id = get_current_company_id()`
        const pick = <K extends keyof typeof v>(k: K, fallback: unknown) => (v[k] !== undefined ? v[k] : fallback)
        await sql`
          select set_attendance_policy(
            ${pick('enabled', cur?.enabled ?? false) as boolean},
            ${pick('day_start', cur?.day_start ?? null) as string | null}::time,
            ${pick('grace_min', cur?.grace_min ?? 15) as number},
            ${pick('day_end', cur?.day_end ?? null) as string | null}::time,
            ${pick('half_day_hours', cur?.half_day_hours ?? null) as number | null},
            ${pick('selfie_required', cur?.selfie_required ?? false) as boolean},
            ${pick('late_marks_per_half_day', cur?.late_marks_per_half_day ?? 0) as number})`
        return true
      }),
    {
      onCode: (code, err) => {
        if (code === 'P0001' && rpcReason(err).includes('bad_hours')) fail(422, 'The day has to end after it starts.')
        return explain(code, err)
      },
    })
    if (!ok) fail(400, 'We could not save the attendance settings.')
    await audit(c, { action: onlyWeeklyOff ? 'attendance.weekly_off' : 'attendance.settings', entityType: 'company', entityId: auth.companyId, after: v })
    const out = await readSettings(c)
    if (!out) fail(400, 'We could not load the attendance settings.')
    return c.json(out)
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
          select a.id, a.a_date, a.check_in_at, a.check_out_at, a.status, a.late_minutes,
                 p.name as place_name, a.check_in_distance_m, a.source, a.closed_by_system
          from attendance a left join attendance_places p on p.id = a.check_in_place_id
          where a.user_id = ${auth.userId}
            and ${month ? sql`extract(month from a.a_date)::int = ${month}` : sql`true`}
            and ${year ? sql`extract(year from a.a_date)::int = ${year}` : sql`true`}
          order by a.a_date desc limit 120`,
      ),
    )
    if (!rows) fail(400, 'We could not load attendance.')
    return c.json(list.parse(rows))
  })

  // Today, and the rule that decides it (0206): what the app needs to mark
  // someone by itself, and to say why it has not.
  .get('/attendance/me', async (c) => {
    const auth = c.get('auth')
    const out = await attempt(c, 'hr.attendance_me', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [rule] = await sql<{ mode: 'required' | 'anywhere' | 'off'; place_name: string | null; rule_from: string; tz: string }[]>`
          select mode, place_name, rule_from, tz from attendance_rule_for(${auth.userId})`
        const tz = rule?.tz ?? 'Asia/Kolkata'
        const [today] = await sql`
          select a.id, a.a_date, a.check_in_at, a.check_out_at, a.status, a.late_minutes,
                 p.name as place_name, a.check_in_distance_m, a.source, a.closed_by_system, a.accuracy_m, a.selfie_file_id
            from attendance a left join attendance_places p on p.id = a.check_in_place_id
           where a.user_id = ${auth.userId} and a.a_date = (now() at time zone ${tz})::date`
        const [ctx] = await sql<{
          enabled: boolean; fenced: boolean; day_off: string | null; on_leave: boolean
          selfie_required: boolean | null; day_start: string | null; grace: number | null; day_end: string | null
        }[]>`
          select attendance_enabled(get_current_company_id(), (now() at time zone ${tz})::date) as enabled,
                 exists (select 1 from attendance_places where company_id = get_current_company_id() and is_active) as fenced,
                 day_off(get_current_company_id(), (now() at time zone ${tz})::date) as day_off,
                 on_leave(${auth.userId}, (now() at time zone ${tz})::date) as on_leave,
                 (select selfie_required from attendance_policy where company_id = get_current_company_id()) as selfie_required,
                 (select to_char(r.expected, 'HH24:MI') from attendance_rule_for(${auth.userId}) r) as day_start,
                 (select r.grace from attendance_rule_for(${auth.userId}) r) as grace,
                 (select to_char(day_end, 'HH24:MI') from attendance_policy where company_id = get_current_company_id()) as day_end`
        const [shoot] = await sql`
          select t.id as slot_id, coalesce(sh.name, t.service_name, 'Shoot') as name, t.start_at, t.end_at, t.arrived_at
            from team_assignment_slots t left join shoots sh on sh.id = t.shoot_id
           where t.user_id = ${auth.userId} and t.status = 'booked' and t.shoot_id is not null
             and t.start_at < (((now() at time zone ${tz})::date + 1)::timestamp at time zone ${tz})
             and t.end_at > (((now() at time zone ${tz})::date)::timestamp at time zone ${tz})
           order by t.start_at limit 1`
        return { rule, today: today ?? null, ctx, shoot: shoot ?? null }
      }),
    )
    if (!out?.rule || !out.ctx) fail(400, 'We could not load your attendance.')
    return c.json(
      myAttendanceToday.parse({
        today: out.today,
        mode: out.rule.mode,
        place_name: out.rule.place_name,
        rule_from: out.rule.rule_from,
        // "Configured" now means switched on (0224): off, nothing to mark.
        configured: out.ctx.enabled,
        enabled: out.ctx.enabled,
        selfie_required: out.ctx.selfie_required ?? false,
        day_start: out.ctx.day_start,
        grace_min: out.ctx.grace ?? 15,
        day_end: out.ctx.day_end,
        fenced: out.ctx.fenced,
        day_off: out.ctx.day_off,
        on_leave: out.ctx.on_leave,
        shoot_today: out.shoot,
      }),
    )
  })

  // ── Places and rules (0206). Owner-only writes, enforced by RLS. ─────
  .get('/places', async (c) => {
    const rows = await attempt(c, 'hr.places', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, name, lat, lng, radius_m, is_active, is_primary
          from attendance_places order by is_primary desc, name`),
    )
    if (!rows) fail(400, 'We could not load places.')
    return c.json(attendancePlace.array().parse(rows))
  })

  .post('/places', async (c) => {
    if (!c.get('auth').isOwner) fail(403, 'Only the studio owner can change places.')
    const parsed = attendancePlaceInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please give the place a name, a pin and a radius between 20 m and 5 km.')
    const v = parsed.data
    const rows = await attempt(c, 'hr.place_add', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        insert into attendance_places (company_id, name, lat, lng, radius_m, is_active)
        values (get_current_company_id(), ${v.name}, ${v.lat}, ${v.lng}, ${v.radius_m}, ${v.is_active})
        returning id, name, lat, lng, radius_m, is_active, is_primary`),
    )
    if (!rows?.[0]) fail(400, 'We could not add that place.')
    await audit(c, { action: 'attendance.place_add', entityType: 'attendance_place', entityId: rows[0].id as string, after: v })
    return c.json(attendancePlace.parse(rows[0]), 201)
  })

  .patch('/places/:id', async (c) => {
    if (!c.get('auth').isOwner) fail(403, 'Only the studio owner can change places.')
    const id = uuidParam(c)
    const parsed = attendancePlaceInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please give the place a name, a pin and a radius between 20 m and 5 km.')
    const v = parsed.data
    const rows = await attempt(c, 'hr.place_edit', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        update attendance_places
           set name = ${v.name}, lat = ${v.lat}, lng = ${v.lng}, radius_m = ${v.radius_m},
               is_active = ${v.is_active}, updated_at = now()
         where id = ${id}
        returning id, name, lat, lng, radius_m, is_active, is_primary`),
    )
    if (!rows) fail(400, 'We could not save that place.')
    if (!rows[0]) fail(404, 'That place was not found, or it is the studio itself (change it on the location card).')
    await audit(c, { action: 'attendance.place_edit', entityType: 'attendance_place', entityId: id, after: v })
    return c.json(attendancePlace.parse(rows[0]))
  })

  .delete('/places/:id', async (c) => {
    if (!c.get('auth').isOwner) fail(403, 'Only the studio owner can change places.')
    const id = uuidParam(c)
    const rows = await attempt(c, 'hr.place_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`delete from attendance_places where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not remove that place.')
    if (!rows[0]) fail(404, 'That place was not found, or it is the studio itself.')
    await audit(c, { action: 'attendance.place_delete', entityType: 'attendance_place', entityId: id })
    return c.body(null, 204)
  })

  .get('/rules', async (c) => {
    const rows = await attempt(c, 'hr.rules', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select r.id, r.scope, r.role_id, r.user_id,
               coalesce(er.type_name, u.name, 'Unknown') as label,
               r.mode, r.place_id, r.radius_m,
               to_char(r.expected_checkin_time, 'HH24:MI') as expected_checkin_time, r.late_grace_minutes
          from attendance_rules r
          left join employee_roles er on er.id = r.role_id
          left join users u on u.user_id = r.user_id
         order by r.scope, label`),
    )
    if (!rows) fail(400, 'We could not load the attendance rules.')
    return c.json(attendanceRule.array().parse(rows))
  })

  // One rule per position or person: saving again replaces it.
  .put('/rules', async (c) => {
    if (!c.get('auth').isOwner) fail(403, 'Only the studio owner can change attendance rules.')
    const parsed = attendanceRuleInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the rule.')
    const v = parsed.data
    const id = await attempt(c, 'hr.rule_set', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`
          delete from attendance_rules
           where ${v.scope === 'role' ? sql`scope = 'role' and role_id = ${v.role_id!}` : sql`scope = 'user' and user_id = ${v.user_id!}`}`
        const [r] = await sql<{ id: string }[]>`
          insert into attendance_rules (company_id, scope, role_id, user_id, mode, place_id, radius_m,
                                        expected_checkin_time, late_grace_minutes)
          select get_current_company_id(), ${v.scope}, ${v.role_id ?? null}, ${v.user_id ?? null}, ${v.mode},
                 ${v.place_id ?? null}, ${v.radius_m ?? null}, ${v.expected_checkin_time ?? null}::time,
                 ${v.late_grace_minutes ?? null}
           -- Only this studio's own positions, people and places.
           where (${v.role_id ?? null}::uuid is null
                  or exists (select 1 from employee_roles where id = ${v.role_id ?? null} and company_id = get_current_company_id()))
             and (${v.user_id ?? null}::uuid is null
                  or exists (select 1 from users where user_id = ${v.user_id ?? null} and company_id = get_current_company_id()))
             and (${v.place_id ?? null}::uuid is null
                  or exists (select 1 from attendance_places where id = ${v.place_id ?? null}))
          returning id`
        return r?.id ?? null
      }),
    )
    if (!id) fail(422, 'That position, person or place is not part of this studio.')
    await audit(c, { action: 'attendance.rule_set', entityType: 'attendance_rule', entityId: id, after: v })
    return c.json({ id })
  })

  .delete('/rules/:id', async (c) => {
    if (!c.get('auth').isOwner) fail(403, 'Only the studio owner can change attendance rules.')
    const id = uuidParam(c)
    const rows = await attempt(c, 'hr.rule_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`delete from attendance_rules where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not remove that rule.')
    if (!rows[0]) fail(404, 'That rule was not found.')
    await audit(c, { action: 'attendance.rule_delete', entityType: 'attendance_rule', entityId: id })
    return c.body(null, 204)
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
                 (select p.name from attendance_places p where p.id = a.check_in_place_id) as place_name,
                 a.check_in_distance_m, a.source, coalesce(a.closed_by_system, false) as closed_by_system,
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
    const where = checkOutRequest.safeParse(await c.req.json().catch(() => ({})))
    const at = where.success ? where.data : {}
    const id = await attempt(
      c,
      'hr.check_out',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ id: string }[]>`select check_out(${at.lat ?? null}, ${at.lng ?? null}) as id`
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
    const v = parsed.data
    const row = await attempt(
      c,
      'hr.check_in',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql`
            select * from check_in(p_lat => ${v.lat}, p_lng => ${v.lng}, p_auto => ${v.auto ?? false},
                                   p_accuracy => ${v.accuracy_m ?? null}, p_selfie => ${v.selfie_file_id ?? null})`
          return rows[0] ?? null
        }),
      {
        onCode: (code, err) => {
          if (code !== 'P0001') return undefined
          const why = rpcReason(err)
          const after = (k: string) => why.replace(new RegExp(`^.*${k}:\\s*`), '').trim()
          if (why.includes('not_enabled')) fail(422, 'Attendance is not switched on for your studio.')
          if (why.includes('not_tracked')) fail(422, 'Attendance is not tracked for you.')
          if (why.includes('too_rough')) {
            fail(422, `Your phone's location is too rough right now (±${after('too_rough')}). Turn on GPS or step outside, then try again.`)
          }
          if (why.includes('selfie_needed')) fail(422, 'Take a selfie to check in.')
          if (why.includes('bad_selfie')) fail(422, 'That selfie could not be used. Take it again.')
          if (why.includes('outside_fence')) fail(422, `You're ${after('outside_fence')}. You'll be marked once you're inside.`)
          return undefined
        },
      },
    )
    if (!row) fail(400, 'We could not record your check-in.')
    const out = checkInResponse.parse(row)
    await audit(c, { action: 'attendance.check_in', entityType: 'attendance', entityId: out.id })
    return c.json(out, 201)
  })

  // ── The owner's Today board (0224): everyone the studio tracks, today ──
  .get('/today', requireModule('attendance'), async (c) => {
    const auth = c.get('auth')
    if (!auth.isOwner && auth.role !== 'admin' && auth.role !== 'manager') fail(403, 'You do not have access to this.')
    const date = c.req.query('date') ?? null
    if (date !== null && !DATE.test(date)) fail(422, 'Invalid date.')
    const out = await attempt(c, 'hr.today', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [d] = await sql<{ day: string; enabled: boolean; day_off: string | null; tz: string }[]>`
          select coalesce(${date}::date, (now() at time zone attendance_tz(get_current_company_id()))::date)::text as day,
                 attendance_enabled(get_current_company_id(), coalesce(${date}::date, (now() at time zone attendance_tz(get_current_company_id()))::date)) as enabled,
                 day_off(get_current_company_id(), coalesce(${date}::date, (now() at time zone attendance_tz(get_current_company_id()))::date)) as day_off,
                 attendance_tz(get_current_company_id()) as tz`
        const day = d!.day
        const tz = d!.tz
        const rows = await sql`
          select u.user_id, u.name, u.avatar_url,
                 a.status, a.check_in_at, a.check_out_at, coalesce(a.late_minutes, 0) as late_minutes,
                 p.name as place_name, a.check_in_distance_m as distance_m, a.accuracy_m, a.selfie_file_id,
                 a.source, coalesce(a.closed_by_system, false) as closed_by_system,
                 (select case when lr.half_day then 'half' else 'full' end from leave_requests lr
                   where lr.user_id = u.user_id and lr.status = 'approved' and ${day}::date between lr.start_date and lr.end_date
                   limit 1) as leave,
                 (select jsonb_build_object('name', coalesce(sh.name, t.service_name, 'Shoot'), 'start_at', t.start_at,
                                            'end_at', t.end_at, 'arrived_at', t.arrived_at)
                    from team_assignment_slots t left join shoots sh on sh.id = t.shoot_id
                   where t.user_id = u.user_id and t.status = 'booked' and t.shoot_id is not null
                     and t.start_at < ((${day}::date + 1)::timestamp at time zone ${tz})
                     and t.end_at > (${day}::date::timestamp at time zone ${tz})
                   order by t.start_at limit 1) as shoot,
                 to_char(r.expected, 'HH24:MI') as expected, coalesce(r.grace, 15) as grace
            from users u
            cross join lateral attendance_rule_for(u.user_id) r
            left join attendance a on a.user_id = u.user_id and a.a_date = ${day}::date
            left join attendance_places p on p.id = a.check_in_place_id
           where u.deleted_at is null and u.status = 'active' and u.role <> 'super_admin'
             and r.mode <> 'off'
           order by u.name`
        return { day, enabled: d!.enabled, day_off: d!.day_off, rows }
      }),
    )
    if (!out) fail(400, 'We could not load today.')
    return c.json(
      todayBoard.parse({
        date: out.day,
        enabled: out.enabled,
        day_off: out.day_off,
        rows: out.rows.map((r) => ({ ...r, shoot: r.shoot ?? null })),
      }),
    )
  })

  // ── The month register (0224): one code per person per day ────────────
  // Managers see everyone the studio tracks; anyone else (?user=me), only
  // themselves.
  .get('/register', async (c) => {
    const auth = c.get('auth')
    const month = c.req.query('month') ?? ''
    if (!/^\d{4}-\d{2}$/.test(month)) fail(422, 'Pick a month (YYYY-MM).')
    const mine = c.req.query('user') === 'me'
    const manager = auth.isOwner || auth.role === 'admin' || auth.role === 'manager'
    if (!mine && !(manager && auth.access.hasModule('attendance'))) fail(403, 'You do not have access to this.')
    const first = `${month}-01`
    const out = await attempt(c, 'hr.register', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [ctx] = await sql<{ tz: string; today: string; tracked_from: string | null; marks: number }[]>`
          select attendance_tz(get_current_company_id()) as tz,
                 ((now() at time zone attendance_tz(get_current_company_id()))::date)::text as today,
                 (select case when p.enabled and p.enabled_at is not null
                              then ((p.enabled_at at time zone attendance_tz(get_current_company_id()))::date)::text end
                    from attendance_policy p where p.company_id = get_current_company_id()) as tracked_from,
                 coalesce((select late_marks_per_half_day from attendance_policy where company_id = get_current_company_id()), 0) as marks`
        const rows = await sql<{
          user_id: string; name: string; day: string; status: string | null; source: string | null
          day_off: string | null; leave: 'full' | 'half' | null; leave_unpaid: boolean | null; shoot: boolean
        }[]>`
          select u.user_id, u.name, g.d::date::text as day, a.status, a.source,
                 day_off(u.company_id, g.d::date) as day_off,
                 lv.leave, lv.unpaid as leave_unpaid,
                 booked_on_shoot(u.user_id, g.d::date, ${ctx!.tz}) as shoot
            from users u
            cross join lateral attendance_rule_for(u.user_id) r
            cross join generate_series(${first}::date, (${first}::date + interval '1 month - 1 day')::date, interval '1 day') g(d)
            left join attendance a on a.user_id = u.user_id and a.a_date = g.d::date
            left join lateral (
              select case when lr.half_day then 'half' else 'full' end as leave, lr.kind = 'unpaid' as unpaid
                from leave_requests lr
               where lr.user_id = u.user_id and lr.status = 'approved' and g.d::date between lr.start_date and lr.end_date
               limit 1) lv on true
           where u.deleted_at is null and u.status = 'active' and u.role <> 'super_admin'
             and r.mode <> 'off'
             and ${mine ? sql`u.user_id = ${auth.userId}` : sql`true`}
           order by u.name, g.d`
        return { ctx: ctx!, rows }
      }),
    )
    if (!out) fail(400, 'We could not load the register.')
    const people = new Map<string, { user_id: string; name: string; cells: unknown[] }>()
    for (const r of out.rows) {
      const p = people.get(r.user_id) ?? { user_id: r.user_id, name: r.name, cells: [] }
      p.cells.push({ day: r.day, status: r.status, source: r.source, day_off: r.day_off, leave: r.leave, leave_unpaid: !!r.leave_unpaid, shoot: r.shoot })
      people.set(r.user_id, p)
    }
    return c.json(
      monthRegister.parse({
        month,
        tracked_from: out.ctx.tracked_from,
        today: out.ctx.today,
        late_marks_per_half_day: out.ctx.marks,
        people: [...people.values()],
      }),
    )
  })

  // A Google Maps link (or "lat, lng") into a pin. Short links are followed
  // here -- Google's hosts only, at most five hops, three seconds each --
  // because they carry no coordinates until they are opened.
  .post('/places/resolve-link', async (c) => {
    if (!c.get('auth').isOwner) fail(403, 'Only the studio owner can change places.')
    const parsed = resolveLinkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Paste a Google Maps link.')
    const NO_PIN = 'That link has no pin. Open it, press and hold the exact spot, and share that link.'
    let text = parsed.data.url
    for (let hop = 0; hop <= 5; hop++) {
      const pin = coordsFromText(text)
      if (pin) return c.json(resolvedPin.parse(pin))
      let url: URL
      try {
        url = new URL(text)
      } catch {
        fail(422, NO_PIN)
      }
      if (url.protocol !== 'https:' || !isMapsHost(url.hostname) || hop === 5) fail(422, NO_PIN)
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) }).catch(() => null)
      const next = res?.headers.get('location')
      if (!next) fail(422, NO_PIN)
      text = new URL(next, url).toString()
    }
    fail(422, NO_PIN)
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
