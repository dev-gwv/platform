import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0291: an email the owner named a platform admin becomes one only once the
 * inbox is proven (the API calls claim_platform_admin after a confirmation link
 * or a Google sign-in), never because a login or a team profile carries it.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const NISHA = 'f5000000-0000-4000-8000-000000000001'
const OTHER = 'f5000000-0000-4000-8000-000000000002'
const STUDIO = 'f5000000-0000-4000-8000-0000000000a1'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const isAdmin = async (id: string) =>
  (await q<{ n: number }>(`select count(*)::int as n from platform_admins where user_id = $1`, [id]))[0]!.n === 1

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
})

describe('a platform admin named by email (0291)', () => {
  it('is not made one just by signing up with the email', async () => {
    await q(`insert into auth.users (id, email) values ($1, 'NishaGraham11@gmail.com'), ($2, 'someone@else.test')`, [NISHA, OTHER])
    expect(await isAdmin(NISHA)).toBe(false)
  })

  it('becomes one once the inbox is proven, and the studio opens for life (0288)', async () => {
    await q(`insert into companies (id, name, owner_user_id) values ($1, 'Nisha Studio', $2)`, [STUDIO, NISHA])
    await q(`insert into users (user_id, company_id, role, name, email, login_enabled) values ($1, $2, 'super_admin', 'Nisha', 'nishagraham11@gmail.com', true)`, [NISHA, STUDIO])
    const [r] = await q<{ ok: boolean }>(`select claim_platform_admin($1) as ok`, [NISHA])
    expect(r!.ok).toBe(true)
    expect(await isAdmin(NISHA)).toBe(true)
    const [y] = await q<{ y: number }>(`select extract(year from grandfathered_until)::int as y from companies where id = $1`, [STUDIO])
    expect(y!.y).toBe(2099)
  })

  it('never makes anyone else one', async () => {
    const [r] = await q<{ ok: boolean }>(`select claim_platform_admin($1) as ok`, [OTHER])
    expect(r!.ok).toBe(false)
    expect(await isAdmin(OTHER)).toBe(false)
  })
})
