import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0292: Import from Google Drive is for Pro and above (owner, 31 Oct). A
 * running Starter plan, Diamond or regular, is refused; Pro and Studio Max
 * carry it; a trial keeps it.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const id = (n: number) => `f9200000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const STUDIOS = {
  starter: { co: id(0xa1), owner: id(1), plan: 'starter_yearly' },
  starterRegular: { co: id(0xa2), owner: id(2), plan: 'starter_monthly_regular' },
  pro: { co: id(0xa3), owner: id(3), plan: 'pro_yearly' },
  max: { co: id(0xa4), owner: id(4), plan: 'max_monthly_regular' },
  trial: { co: id(0xa5), owner: id(5), plan: null },
} as const

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const can = async (co: string) => (await q<{ ok: boolean }>(`select company_drive_import($1) as ok`, [co]))[0]!.ok

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  for (const [name, s] of Object.entries(STUDIOS)) {
    await q(`insert into auth.users (id, email) values ($1, $2)`, [s.owner, `${name}@s.test`])
    if (s.plan) {
      await q(`insert into companies (id, name, owner_user_id, plan, plan_expiry) values ($1, $2, $3, $4, now() + interval '100 days')`, [s.co, name, s.owner, s.plan])
    } else {
      await q(`insert into companies (id, name, owner_user_id) values ($1, $2, $3)`, [s.co, name, s.owner])
    }
  }
})

describe('Import from Google Drive by plan (0292)', () => {
  it('is on every Pro and Studio Max plan row, and on no Starter one', async () => {
    const rows = await q<{ tier: string; has: boolean }>(`select tier, 'drive_import' = any (includes) as has from plans where tier is not null`)
    expect(rows.length).toBeGreaterThan(5)
    for (const r of rows) expect(r.has).toBe(r.tier !== 'starter')
  })

  it('refuses a running Starter plan, Diamond or regular', async () => {
    expect(await can(STUDIOS.starter.co)).toBe(false)
    expect(await can(STUDIOS.starterRegular.co)).toBe(false)
  })

  it('opens it on Pro and Studio Max, and on a trial', async () => {
    expect(await can(STUDIOS.pro.co)).toBe(true)
    expect(await can(STUDIOS.max.co)).toBe(true)
    expect(await can(STUDIOS.trial.co)).toBe(true)
  })

  it('is safe to run twice', async () => {
    await db.exec(readFileSync(join(migDir, '0292_drive_import_pro_and_above.sql'), 'utf8'))
    const [r] = await q<{ n: number }>(`select max(array_length(array_positions(includes, 'drive_import'), 1)) as n from plans`)
    expect(r!.n).toBe(1)
  })
})
