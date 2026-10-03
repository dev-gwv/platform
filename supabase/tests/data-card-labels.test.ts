import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/** 0239: a data record keeps its cards by name, and the count follows them. */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a1000000-0000-4000-8000-000000000001'
const COMPANY = 'a1000000-0000-4000-8000-0000000000aa'
const CLIENT = 'a1000000-0000-4000-8000-0000000000c1'
const PROJECT = 'a1000000-0000-4000-8000-0000000000b1'

let db: PGlite
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0]!

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
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Client');
    insert into projects (id, company_id, client_id, name) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Wedding');
  `)
})

describe('card labels (0239)', () => {
  it('counts at least the cards named', async () => {
    const r = await one<{ card_count: number; card_labels: string[] }>(`
      insert into shoot_data_records (company_id, project_id, data_label, card_count, card_labels)
      values ('${COMPANY}', '${PROJECT}', 'Camera A', 1, array['SD-01','SD-02','SD-04'])
      returning card_count, card_labels`)
    expect(r.card_count).toBe(3)
    expect(r.card_labels).toEqual(['SD-01', 'SD-02', 'SD-04'])
  })

  it('keeps a bigger count when only some cards are named, and a count with no names', async () => {
    const a = await one<{ card_count: number }>(`
      insert into shoot_data_records (company_id, project_id, data_label, card_count, card_labels)
      values ('${COMPANY}', '${PROJECT}', 'Camera B', 5, array['CF-1']) returning card_count`)
    expect(a.card_count).toBe(5)
    const b = await one<{ card_count: number; card_labels: string[] }>(`
      insert into shoot_data_records (company_id, project_id, data_label, card_count)
      values ('${COMPANY}', '${PROJECT}', 'Camera C', 2) returning card_count, card_labels`)
    expect(b.card_count).toBe(2)
    expect(b.card_labels).toEqual([])
  })

  it('follows names added later', async () => {
    const r = await one<{ card_count: number }>(`
      update shoot_data_records set card_labels = array['A','B','C','D'] where data_label = 'Camera C' returning card_count`)
    expect(r.card_count).toBe(4)
  })
})
