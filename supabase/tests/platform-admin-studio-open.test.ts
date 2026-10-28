import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0288: a platform admin's own studio is open for life -- no trial, no days
 * left -- for admins already there, admins added later and studios they make
 * later. Anyone else's studio keeps its trial.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const ADMIN = 'f2000000-0000-4000-8000-000000000001'
const OTHER = 'f2000000-0000-4000-8000-000000000002'
const LATER = 'f2000000-0000-4000-8000-000000000003'
const S_ADMIN = 'f2000000-0000-4000-8000-0000000000a1'
const S_OTHER = 'f2000000-0000-4000-8000-0000000000a2'
const S_LATER = 'f2000000-0000-4000-8000-0000000000a3'
const S_NEW = 'f2000000-0000-4000-8000-0000000000a4'
const S_PAID = 'f2000000-0000-4000-8000-0000000000a5'
const PROFILE = 'f2000000-0000-4000-8000-000000000004'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const yearOf = async (id: string) =>
  (await q<{ y: number }>(`select extract(year from grandfathered_until)::int as y from companies where id = $1`, [id]))[0]!.y

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@s.test'), ('${OTHER}', 'other@s.test'), ('${LATER}', 'later@s.test');
    insert into platform_admins (user_id) values ('${ADMIN}');
    insert into companies (id, name, owner_user_id) values
      ('${S_ADMIN}', 'Admin Studio', '${ADMIN}'), ('${S_OTHER}', 'Other Studio', '${OTHER}'), ('${S_LATER}', 'Later Studio', '${LATER}');
    insert into users (user_id, company_id, role, name, email, login_enabled) values
      ('${ADMIN}', '${S_ADMIN}', 'super_admin', 'Admin', 'admin@s.test', true),
      ('${OTHER}', '${S_OTHER}', 'super_admin', 'Other', 'other@s.test', true),
      ('${LATER}', '${S_LATER}', 'super_admin', 'Later', 'later@s.test', true);
  `)
})

describe('a platform admin studio is open for life (0288)', () => {
  it('opens the studio of an admin and leaves everyone else on the trial', async () => {
    expect(await yearOf(S_ADMIN)).toBe(2099)
    expect(await yearOf(S_OTHER)).toBeLessThan(2099)
    const [g] = await q<{ g: string }>(
      `select company_access_until(plan_expiry, grandfathered_until, grace_until)::date::text as g from companies where id = $1`,
      [S_ADMIN],
    )
    expect(g!.g).toBe('2099-12-31')
  })

  it('opens the studios of an admin added later', async () => {
    expect(await yearOf(S_LATER)).toBeLessThan(2099)
    await q(`insert into platform_admins (user_id) values ($1)`, [LATER])
    expect(await yearOf(S_LATER)).toBe(2099)
  })

  it('opens a studio an admin makes later (a new profile of the same login), and leaves other studios as they are', async () => {
    await q(`insert into auth.users (id, email, identity_id) values ($1, null, $2)`, [PROFILE, ADMIN])
    await q(`insert into companies (id, name, owner_user_id) values ($1, 'Brand', $2)`, [S_NEW, PROFILE])
    await q(
      `insert into users (user_id, company_id, role, name, email, login_enabled) values ($1, $2, 'super_admin', 'Admin', 'admin@s.test', true)`,
      [PROFILE, S_NEW],
    )
    expect(await yearOf(S_NEW)).toBe(2099)

    await q(`insert into companies (id, name, owner_user_id, plan_expiry) values ($1, 'Paid', $2, now() + interval '1 year')`, [S_PAID, OTHER])
    await q(`select open_platform_admin_studios()`)
    expect(await yearOf(S_PAID)).toBeLessThan(2099)
  })
})
