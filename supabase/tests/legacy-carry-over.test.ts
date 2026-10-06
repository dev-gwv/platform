import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0218: the old app's subscribers come in from its Studio Access export, and
 * a studio signing up here with the same email keeps the paid time it had.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER_EMAIL = 'connect@wpbmastery.in'
const ADMIN = 'e0000000-0000-4000-8000-000000000001'
/** 0246: the second platform admin, the owner's other login. */
const MULBERRY = 'e0000000-0000-4000-8000-000000000003'
const STRANGER = 'e0000000-0000-4000-8000-000000000002'

let db: PGlite
const rows = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await rows<T>(sql))[0]!
const as = (uid: string | null) => db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`)
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** A studio made the way sign-up makes one. */
async function signUp(uid: string, email: string, name: string) {
  await db.exec(`insert into auth.users (id, email) values ('${uid}', '${email}')`)
  const c = await one<{ company_id: string }>(
    `select company_id from register_company_and_admin_as('${uid}', '${name}', 'Owner', null)`,
  )
  return c.company_id
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  // The owner's account exists before 0218 runs, as on the live server.
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  for (const f of files.filter((x) => x < '0218')) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', '${OWNER_EMAIL}'), ('${MULBERRY}', ' Connect@TheMulberryWeddings.in ')`)
  for (const f of files.filter((x) => x >= '0218')) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  // Sign-up, run as the new person (register_company_and_admin reads auth.uid()).
  await db.exec(`
    create or replace function register_company_and_admin_as(p_uid uuid, p_name text, p_admin text, p_phone text)
    returns table (company_id uuid) language plpgsql as $f$
    begin
      perform set_config('request.jwt.claim.sub', p_uid::text, true);
      return query select r.company_id from register_company_and_admin(p_name, p_admin, p_phone) r;
    end $f$;
  `)
})

describe('0218 studio access carry-over', () => {
  it("makes the owner's account a platform admin", async () => {
    const r = await one<{ n: number }>(`select count(*)::int as n from platform_admins where user_id = '${ADMIN}'`)
    expect(r.n).toBe(1)
  })

  it('0246: connect@themulberryweddings.in is a platform admin too, and a stranger is not', async () => {
    const r = await rows<{ user_id: string }>(`select user_id from platform_admins where user_id in ('${MULBERRY}', '${STRANGER}')`)
    expect(r.map((x) => x.user_id)).toEqual([MULBERRY])
  })

  it('keeps the imported list away from every client role', async () => {
    for (const role of ['authenticated', 'anon']) {
      const p = await one<{ ok: boolean }>(`select has_table_privilege('${role}', 'legacy_studios', 'select') as ok`)
      expect(p.ok).toBe(false)
    }
  })

  it('updates a re-imported studio instead of adding it twice', async () => {
    const up = (name: string) => `
      insert into legacy_studios (old_company_id, studio_name, email, expires_at)
      values ('old-1', '${name}', 'ark@example.com', '${future(40)}')
      on conflict (old_company_id) do update set studio_name = excluded.studio_name`
    await db.exec(up('ARK'))
    await db.exec(up('ARK Pictures'))
    const r = await rows<{ studio_name: string }>(`select studio_name from legacy_studios where old_company_id = 'old-1'`)
    expect(r.map((x) => x.studio_name)).toEqual(['ARK Pictures'])
  })

  it('gives a studio signing up with the old email the paid time it had', async () => {
    const company = await signUp('e0000000-0000-4000-8000-0000000000a1', 'ark@example.com', 'ARK Pictures')
    const c = await one<{ until: string }>(`select plan_expiry::date::text as until from companies where id = '${company}'`)
    expect(c.until).toBe(future(41))
    const l = await one<{ joined: string | null }>(`select joined_company_id as joined from legacy_studios where old_company_id = 'old-1'`)
    expect(l.joined).toBe(company)
  })

  it('never shortens a studio that already has longer', async () => {
    await db.exec(`insert into legacy_studios (old_company_id, studio_name, email, expires_at) values ('old-2', 'Modern', 'mm@example.com', '${future(10)}')`)
    const company = await signUp('e0000000-0000-4000-8000-0000000000a2', 'someone@example.com', 'Modern Memories')
    await db.exec(`update companies set plan_expiry = now() + interval '200 days' where id = '${company}'`)
    await db.exec(`update users set email = 'mm@example.com' where company_id = '${company}'`)
    await db.exec(`select legacy_carry_over('${company}')`)
    const c = await one<{ days: number }>(`select (plan_expiry::date - current_date) as days from companies where id = '${company}'`)
    expect(c.days).toBeGreaterThanOrEqual(199)
  })

  it('marks an expired old studio joined but carries no time', async () => {
    await db.exec(`insert into legacy_studios (old_company_id, studio_name, email, expires_at) values ('old-3', 'Gone', 'gone@example.com', '2025-01-01')`)
    const company = await signUp('e0000000-0000-4000-8000-0000000000a3', 'gone@example.com', 'Gone Films')
    const c = await one<{ plan_expiry: string | null }>(`select plan_expiry from companies where id = '${company}'`)
    expect(c.plan_expiry).toBeNull()
    const l = await one<{ joined: string | null }>(`select joined_company_id as joined from legacy_studios where old_company_id = 'old-3'`)
    expect(l.joined).toBe(company)
  })

  it('shows the list to a platform admin only', async () => {
    await db.exec(`insert into auth.users (id, email) values ('${STRANGER}', 'x@example.com')`)
    await as(STRANGER)
    await expect(db.query(`select * from platform_legacy_studios()`)).rejects.toThrow(/platform access only/)
    await as(ADMIN)
    const r = await rows<{ old_company_id: string; joined_name: string | null }>(`select old_company_id, joined_name from platform_legacy_studios()`)
    expect(r.find((x) => x.old_company_id === 'old-1')?.joined_name).toBe('ARK Pictures')
    await as(null)
  })
})
