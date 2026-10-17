import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0269: a login with two studios never opens on the expired one while the
 * other is open (a studio extended in Studio Access Manager still landed on
 * "Plan expired"), and the platform owner can look a login up and pick the
 * studio it opens.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const ADMIN = 'f1000000-0000-4000-8000-000000000001'
const LOGIN = 'f1000000-0000-4000-8000-000000000002'
const PROFILE = 'f1000000-0000-4000-8000-000000000003'
const OLD = 'f1000000-0000-4000-8000-0000000000a1'
const LIVE = 'f1000000-0000-4000-8000-0000000000a2'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const as = (uid: string | null) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
const picked = async () => (await q<{ id: string }>(`select pick_login_profile($1) as id`, [LOGIN]))[0]!.id

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
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@s.test'), ('${LOGIN}', 'Aditya@S.test');
    insert into auth.users (id, email, identity_id) values ('${PROFILE}', null, '${LOGIN}');
    insert into platform_admins (user_id) values ('${ADMIN}');
    insert into companies (id, name, owner_user_id) values ('${OLD}', 'Aditya Old', '${LOGIN}'), ('${LIVE}', 'OMS Wedding Studio', '${PROFILE}');
    insert into users (user_id, company_id, role, name, email, login_enabled) values
      ('${LOGIN}', '${OLD}', 'super_admin', 'Aditya', 'aditya@s.test', true),
      ('${PROFILE}', '${LIVE}', 'super_admin', 'Aditya', 'aditya@s.test', true);
    -- The old studio has run out; OMS was extended 30 days.
    update companies set plan_expiry = null, grandfathered_until = now() - interval '1 day', grace_until = null where id = '${OLD}';
    update companies set plan_expiry = now() + interval '30 days' where id = '${LIVE}';
    -- He was last in the old one.
    update auth.users set last_profile_id = '${LOGIN}' where id = '${LOGIN}';
  `)
})

describe('a login with two studios (0269)', () => {
  it('opens the studio that still has access, not the expired one it was last in', async () => {
    expect(await picked()).toBe(PROFILE)
  })

  it('opens the one it was last in when both are open', async () => {
    await q(`update companies set plan_expiry = now() + interval '10 days' where id = $1`, [OLD])
    expect(await picked()).toBe(LOGIN)
    await q(`update companies set plan_expiry = null where id = $1`, [OLD])
  })

  it('shows the platform owner every studio of a login, by any case of its email, and which opens first', async () => {
    await as(LOGIN)
    await expect(q(`select * from platform_login_lookup('aditya@s.test')`)).rejects.toThrow(/platform access only/)
    await as(ADMIN)
    const rows = await q<{ company_name: string; plan_gate: string; opens_first: boolean; last_in: boolean }>(
      `select company_name, plan_gate, opens_first, last_in from platform_login_lookup(' aditya@s.test ')`,
    )
    expect(rows).toEqual([
      { company_name: 'OMS Wedding Studio', plan_gate: 'active', opens_first: true, last_in: false },
      { company_name: 'Aditya Old', plan_gate: 'expired', opens_first: false, last_in: true },
    ])
    expect(await q(`select * from platform_login_lookup('nobody@s.test')`)).toEqual([])
  })

  it('lets the platform owner pick the studio a login opens next, only one it belongs to', async () => {
    await q(`select platform_open_first('aditya@s.test', $1)`, [LIVE])
    const [r] = await q<{ last: string }>(`select last_profile_id as last from auth.users where id = $1`, [LOGIN])
    expect(r!.last).toBe(PROFILE)
    await expect(q(`select platform_open_first('aditya@s.test', $1)`, [ADMIN])).rejects.toThrow(/does not open that studio/)
  })
})
