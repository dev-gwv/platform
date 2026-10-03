import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/** 0238: the unused coupons table is closed to studios; its rows stay. */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
let db: PGlite

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
  await db.exec(`insert into coupons (code, discount_percent) values ('DIWALI20', 20)`)
})

describe('coupons closed (0238)', () => {
  it('a signed-in studio cannot list the codes', async () => {
    await db.exec(`set role authenticated`)
    await expect(db.exec(`select * from coupons`)).rejects.toThrow()
    await db.exec(`reset role`)
  })

  it('keeps the rows', async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from coupons`)
    expect(r.rows[0]!.n).toBe(1)
  })
})
