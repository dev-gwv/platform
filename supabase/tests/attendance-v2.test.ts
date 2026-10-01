import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0224: attendance v2. Off until the owner turns it on; then accuracy, a
 * selfie when asked, half days, shoot days through "I've reached", the day
 * end, payroll that counts only tracked days, reminders and the selfie purge.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a7000000-0000-4000-8000-000000000001'
const RAVI = 'a7000000-0000-4000-8000-000000000002'
const MEERA = 'a7000000-0000-4000-8000-000000000003'
const COMPANY = 'a7000000-0000-4000-8000-0000000000aa'
const CLIENT = 'a7000000-0000-4000-8000-0000000000c1'
const PROJECT = 'a7000000-0000-4000-8000-0000000000c2'
const SHOOT = 'a7000000-0000-4000-8000-0000000000c3'
// The studio in Mumbai, a spot ~250 m east of it, and somewhere far away.
const STUDIO = [19.076, 72.8777] as const
const NEAR = [19.076, 72.8801] as const
const FAR = [28.6, 77.2] as const
const TODAY = `(now() at time zone 'Asia/Kolkata')::date`

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = async <T>(user: string, sql: string) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await q<T>(sql)
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
  }
}
const fails = (user: string, sql: string) =>
  as(user, sql).then(
    () => null,
    (e: Error) => e.message,
  )
const checkIn = (user: string, [lat, lng]: readonly [number, number], accuracy: number | null = null, selfie: string | null = null) =>
  as<{ id: string; status: string; late_minutes: number; place_name: string | null; distance_m: number | null }>(
    user,
    `select * from check_in(${lat}, ${lng}, false, ${accuracy ?? 'null'}, ${selfie ? `'${selfie}'` : 'null'})`,
  )
const tryIn = (user: string, at: readonly [number, number], accuracy: number | null = null, selfie: string | null = null) =>
  checkIn(user, at, accuracy, selfie).then(
    () => null,
    (e: Error) => e.message,
  )
const policy = (set: string) => db.exec(`update attendance_policy set ${set} where company_id = '${COMPANY}'`)
const file = async (by: string, ago = '1 minute', mime = 'image/jpeg') =>
  (await q<{ id: string }>(
    `insert into files (company_id, name, mime, size_bytes, bytes, created_by, created_at)
     values ('${COMPANY}', 'selfie.jpg', '${mime}', 3, '\\x010203', '${by}', now() - interval '${ago}') returning id`,
  ))[0]!.id

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${RAVI}', 'r@s.test'), ('${MEERA}', 'm@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, status, engagement_type, salary, created_at) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'o@s.test', 'active', 'in_house', null, '2020-01-01'),
      ('${RAVI}', '${COMPANY}', 'employee', 'Ravi', 'r@s.test', 'active', 'in_house', 25000, '2020-01-01'),
      ('${MEERA}', '${COMPANY}', 'employee', 'Meera', 'm@s.test', 'active', 'in_house', 25000, '2020-01-01');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
    insert into shoots (id, company_id, project_id, name, shoot_date, location) values
      ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Haldi', ${TODAY}, 'Jaipur');
    insert into company_location (company_id, lat, lng, radius_m, timezone) values ('${COMPANY}', ${STUDIO[0]}, ${STUDIO[1]}, 150, 'Asia/Kolkata');
    grant usage on schema auth to authenticated;
  `)
})

beforeEach(async () => {
  await db.exec(`
    update attendance set selfie_file_id = null;
    delete from attendance; delete from files; delete from notifications; delete from team_assignment_slots;
    delete from leave_requests; delete from payroll_lines; delete from payroll_runs;
    insert into attendance_policy (company_id, enabled, enabled_at) values ('${COMPANY}', true, '2020-01-01')
      on conflict (company_id) do update
        set enabled = true, enabled_at = '2020-01-01', day_start = null, grace_min = 15, day_end = null,
            half_day_hours = null, selfie_required = false, late_marks_per_half_day = 0, weekly_off = '{}';
    update company_location set expected_checkin_time = null, late_grace_minutes = 15;
  `)
})

describe('the switch', () => {
  it('refuses every check-in while attendance is off', async () => {
    await policy(`enabled = false`)
    expect(await tryIn(RAVI, STUDIO)).toMatch(/not_enabled/)
    expect(await q(`select 1 from attendance`)).toEqual([])
  })

  it('is the owner’s alone, and remembers the day it went on', async () => {
    await policy(`enabled = false, enabled_at = null`)
    expect(await fails(RAVI, `select set_attendance_policy(true, '10:00', 15, '19:00', 4, false, 0)`)).toMatch(/not allowed/)
    expect(await fails(OWNER, `select set_attendance_policy(true, '19:00', 15, '10:00', 4, false, 0)`)).toMatch(/bad_hours/)
    await as(OWNER, `select set_attendance_policy(true, '10:00', 10, '19:00', 4, true, 3)`)
    const [p] = await q<{ enabled: boolean; today: boolean; day_start: string; selfie_required: boolean }>(
      `select enabled, (enabled_at at time zone 'Asia/Kolkata')::date = ${TODAY} as today, day_start::text, selfie_required
         from attendance_policy where company_id = '${COMPANY}'`,
    )
    expect(p).toEqual({ enabled: true, today: true, day_start: '10:00:00', selfie_required: true })
    // The older readers keep seeing the same start and grace.
    expect(await q(`select expected_checkin_time::text as t, late_grace_minutes as g from company_location`)).toEqual([{ t: '10:00:00', g: 10 }])
  })
})

describe('checking in', () => {
  it('turns down a fix rougher than 500 m, and gives a rough one the benefit of its doubt', async () => {
    expect(await tryIn(RAVI, STUDIO, 1200)).toMatch(/too_rough: 1\.2 km/)
    expect(await tryIn(RAVI, NEAR, 50)).toMatch(/outside_fence/)
    const [row] = await checkIn(RAVI, NEAR, 120)
    expect(row).toMatchObject({ status: 'present', place_name: 'Studio' })
    expect(await q(`select accuracy_m from attendance where user_id = '${RAVI}'`)).toEqual([{ accuracy_m: 120 }])
  })

  it('asks for a selfie when the studio does, and only their own, fresh one', async () => {
    await policy(`selfie_required = true`)
    expect(await tryIn(RAVI, STUDIO)).toMatch(/selfie_needed/)
    expect(await tryIn(RAVI, STUDIO, null, await file(MEERA))).toMatch(/bad_selfie/)
    expect(await tryIn(RAVI, STUDIO, null, await file(RAVI, '2 hours'))).toMatch(/bad_selfie/)
    expect(await tryIn(RAVI, STUDIO, null, await file(RAVI, '1 minute', 'application/pdf'))).toMatch(/bad_selfie/)
    const good = await file(RAVI)
    expect(await tryIn(RAVI, STUDIO, null, good)).toBeNull()
    expect(await q(`select selfie_file_id from attendance where user_id = '${RAVI}'`)).toEqual([{ selfie_file_id: good }])
    // Once used, never again -- and it cannot be deleted from under the day.
    expect(await tryIn(MEERA, STUDIO, null, good)).toMatch(/bad_selfie/)
    await expect(q(`delete from files where id = '${good}'`)).rejects.toThrow(/foreign key|violates/)
  })

  it('closes yesterday’s open shift at the day end before marking today', async () => {
    await policy(`day_end = '19:00'`)
    await q(`insert into attendance (company_id, user_id, a_date, check_in_at, status)
             values ('${COMPANY}', '${RAVI}', ${TODAY} - 1, ((${TODAY} - 1) + time '10:00') at time zone 'Asia/Kolkata', 'present')`)
    await checkIn(RAVI, STUDIO)
    const [y] = await q<{ out: string; system: boolean }>(
      `select to_char(check_out_at at time zone 'Asia/Kolkata', 'HH24:MI') as out, closed_by_system as system
         from attendance where user_id = '${RAVI}' and a_date = ${TODAY} - 1`,
    )
    expect(y).toEqual({ out: '19:00', system: true })
  })
})

describe('checking out', () => {
  it('is a half day under the studio’s half-day hours, unless half the day was leave', async () => {
    await policy(`half_day_hours = 4`)
    await checkIn(RAVI, STUDIO)
    await as(RAVI, `select check_out()`)
    expect(await q(`select status from attendance where user_id = '${RAVI}'`)).toEqual([{ status: 'half_day' }])

    await q(`insert into leave_requests (company_id, user_id, kind, start_date, end_date, half_day, status)
             values ('${COMPANY}', '${MEERA}', 'casual', ${TODAY}, ${TODAY}, true, 'approved')`)
    await checkIn(MEERA, STUDIO)
    await as(MEERA, `select check_out()`)
    expect(await q(`select status from attendance where user_id = '${MEERA}'`)).toEqual([{ status: 'present' }])
  })
})

describe('a shoot day', () => {
  const book = async (user: string) =>
    (await q<{ id: string }>(
      `insert into team_assignment_slots (company_id, user_id, shoot_id, service_name, start_at, end_at, status, created_by)
       values ('${COMPANY}', '${user}', '${SHOOT}', 'Candid', now() - interval '30 minutes', now() + interval '3 hours', 'booked', '${OWNER}') returning id`,
    ))[0]!.id

  it('is counted when they reach the venue, and an office tap does not overwrite it', async () => {
    const slot = await book(RAVI)
    await as(RAVI, `select mark_arrived('${slot}', 26.9, 75.8)`)
    const [a] = await q<{ source: string; slot_id: string; status: string; late: number }>(
      `select source, slot_id, status, late_minutes as late from attendance where user_id = '${RAVI}'`,
    )
    expect(a).toMatchObject({ source: 'shoot', slot_id: slot, status: 'late' })
    expect(a!.late).toBeGreaterThanOrEqual(30)
    const [again] = await checkIn(RAVI, FAR)
    expect(again!.status).toBe('late')
    expect(await q(`select source from attendance where user_id = '${RAVI}'`)).toEqual([{ source: 'shoot' }])
  })

  it('records nothing while attendance is off', async () => {
    await policy(`enabled = false`)
    const slot = await book(MEERA)
    await as(MEERA, `select mark_arrived('${slot}')`)
    expect(await q(`select 1 from attendance where user_id = '${MEERA}'`)).toEqual([])
  })
})

describe('the shifts nobody closed', () => {
  it('are closed at the studio’s day end once it is two hours past', async () => {
    await policy(`day_end = '19:00'`)
    await q(`insert into attendance (company_id, user_id, a_date, check_in_at, status)
             values ('${COMPANY}', '${RAVI}', ${TODAY} - 1, ((${TODAY} - 1) + time '10:00') at time zone 'Asia/Kolkata', 'present')`)
    expect(Number((await q<{ n: number }>(`select auto_checkout_sweep() as n`))[0]!.n)).toBe(1)
    expect(await q(`select to_char(check_out_at at time zone 'Asia/Kolkata', 'HH24:MI') as out from attendance`)).toEqual([{ out: '19:00' }])
  })
})

describe('payroll', () => {
  const MONTH = { y: 2026, m: 9 }
  const line = async () =>
    (await q<{ absent_days: number; half_days: number; late_marks: number; late_penalty_days: number; deduction: number }>(
      `select l.absent_days, l.half_days::float8 as half_days, l.late_marks, l.late_penalty_days::float8 as late_penalty_days,
              l.deduction::float8 as deduction
         from payroll_lines l join payroll_runs r on r.id = l.run_id where l.user_id = '${RAVI}'`,
    ))[0]!
  const generate = () => q(`select payroll_generate('${COMPANY}', ${MONTH.y}, ${MONTH.m}, '${OWNER}')`)

  beforeEach(async () => {
    await q(`insert into attendance (company_id, user_id, a_date, status, late_minutes) values
      ('${COMPANY}', '${RAVI}', '2026-09-01', 'absent', 0),
      ('${COMPANY}', '${RAVI}', '2026-09-02', 'half_day', 0),
      ('${COMPANY}', '${RAVI}', '2026-09-03', 'late', 20),
      ('${COMPANY}', '${RAVI}', '2026-09-04', 'late', 20),
      ('${COMPANY}', '${RAVI}', '2026-09-07', 'late', 20)`)
  })

  it('cuts an absent day, half a day for a half day, and nothing for lateness unless the studio says so', async () => {
    await generate()
    // 30 working days (no weekly off): 25000 * 1.5 / 30 = 1250.
    expect(await line()).toEqual({ absent_days: 1, half_days: 0.5, late_marks: 3, late_penalty_days: 0, deduction: 1250 })
    await policy(`late_marks_per_half_day = 3`)
    await generate()
    expect(await line()).toMatchObject({ late_penalty_days: 0.5, deduction: 1667 })
  })

  it('never cuts a day before attendance went on, or a shoot day', async () => {
    await policy(`enabled_at = '2026-09-03'`)
    await generate()
    expect(await line()).toMatchObject({ absent_days: 0, half_days: 0, deduction: 0 })
    await policy(`enabled_at = '2020-01-01'`)
    await q(`insert into team_assignment_slots (company_id, user_id, shoot_id, service_name, start_at, end_at, status, created_by)
             values ('${COMPANY}', '${RAVI}', '${SHOOT}', 'Candid', '2026-09-01 05:00+00', '2026-09-01 09:00+00', 'booked', '${OWNER}')`)
    await generate()
    expect(await line()).toMatchObject({ absent_days: 0, deduction: 417 })
  })
})

describe('reminders', () => {
  it('tell someone not in yet, and the owner who, once a day', async () => {
    await policy(`day_start = '09:00'`)
    await db.exec(`update company_location set expected_checkin_time = '09:00'`)
    const at = `((${TODAY} + time '11:00') at time zone 'Asia/Kolkata')`
    const first = (await q<{ r: { check_in: number; owners: number } }>(`select run_attendance_reminders(${at}) as r`))[0]!.r
    expect(first).toMatchObject({ check_in: 2, owners: 1 })
    const [owner] = await q<{ title: string }>(`select title from notifications where recipient_uid = '${OWNER}'`)
    expect(owner!.title).toMatch(/^2 not in yet: (Ravi, Meera|Meera, Ravi)$/)
    const again = (await q<{ r: { check_in: number; owners: number } }>(`select run_attendance_reminders(${at}) as r`))[0]!.r
    expect(again).toMatchObject({ check_in: 0, owners: 0 })
  })

  it('stay quiet while attendance is off', async () => {
    await policy(`enabled = false, day_start = '09:00'`)
    const at = `((${TODAY} + time '11:00') at time zone 'Asia/Kolkata')`
    expect((await q<{ r: { check_in: number } }>(`select run_attendance_reminders(${at}) as r`))[0]!.r).toMatchObject({ check_in: 0 })
  })
})

describe('selfies', () => {
  it('are purged after 60 days, the day kept', async () => {
    const old = await file(RAVI)
    await q(`insert into attendance (company_id, user_id, a_date, check_in_at, status, selfie_file_id)
             values ('${COMPANY}', '${RAVI}', ${TODAY} - 70, now() - interval '70 days', 'present', '${old}')`)
    expect(Number((await q<{ n: number }>(`select purge_attendance_selfies(60) as n`))[0]!.n)).toBe(1)
    expect(await q(`select selfie_file_id from attendance where user_id = '${RAVI}'`)).toEqual([{ selfie_file_id: null }])
    expect(await q(`select 1 from files where id = '${old}'`)).toEqual([])
  })

  it('and the cron jobs are nobody else’s to call', async () => {
    await db.exec(`set role authenticated;`)
    await expect(db.query(`select run_attendance_reminders();`)).rejects.toThrow(/permission denied/i)
    await expect(db.query(`select purge_attendance_selfies(60);`)).rejects.toThrow(/permission denied/i)
    await db.exec(`reset role;`)
  })
})
