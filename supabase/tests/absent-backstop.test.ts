import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The nightly absent sweep.
 *
 * `mark_absent_backstop()` has existed since 0014 and nothing ever called it,
 * so no studio has had an absent day written — a date nobody touched was no
 * row at all rather than a recorded absence. `POST /cron/attendance` calls it
 * now, which makes the two things below worth pinning down: that it writes
 * what it should, and that the number it reports is the number it wrote.
 *
 * The counter was wrong. `get diagnostics` sat inside the loop over
 * companies, so each one overwrote the last, and the function returned
 * whatever the final company got — usually zero, since most companies have
 * nobody missing. The cron log would have said "0 absences" on a night it
 * wrote fifty.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER_A = '11111111-1111-1111-1111-111111111111'
const STAFF_A = '22222222-2222-2222-2222-222222222222'
const OWNER_B = '33333333-3333-3333-3333-333333333333'
const STAFF_B = '44444444-4444-4444-4444-444444444444'
const LEFT = '55555555-5555-5555-5555-555555555555'
const COMPANY_A = '66666666-6666-6666-6666-666666666666'
const COMPANY_B = '77777777-7777-7777-7777-777777777777'

let db: PGlite

/**
 * "Today" as the sweep sees it: the studio's own date, not the database's.
 * These studios have no location row, so the sweep falls back to
 * Asia/Kolkata. Plain `current_date` is UTC, which made these tests fail
 * every evening from 18:30 to midnight UTC, when India is already on the
 * next day: the "present" row landed on yesterday and the sweep, rightly,
 * marked today absent.
 */
const TODAY = `(now() at time zone 'Asia/Kolkata')::date`
/**
 * The day the sweep marks: the one that has just ended where the studio is
 * (it runs at midnight India time, so "today" there has only just begun).
 */
const SWEPT = `((now() at time zone 'Asia/Kolkata') - interval '12 hours')::date`

const sweep = async () => {
  const r = await db.query<{ n: number }>(`select mark_absent_backstop() as n;`)
  return Number(r.rows[0]!.n)
}
const rows = async () => {
  const r = await db.query<{ n: string }>(`select count(*)::text as n from attendance where status = 'absent';`)
  return Number(r.rows[0]!.n)
}

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

  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER_A}', 'a@s.test'), ('${STAFF_A}', 'sa@s.test'),
    ('${OWNER_B}', 'b@s.test'), ('${STAFF_B}', 'sb@s.test'), ('${LEFT}', 'x@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY_A}', 'Studio A', '${OWNER_A}'),
      ('${COMPANY_B}', 'Studio B', '${OWNER_B}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER_A}', '${COMPANY_A}', 'super_admin', 'A Owner', 'a@s.test',  'active'),
      ('${STAFF_A}', '${COMPANY_A}', 'employee',    'A Staff', 'sa@s.test', 'active'),
      ('${OWNER_B}', '${COMPANY_B}', 'super_admin', 'B Owner', 'b@s.test',  'active'),
      ('${STAFF_B}', '${COMPANY_B}', 'employee',    'B Staff', 'sb@s.test', 'active'),
      ('${LEFT}',    '${COMPANY_A}', 'employee',    'Departed','x@s.test',  'inactive');
    -- Everyone here joined long ago; someone added today is not absent yesterday.
    update users set created_at = '2020-01-01';
  `)
})

describe('mark_absent_backstop', () => {
  it('reports the total across every company, not the last one', async () => {
    // Two staff across two studios; the departed one and the owners do not
    // count. The old counter returned Studio B's alone and lost Studio A's.
    expect(await sweep()).toBe(2)
    expect(await rows()).toBe(2)
  })

  it('marks the day that has just ended, and never the owner', async () => {
    const r = await db.query<{ ok: boolean; owners: string }>(
      `select bool_and(a_date = ${SWEPT}) as ok,
              count(*) filter (where user_id in ('${OWNER_A}', '${OWNER_B}'))::text as owners
         from attendance where status = 'absent';`,
    )
    expect(r.rows[0]).toEqual({ ok: true, owners: '0' })
  })

  it('leaves someone who has been marked inactive alone', async () => {
    const r = await db.query<{ n: string }>(
      `select count(*)::text as n from attendance where user_id = '${LEFT}';`,
    )
    expect(Number(r.rows[0]!.n)).toBe(0)
  })

  it('writes nothing on a second run the same night', async () => {
    // A retried cron, or two schedulers, must not double the day.
    expect(await sweep()).toBe(0)
    expect(await rows()).toBe(2)
  })

  it('does not overwrite a day someone was actually present', async () => {
    await db.exec(`delete from attendance;`)
    await db.exec(`
      insert into attendance (company_id, user_id, a_date, status)
      values ('${COMPANY_A}', '${STAFF_A}', ${SWEPT}, 'present');`)
    expect(await sweep()).toBe(1)
    const r = await db.query<{ status: string }>(
      `select status from attendance where user_id = '${STAFF_A}' and a_date = ${SWEPT};`,
    )
    expect(r.rows[0]!.status).toBe('present')
  })

  it('leaves a half-finished day as it found it', async () => {
    // Checked in and not yet out is not an absence, whatever the hour.
    await db.exec(`delete from attendance;`)
    await db.exec(`
      insert into attendance (company_id, user_id, a_date, status, check_in_at)
      values ('${COMPANY_A}', '${STAFF_A}', ${TODAY}, 'late', now());`)
    await sweep()
    const r = await db.query<{ status: string }>(
      `select status from attendance where user_id = '${STAFF_A}' and a_date = ${TODAY};`,
    )
    expect(r.rows[0]!.status).toBe('late')
  })

  it('is not callable by a signed-in studio user', async () => {
    // It writes across every company, so it belongs to the cron alone.
    await db.exec(`set role authenticated;`)
    await expect(db.query(`select mark_absent_backstop();`)).rejects.toThrow(/permission denied/i)
    await db.exec(`reset role;`)
  })
})
