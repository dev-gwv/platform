import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0228: leave balances. A studio sets days a year per kind; approved leave
 * counts working days only (a weekly off inside it does not), a half day is
 * 0.5, pending is shown apart; staff see their own, managers everyone's; and
 * a request can be approved as unpaid when the days have run out.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'c2280000-0000-4000-8000-000000000001'
const PRIYA = 'c2280000-0000-4000-8000-000000000002'
const AMAN = 'c2280000-0000-4000-8000-000000000003'
const FREE = 'c2280000-0000-4000-8000-000000000004'
const COMPANY = 'c2280000-0000-4000-8000-0000000000aa'

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
type Bal = { user_name: string; kind: string; allowance: number; used: number; pending: number; remaining: number }
const balances = (year = 2027) =>
  q<Bal>(`select user_name, kind, allowance::float as allowance, used::float as used, pending::float as pending, remaining::float as remaining
            from leave_balances(${year})`)

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test'), ('${AMAN}', 'a@s.test'), ('${FREE}', 'f@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    -- Sunday is the weekly off.
    insert into attendance_policy (company_id, enabled, enabled_at, weekly_off) values ('${COMPANY}', true, '2020-01-01', '{0}')
      on conflict (company_id) do update set enabled = true, enabled_at = '2020-01-01', weekly_off = '{0}';
    insert into users (user_id, company_id, role, name, email, engagement_type, created_at) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test', 'in_house', '2020-01-01'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test', 'in_house', '2020-01-01'),
      ('${AMAN}', '${COMPANY}', 'employee', 'Aman', 'a@s.test', 'in_house', '2020-01-01'),
      ('${FREE}', '${COMPANY}', 'employee', 'Freya', 'f@s.test', 'freelancer', '2020-01-01');
    insert into leave_allowances (company_id, kind, days_per_year) values ('${COMPANY}', 'casual', 12), ('${COMPANY}', 'sick', 6);
    -- Priya: Fri 1 – Mon 4 Jan 2027 approved casual (Sun 3 is the weekly off: 3 days),
    -- a half day of sick approved, and 2 casual days pending.
    insert into leave_requests (company_id, user_id, kind, start_date, end_date, half_day, status) values
      ('${COMPANY}', '${PRIYA}', 'casual', '2027-01-01', '2027-01-04', false, 'approved'),
      ('${COMPANY}', '${PRIYA}', 'sick', '2027-02-10', '2027-02-10', true, 'approved'),
      ('${COMPANY}', '${PRIYA}', 'casual', '2027-03-08', '2027-03-09', false, 'pending'),
      ('${COMPANY}', '${PRIYA}', 'casual', '2026-12-20', '2026-12-22', false, 'approved');
  `)
})

describe('leave balances', () => {
  it('counts working days in the year, half days as half, pending apart', async () => {
    await as(OWNER)
    const priya = (await balances()).filter((b) => b.user_name === 'Priya')
    expect(priya).toEqual([
      { user_name: 'Priya', kind: 'casual', allowance: 12, used: 3, pending: 2, remaining: 9 },
      { user_name: 'Priya', kind: 'sick', allowance: 6, used: 0.5, pending: 0, remaining: 5.5 },
    ])
    // 20–22 Dec 2026: Sunday 20 is the weekly off, so 2 days.
    expect((await balances(2026)).find((b) => b.user_name === 'Priya' && b.kind === 'casual')?.used).toBe(2)
  })

  it('a member sees only their own; a freelancer has none', async () => {
    await as(AMAN)
    expect((await balances()).map((b) => b.user_name)).toEqual(['Aman', 'Aman'])
    await as(OWNER)
    expect((await balances()).some((b) => b.user_name === 'Freya')).toBe(false)
  })

  it('only an owner or manager sets the allowance', async () => {
    await db.exec(`set role authenticated;`)
    await as(AMAN)
    expect(await fails(`insert into leave_allowances (kind, days_per_year) values ('paid', 15)`)).toMatch(/row-level security/)
    await as(OWNER)
    await q(`insert into leave_allowances (kind, days_per_year) values ('paid', 15)`)
    await db.exec(`reset role;`)
    expect(await q(`select days_per_year::float as d from leave_allowances where kind = 'paid'`)).toEqual([{ d: 15 }])
  })

  it('approves as unpaid when the days have run out', async () => {
    await as(OWNER)
    // Priya has used 3; with 3 a year nothing is left, so the whole request is unpaid.
    await q(`update leave_allowances set days_per_year = 3 where kind = 'casual'`)
    const [{ id }] = await q<{ id: string }>(`select id from leave_requests where status = 'pending' limit 1`)
    await q(`select decide_leave('${id}', true, 'No casual left', true)`)
    await q(`update leave_allowances set days_per_year = 12 where kind = 'casual'`)
    expect(await q(`select kind, status from leave_requests where id = '${id}'`)).toEqual([{ kind: 'unpaid', status: 'approved' }])
    const casual = (await balances()).find((b) => b.user_name === 'Priya' && b.kind === 'casual')
    expect(casual).toMatchObject({ used: 3, pending: 0, remaining: 9 })
    // 4 casual days asked with 2 left: the first 2 working days stay casual, the rest unpaid.
    await q(`update leave_allowances set days_per_year = 5 where kind = 'casual'`)
    await as(AMAN)
    const [{ id: long }] = await q<{ id: string }>(`select request_leave('casual', '2027-05-06', '2027-05-10', false, 'Trip') as id`)
    await as(OWNER)
    await q(`update leave_allowances set days_per_year = 2 where kind = 'casual'`)
    await q(`select decide_leave('${long}', true, 'Two casual left', true)`)
    // Thu 6, Fri 7 casual; Sat 8 and Mon 10 unpaid (Sun 9 is the weekly off).
    expect(
      await q(`select kind, start_date::text as s, end_date::text as e, status from leave_requests
                where user_id = '${AMAN}' and start_date between '2027-05-01' and '2027-05-31' order by start_date`),
    ).toEqual([
      { kind: 'casual', s: '2027-05-06', e: '2027-05-07', status: 'approved' },
      { kind: 'unpaid', s: '2027-05-08', e: '2027-05-10', status: 'approved' },
    ])
    await q(`update leave_allowances set days_per_year = 12 where kind = 'casual'`)
    // The old three-argument call still works.
    await as(AMAN)
    const [{ id: mine }] = await q<{ id: string }>(`select request_leave('casual', '2027-04-05', '2027-04-05', false, 'Wedding') as id`)
    await as(OWNER)
    await q(`select decide_leave('${mine}', true, null)`)
    expect(await q(`select kind from leave_requests where id = '${mine}'`)).toEqual([{ kind: 'casual' }])
  })
})
