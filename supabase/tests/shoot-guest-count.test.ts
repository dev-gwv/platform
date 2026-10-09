import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/** 0251: a shoot day carries how many guests it expects. */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const CLIENT = '33333333-3333-3333-3333-333333333333'
const PROJECT = '44444444-4444-4444-4444-444444444444'

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Priya Mehta');
    insert into projects (id, company_id, client_id, name) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Mehta Wedding');
  `)
})

const insert = (guests: string) =>
  db.query<{ guest_count: number | null }>(
    `insert into shoots (company_id, project_id, name, guest_count)
     values ('${COMPANY}', '${PROJECT}', 'Reception', ${guests}) returning guest_count`,
  )

describe('shoot guest count (0251)', () => {
  it('is blank until someone says', async () => {
    const r = await db.query<{ guest_count: number | null }>(
      `insert into shoots (company_id, project_id, name) values ('${COMPANY}', '${PROJECT}', 'Haldi') returning guest_count`,
    )
    expect(r.rows[0]!.guest_count).toBeNull()
  })

  it('keeps a headcount', async () => {
    expect((await insert('350')).rows[0]!.guest_count).toBe(350)
  })

  it('refuses a negative or absurd number', async () => {
    await expect(insert('-1')).rejects.toThrow()
    await expect(insert('100001')).rejects.toThrow()
  })
})
