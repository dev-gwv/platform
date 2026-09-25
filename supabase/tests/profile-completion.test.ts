import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Profile completion (0175): one rule for what a complete profile needs, a
 * reminder every morning until it is complete, and one weekly note to the owner.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'b0000000-0000-4000-8000-000000000001'
const PRIYA = 'b0000000-0000-4000-8000-000000000002'
const COMPANY = 'b0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'b0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'b0000000-0000-4000-8000-0000000000b1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
  `)
  await as(OWNER)
})


const run = (at: string) => q<{ s: Record<string, number> }>(`select run_profile_reminder_cron(false, '${at}') as s`)
const notes = (user: string, type: string) =>
  q<{ title: string; body: string }>(`select title, body from notifications where recipient_uid = '${user}' and type = '${type}' order by created_at`)
const missing = async (user: string) =>
  (await q<{ m: string[] }>(`select profile_missing('${user}') as m`))[0]!.m

describe('profile completion', () => {
  it('lists what is missing, asking PAN only of in-house staff', async () => {
    await db.exec(`update users set created_at = '2026-01-01' where user_id = '${PRIYA}'`)
    expect(await missing(PRIYA)).toEqual(['photo', 'phone', 'address', 'date_of_birth', 'emergency_contact', 'payout', 'pan'])
    await db.exec(`update users set engagement_type = 'freelancer' where user_id = '${PRIYA}'`)
    expect(await missing(PRIYA)).not.toContain('pan')
    await db.exec(`update users set engagement_type = 'in_house' where user_id = '${PRIYA}'`)
  })

  it('reminds every morning with what is left, and the owner once a week', async () => {
    expect((await run('2026-10-05T02:00:00Z'))[0]!.s.notifications_created).toBe(0) // before 10 am India
    await run('2026-10-05T05:00:00Z')
    await run('2026-10-05T09:00:00Z') // same day: deduped
    await run('2026-10-06T05:00:00Z')
    const mine = await notes(PRIYA, 'profile_incomplete')
    expect(mine).toHaveLength(2)
    expect(mine[0]!.title).toBe('Complete your profile (0% done)')
    expect(mine[0]!.body).toContain('UPI or bank details')
    expect(await notes(OWNER, 'profile_digest')).toHaveLength(1)
    // The owner's own profile is not chased.
    expect(await notes(OWNER, 'profile_incomplete')).toHaveLength(0)
  })

  it('stops once the profile is complete', async () => {
    await db.exec(`
      update users set avatar_url = 'https://x.test/p.jpg', phone = '9876543210', address = 'Jaipur' where user_id = '${PRIYA}';
      insert into member_profiles (user_id, company_id, date_of_birth, emergency_name, emergency_phone, upi_id, pan)
      values ('${PRIYA}', '${COMPANY}', '1995-04-02', 'Asha', '9876500000', 'priya@okhdfc', 'ABCDE1234F');`)
    expect(await missing(PRIYA)).toEqual([])
    await run('2026-10-07T05:00:00Z')
    expect(await notes(PRIYA, 'profile_incomplete')).toHaveLength(2)
  })

  it('refuses a PAN that is not a PAN', async () => {
    await expect(db.query(`update member_profiles set pan = 'NOTAPAN' where user_id = '${PRIYA}'`)).rejects.toThrow()
  })
})
