import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * One person on several studios' teams under one email (0159).
 *
 * The second and later studios hold a *profile*: an auth.users row with no
 * email and no password that points at the real login. These pin down the
 * rules the API leans on -- which studios a login can open, which one a
 * sign-in lands in, that the password_version the access token is checked
 * against is the login's, and that removing someone from one studio does not
 * sign them out of the others. The live suite (rls-live.mjs) drives the same
 * flow through the API.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER_A = 'a0000000-0000-4000-8000-000000000001'
const OWNER_B = 'b0000000-0000-4000-8000-000000000001'
const STUDIO_A = 'a0000000-0000-4000-8000-0000000000aa'
const STUDIO_B = 'b0000000-0000-4000-8000-0000000000bb'
const LOGIN = 'f0000000-0000-4000-8000-000000000001' // the freelancer's own login (in A)
const PROFILE_B = 'f0000000-0000-4000-8000-0000000000b1' // their profile in B

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

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
  await db.exec(`
    insert into auth.users (id, email, encrypted_password) values
      ('${OWNER_A}', 'a@s.test', 'x'), ('${OWNER_B}', 'b@s.test', 'x'), ('${LOGIN}', 'free@s.test', 'x');
    insert into auth.users (id, email, encrypted_password, identity_id) values
      ('${PROFILE_B}', null, null, '${LOGIN}');
    insert into companies (id, name, owner_user_id) values
      ('${STUDIO_A}', 'Alpha Studio', '${OWNER_A}'), ('${STUDIO_B}', 'Beta Films', '${OWNER_B}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER_A}', '${STUDIO_A}', 'super_admin', 'Owner A', 'a@s.test'),
      ('${OWNER_B}', '${STUDIO_B}', 'super_admin', 'Owner B', 'b@s.test'),
      ('${LOGIN}', '${STUDIO_A}', 'employee', 'Free', 'free@s.test'),
      ('${PROFILE_B}', '${STUDIO_B}', 'admin', 'Free', 'free@s.test');
  `)
})

const studios = async (id = LOGIN) =>
  (await q<{ company_name: string }>(`select company_name from list_login_profiles('${id}')`)).map(
    (r) => r.company_name,
  )

describe('a login on two studios', () => {
  it('lists both studios, in name order', async () => {
    expect(await studios()).toEqual(['Alpha Studio', 'Beta Films'])
  })

  it('maps a profile back to its login, and a login to itself', async () => {
    expect((await one<{ id: string }>(`select auth_identity_of('${PROFILE_B}') as id`)).id).toBe(LOGIN)
    expect((await one<{ id: string }>(`select auth_identity_of('${LOGIN}') as id`)).id).toBe(LOGIN)
  })

  it('opens their own studio first, then whichever they were last in', async () => {
    const pick = async () => (await one<{ id: string }>(`select pick_login_profile('${LOGIN}') as id`)).id
    expect(await pick()).toBe(LOGIN)
    await db.exec(`select remember_login_profile('${PROFILE_B}')`)
    expect(await pick()).toBe(PROFILE_B)
    await db.exec(`select remember_login_profile('${LOGIN}')`)
    expect(await pick()).toBe(LOGIN)
  })

  it('refuses to open a studio that is not theirs', async () => {
    const r = await one<{ id: string | null }>(`select pick_login_profile('${LOGIN}', '${OWNER_B}') as id`)
    expect(r.id).toBeNull()
  })

  it("checks a profile's token against the login's password_version", async () => {
    await db.exec(`update auth.users set password_version = 7 where id = '${LOGIN}'`)
    await db.exec(`set request.jwt.claim.sub = '${PROFILE_B}'`)
    const ctx = await one<{ company_id: string; password_version: number }>(
      `select company_id, password_version from get_auth_context()`,
    )
    await db.exec(`reset request.jwt.claim.sub`)
    expect(ctx).toMatchObject({ company_id: STUDIO_B, password_version: 7 })
  })

  it('signs out every studio from either id, with one bump on the login', async () => {
    await db.exec(`
      insert into refresh_tokens (user_id, family_id, token_hash, expires_at) values
        ('${LOGIN}', gen_random_uuid(), 'h-a', now() + interval '1 day'),
        ('${PROFILE_B}', gen_random_uuid(), 'h-b', now() + interval '1 day');`)
    const v = await one<{ v: number }>(`select revoke_all_sessions('${PROFILE_B}') as v`)
    expect(v.v).toBe(8)
    const live = await q(`select 1 from refresh_tokens where token_hash in ('h-a','h-b') and revoked_at is null`)
    expect(live).toHaveLength(0)
  })

  it('removing them from one studio ends only that studio', async () => {
    await db.exec(`
      insert into refresh_tokens (user_id, family_id, token_hash, expires_at) values
        ('${LOGIN}', gen_random_uuid(), 'h-a2', now() + interval '1 day'),
        ('${PROFILE_B}', gen_random_uuid(), 'h-b2', now() + interval '1 day');
      update users set deleted_at = now(), status = 'inactive' where user_id = '${PROFILE_B}';
      select revoke_profile_sessions('${PROFILE_B}');`)
    const live = await q<{ token_hash: string }>(
      `select token_hash from refresh_tokens where token_hash in ('h-a2','h-b2') and revoked_at is null`,
    )
    expect(live.map((r) => r.token_hash)).toEqual(['h-a2'])
    expect(await studios()).toEqual(['Alpha Studio'])
    await db.exec(`update users set deleted_at = null, status = 'active' where user_id = '${PROFILE_B}'`)
  })

  it('does not offer a studio that keeps them as an offline, directory-only entry', async () => {
    await db.exec(`update users set login_enabled = false where user_id = '${PROFILE_B}'`)
    expect(await studios()).toEqual(['Alpha Studio'])
    await db.exec(`set request.jwt.claim.sub = '${PROFILE_B}'`)
    expect(await q(`select 1 from get_auth_context()`)).toHaveLength(0)
    await db.exec(`reset request.jwt.claim.sub`)
    await db.exec(`update users set login_enabled = true where user_id = '${PROFILE_B}'`)
  })

  it('will not let a profile carry an email or a password of its own', async () => {
    await expect(
      db.exec(
        `insert into auth.users (email, encrypted_password, identity_id) values ('x@s.test', null, '${LOGIN}')`,
      ),
    ).rejects.toThrow(/auth_users_profile_shape/)
  })
})
