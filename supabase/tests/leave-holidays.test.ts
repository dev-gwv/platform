import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Leave, holidays and attendance corrections (0177): a member asks, a manager
 * decides, both are told; the nightly sweep never marks a holiday, a weekly
 * off or an approved leave day absent; an approved correction becomes the
 * day's attendance with lateness worked out.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'c0000000-0000-4000-8000-000000000001'
const PRIYA = 'c0000000-0000-4000-8000-000000000002'
const AMAN = 'c0000000-0000-4000-8000-000000000003'
const COMPANY = 'c0000000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)
const fails = async (sql: string) => {
  try {
    await db.query(sql)
  } catch (e) {
    return (e as Error).message
  }
  return null
}
/** The day the sweep marks: the one just ended in India. */
const SWEPT = `((now() at time zone 'Asia/Kolkata') - interval '12 hours')::date`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test'), ('${AMAN}', 'a@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, created_at) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test', '2020-01-01'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test', '2020-01-01'),
      ('${AMAN}', '${COMPANY}', 'employee', 'Aman', 'a@s.test', '2020-01-01');
    insert into company_location (company_id, lat, lng, radius_m, timezone, expected_checkin_time, late_grace_minutes)
      values ('${COMPANY}', 19.07, 72.87, 150, 'Asia/Kolkata', '10:00', 15);
  `)
})

describe('leave', () => {
  it('a member asks; the owner is told; the member cannot approve it', async () => {
    await as(PRIYA)
    const [{ id }] = (await q<{ id: string }>(`select request_leave('sick', '2026-10-05', '2026-10-06', false, 'Fever') as id`)) as [{ id: string }]
    expect(await fails(`select decide_leave('${id}', true, null)`)).toMatch(/not allowed/)
    expect(await fails(`select request_leave('casual', '2026-10-06', '2026-10-07', false, null)`)).toMatch(/already have leave/)
    await as(OWNER)
    const told = await q<{ title: string }>(`select title from notifications where recipient_uid = '${OWNER}' and type = 'leave.requested'`)
    expect(told).toEqual([{ title: 'Priya asked for leave' }])
    expect(await fails(`select decide_leave('${id}', false, '')`)).toMatch(/say why/)
    await q(`select decide_leave('${id}', true, 'Get well')`)
    const [r] = await q<{ status: string; ok: boolean }>(`select status, on_leave('${PRIYA}', '2026-10-06') as ok from leave_requests where id = '${id}'`)
    expect(r).toEqual({ status: 'approved', ok: true })
    const heard = await q<{ title: string }>(`select title from notifications where recipient_uid = '${PRIYA}' and type = 'leave.decided'`)
    expect(heard).toEqual([{ title: 'Leave approved' }])
  })

  it('lets the member take back a pending request, not someone else', async () => {
    await as(AMAN)
    const [{ id }] = (await q<{ id: string }>(`select request_leave('casual', '2026-11-10', '2026-11-10', true, null) as id`)) as [{ id: string }]
    await as(PRIYA)
    expect(await fails(`select cancel_leave('${id}')`)).toMatch(/cannot be cancelled/)
    await as(AMAN)
    await q(`select cancel_leave('${id}')`)
    expect((await q<{ status: string }>(`select status from leave_requests where id = '${id}'`))[0]!.status).toBe('cancelled')
    await as(OWNER)
  })
})

describe('holidays, weekly off and the nightly sweep', () => {
  it('names the reason a day is off', async () => {
    await q(`insert into company_holidays (company_id, holiday_date, name) values ('${COMPANY}', '2026-10-20', 'Diwali')`)
    await q(`select set_weekly_off(array[0]::smallint[])`)
    const [r] = await q<{ h: string; s: string; w: string | null }>(`
      select day_off('${COMPANY}', '2026-10-20') as h, day_off('${COMPANY}', '2026-10-18') as s, day_off('${COMPANY}', '2026-10-19') as w`)
    expect(r).toEqual({ h: 'Diwali', s: 'Weekly off', w: null })
  })

  it('skips anyone on approved leave, and the whole studio on a holiday', async () => {
    await q(`select set_weekly_off('{}'::smallint[])`)
    await q(`delete from company_holidays`)
    await q(`delete from attendance`)
    // Aman on approved leave for the swept day.
    await q(`insert into leave_requests (company_id, user_id, kind, start_date, end_date, status)
             values ('${COMPANY}', '${AMAN}', 'casual', ${SWEPT}, ${SWEPT}, 'approved')`)
    await q(`select mark_absent_backstop()`)
    const marked = await q<{ user_id: string }>(`select user_id from attendance where status = 'absent'`)
    expect(marked.map((m) => m.user_id)).toEqual([PRIYA])

    await q(`delete from attendance`)
    await q(`insert into company_holidays (company_id, holiday_date, name) values ('${COMPANY}', ${SWEPT}, 'Studio day off')`)
    await q(`select mark_absent_backstop()`)
    expect(await q(`select 1 from attendance`)).toHaveLength(0)
  })

  it('only managers set the weekly off', async () => {
    await as(PRIYA)
    expect(await fails(`select set_weekly_off(array[6]::smallint[])`)).toMatch(/not allowed/)
    await as(OWNER)
  })
})

describe('attendance corrections', () => {
  it('a member asks to fix a day; once approved it is the day, late if after the start time', async () => {
    await q(`delete from attendance`)
    await as(PRIYA)
    const day = (await q<{ d: string }>(`select ((now() at time zone 'Asia/Kolkata')::date - 2)::text as d`))[0]!.d
    const [{ id }] = (await q<{ id: string }>(
      `select request_attendance_correction('${day}', ('${day} 10:40' ::timestamp at time zone 'Asia/Kolkata'), ('${day} 19:00'::timestamp at time zone 'Asia/Kolkata'), 'Phone died at the gate') as id`,
    )) as [{ id: string }]
    expect(await fails(`select request_attendance_correction('${day}', now(), null, 'again please')`)).toMatch(/already asked/)
    expect(await fails(`select decide_attendance_correction('${id}', true, null)`)).toMatch(/not allowed/)
    await as(OWNER)
    await q(`select decide_attendance_correction('${id}', true, 'OK')`)
    const [a] = await q<{ status: string; late_minutes: number }>(`select status, late_minutes from attendance where user_id = '${PRIYA}' and a_date = '${day}'`)
    // Past the 15 minutes' grace, so late -- counted from 10:00, as check-in does.
    expect(a).toEqual({ status: 'late', late_minutes: 40 })
    const heard = await q<{ title: string }>(`select title from notifications where recipient_uid = '${PRIYA}' and type = 'attendance.correction_decided'`)
    expect(heard[0]!.title).toMatch(/^Attendance fixed for /)
  })
})
