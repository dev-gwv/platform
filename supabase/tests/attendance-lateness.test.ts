import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Who counts as late, and by how much.
 *
 * attendance.status has allowed 'late' since 0014 and the attendance page has
 * always offered a Late filter, but nothing could ever produce one: check_in()
 * wrote 'present' unconditionally and there was no expected start time to
 * measure against. 0157 added the three settings and the verdict.
 *
 * The arithmetic is the part worth pinning down, because its one surprising
 * rule is easy to "simplify" away: lateness is DECIDED against expected +
 * grace, but MEASURED from expected.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(
    `create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`,
  )
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    -- 0224: attendance is off until a studio turns it on; these studios have.
    insert into attendance_policy (company_id, enabled, enabled_at) values ('${COMPANY}', true, '2020-01-01')
      on conflict (company_id) do update set enabled = true, enabled_at = '2020-01-01';
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})



const at = (hhmm: string) => `'2026-09-17 ${hhmm}:00+05:30'::timestamptz`

/** The rule on its own, without a check-in around it. */
const lateness = async (checkedInAt: string, expected = '10:00', grace = 15, tz = 'Asia/Kolkata') =>
  (await one<{ n: number }>(
    `select attendance_lateness(${at(checkedInAt)}, '${expected}'::time, ${grace}, '${tz}') as n;`,
  ))!.n

const fence = async (over = '') =>
  await db.exec(`
    insert into company_location (company_id, lat, lng, radius_m, timezone${over ? ', ' + over.split('=')[0] : ''})
    values ('${COMPANY}', 19.076, 72.8777, 500, 'Asia/Kolkata'
            ${over ? ', ' + over.split('=').slice(1).join('=') : ''})
    on conflict (company_id) do update set radius_m = excluded.radius_m;`)

beforeEach(async () => {
  await db.exec(`delete from attendance;`)
  await db.exec(`delete from company_location;`)
})

describe('deciding how late somebody is', () => {
  it('is not late when they arrive before the start', async () => {
    expect(await lateness('09:45')).toBe(0)
  })

  it('is not late exactly on the start', async () => {
    expect(await lateness('10:00')).toBe(0)
  })

  it('is not late inside the grace', async () => {
    expect(await lateness('10:14')).toBe(0)
  })

  it('is not late on the last minute of the grace', async () => {
    // The boundary is the one people argue about, so it is written down: a
    // 15-minute grace forgives arriving AT 10:15, not before it.
    expect(await lateness('10:15')).toBe(0)
  })

  it('counts from the start time, not from the end of the grace', async () => {
    // The rule that looks like a bug until you know it. Arriving at 10:20
    // with a 15-minute grace is twenty minutes late, not five. The grace
    // forgives being slightly late; it does not move the start of the day.
    expect(await lateness('10:20')).toBe(20)
  })

  it('counts a long delay in full', async () => {
    expect(await lateness('13:30')).toBe(210)
  })

  it('honours a grace of zero', async () => {
    expect(await lateness('10:01', '10:00', 0)).toBe(1)
    expect(await lateness('10:00', '10:00', 0)).toBe(0)
  })

  it('honours a different start time', async () => {
    expect(await lateness('09:30', '09:00', 15)).toBe(30)
    expect(await lateness('09:10', '09:00', 15)).toBe(0)
  })

  it('reads the clock in the studio’s timezone, not the server’s', async () => {
    // One instant, two verdicts. 06:00 in Mumbai is 00:30 UTC, so against a
    // 05:00 start it is an hour late locally and the middle of the night in
    // UTC. Comparing against the server's clock would make lateness depend on
    // where the box happens to be hosted.
    expect(await lateness('06:00', '05:00', 0, 'Asia/Kolkata')).toBe(60)
    expect(await lateness('06:00', '05:00', 0, 'UTC')).toBe(0)
  })
})

describe('checking in', () => {
  it('records present, and no minutes, when on time', async () => {
    await fence(`expected_checkin_time='23:59'`)
    await db.query(`select check_in(19.076, 72.8777);`)
    const row = await one<{ status: string; late_minutes: number }>(
      `select status, late_minutes from attendance where user_id = '${OWNER}';`,
    )
    expect(row!.status).toBe('present')
    expect(row!.late_minutes).toBe(0)
  })

  it('records late, with the minutes, when the day already started', async () => {
    // Start of day forced to midnight so any real check-in is late.
    await fence(`expected_checkin_time='00:00'`)
    await db.exec(`update company_location set late_grace_minutes = 0 where company_id = '${COMPANY}';`)
    await db.query(`select check_in(19.076, 72.8777);`)
    const row = await one<{ status: string; late_minutes: number }>(
      `select status, late_minutes from attendance where user_id = '${OWNER}';`,
    )
    expect(row!.status).toBe('late')
    expect(row!.late_minutes).toBeGreaterThan(0)
  })

  it('does not relabel the day on a second check-in', async () => {
    // Someone late in the morning who taps check-in again at lunchtime has not
    // become punctual. The first arrival is the one that counts.
    await fence(`expected_checkin_time='00:00'`)
    await db.exec(`update company_location set late_grace_minutes = 0 where company_id = '${COMPANY}';`)
    await db.query(`select check_in(19.076, 72.8777);`)
    const first = await one<{ late_minutes: number }>(
      `select late_minutes from attendance where user_id = '${OWNER}';`,
    )
    await db.exec(`update company_location set expected_checkin_time = '23:59' where company_id = '${COMPANY}';`)
    await db.query(`select check_in(19.076, 72.8777);`)
    const again = await one<{ status: string; late_minutes: number }>(
      `select status, late_minutes from attendance where user_id = '${OWNER}';`,
    )
    expect(again!.status).toBe('late')
    expect(again!.late_minutes).toBe(first!.late_minutes)
  })

  it('a studio with a fence but no declared start has nobody late', async () => {
    // The upgrade path, and the reason expected_checkin_time is nullable with
    // no default: every studio already using the geofence has a
    // company_location row, and a NOT NULL DEFAULT of '10:00' would have them
    // marking staff late against a start nobody chose, the moment this
    // migration landed.
    await fence()
    await db.query(`select check_in(19.076, 72.8777);`)
    const withFence = await one<{ status: string; late_minutes: number }>(
      `select status, late_minutes from attendance where user_id = '${OWNER}';`,
    )
    expect(withFence!.status).toBe('present')
    expect(withFence!.late_minutes).toBe(0)

    await db.exec(`delete from attendance;`)
    await db.exec(`delete from company_location;`)
    await db.query(`select check_in(19.076, 72.8777);`)
    const row = await one<{ status: string; late_minutes: number }>(
      `select status, late_minutes from attendance where user_id = '${OWNER}';`,
    )
    expect(row!.status).toBe('present')
    expect(row!.late_minutes).toBe(0)
  })

  it('a check-in after the backstop marked them absent corrects the day', async () => {
    await fence(`expected_checkin_time='23:59'`)
    await db.exec(`
      insert into attendance (company_id, user_id, a_date, status)
      values ('${COMPANY}', '${OWNER}', (now() at time zone 'Asia/Kolkata')::date, 'absent');`)
    await db.query(`select check_in(19.076, 72.8777);`)
    const row = await one<{ status: string }>(
      `select status from attendance where user_id = '${OWNER}';`,
    )
    expect(row!.status).toBe('present')
  })
})

describe('the studio setting the working day', () => {
  it('stores the three values', async () => {
    await db.query(`
      select set_company_location(19.076, 72.8777, 500, 'Asia/Kolkata', true,
                                  '09:30'::time, 10, '13:00'::time);`)
    const row = await one<{ expected_checkin_time: string; late_grace_minutes: number; missed_cutoff_time: string }>(
      `select expected_checkin_time::text, late_grace_minutes, missed_cutoff_time::text
         from company_location where company_id = '${COMPANY}';`,
    )
    expect(row!.expected_checkin_time).toBe('09:30:00')
    expect(row!.late_grace_minutes).toBe(10)
    expect(row!.missed_cutoff_time).toBe('13:00:00')
  })

  it('refuses a cutoff that is not after the start', async () => {
    // Otherwise every day is "missed" from the moment it begins.
    await expect(
      db.query(`select set_company_location(19.076, 72.8777, 500, 'Asia/Kolkata', true,
                                            '10:00'::time, 15, '09:00'::time);`),
    ).rejects.toThrow(/cutoff must be after/i)
  })

  it('refuses a grace outside the sane range', async () => {
    await expect(
      db.query(`select set_company_location(19.076, 72.8777, 500, 'Asia/Kolkata', true,
                                            '10:00'::time, 900, '12:00'::time);`),
    ).rejects.toThrow(/grace must be between/i)
  })

  it('keeps the fence toggle working', async () => {
    // 0157 rewrote check_in(). Rebuilding it from 0014 instead of 0079 quietly
    // dropped `is_active` from the fence test, so a studio that had suspended
    // its geofence could not check in from anywhere. The tenancy suite caught
    // it; this keeps it caught.
    await fence()
    await db.exec(`update company_location set is_active = false where company_id = '${COMPANY}';`)
    // Far from the studio, fence off: allowed.
    await db.query(`select check_in(1.0, 1.0);`)
    expect(
      (await one<{ n: number }>(`select count(*)::int as n from attendance where user_id = '${OWNER}';`))!.n,
    ).toBe(1)

    await db.exec(`delete from attendance;`)
    await db.exec(`update company_location set is_active = true where company_id = '${COMPANY}';`)
    await expect(db.query(`select check_in(1.0, 1.0);`)).rejects.toThrow(/outside_fence/i)
  })

  it('leaves exactly one set_company_location, not two overloads', async () => {
    // The argument list grew. `create or replace` cannot change one, so the
    // old 5-argument version had to be dropped — otherwise the API's call
    // becomes ambiguous and the whole settings page 500s.
    const rows = await q<{ n: number }>(
      `select count(*)::int as n from pg_proc
        where proname = 'set_company_location' and pronamespace = 'public'::regnamespace;`,
    )
    expect(rows[0]!.n).toBe(1)
  })
})
