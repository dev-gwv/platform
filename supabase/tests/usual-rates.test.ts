import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/** 0233: a person's usual wedding-day and half-day rates, never negative. */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e3000000-0000-4000-8000-000000000001'
const COMPANY = 'e3000000-0000-4000-8000-0000000000aa'

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
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@r.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@r.test');
  `)
})

describe('usual rates (0233)', () => {
  it('keeps a wedding-day and a half-day rate beside the day rate', async () => {
    await db.exec(`update users set freelancer_rate = 8000, rate_wedding_day = 10000, rate_half_day = 4500 where user_id = '${OWNER}'`)
    const r = (await db.query<{ w: string; h: string }>(`select rate_wedding_day::text as w, rate_half_day::text as h from users where user_id = '${OWNER}'`)).rows[0]
    expect(r).toEqual({ w: '10000.00', h: '4500.00' })
  })

  it('refuses a negative rate', async () => {
    await expect(db.exec(`update users set rate_wedding_day = -1 where user_id = '${OWNER}'`)).rejects.toThrow()
    await expect(db.exec(`update users set rate_half_day = -1 where user_id = '${OWNER}'`)).rejects.toThrow()
  })
})
