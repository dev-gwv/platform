import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0238: a new studio gets each expense category once (the old lowercase
 * seed no longer runs beside 0217's list), and a studio made in between has
 * its lowercase twins switched off with their expenses moved across.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const MID_OWNER = 'f1000000-0000-4000-8000-000000000001'
const MID = 'f1000000-0000-4000-8000-0000000000aa'
const NEW_OWNER = 'f1000000-0000-4000-8000-000000000002'
const NEW = 'f1000000-0000-4000-8000-0000000000ab'

let db: PGlite
const rows = async <T>(sql: string) => (await db.query<T>(sql)).rows

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  for (const f of files.filter((x) => x < '0238')) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  // A studio made after 0217 but before 0238: it got both lists.
  await db.exec(`
    insert into auth.users (id, email) values ('${MID_OWNER}', 'm@e.test');
    insert into companies (id, name, owner_user_id) values ('${MID}', 'Midway', '${MID_OWNER}');
    insert into expenses (company_id, category, amount, expense_date) values ('${MID}', 'food', 400, '2026-09-01');
    insert into expenses (company_id, category, amount, expense_date) values ('${MID}', 'equipment', 1200, '2026-09-02');
  `)
  for (const f of files.filter((x) => x >= '0238')) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${NEW_OWNER}', 'n@e.test');
    insert into companies (id, name, owner_user_id) values ('${NEW}', 'Fresh', '${NEW_OWNER}');
  `)
})

const active = (company: string) =>
  rows<{ value: string }>(
    `select value from custom_lookups where company_id = '${company}' and category = 'expense_category' and is_active`,
  ).then((r) => r.map((x) => x.value))

describe('expense categories once (0238)', () => {
  it('a new studio has no lowercase twin of any category', async () => {
    const c = await active(NEW)
    expect(c).toContain('Travel')
    const lower = c.filter((v) => v === v.toLowerCase())
    expect(lower).toEqual([])
  })

  it('a studio made in between keeps one Food & meals and its expense moves there', async () => {
    const c = await active(MID)
    expect(c).toContain('Food & meals')
    expect(c).not.toContain('food')
    expect(c).not.toContain('travel')
    const e = await rows<{ category: string }>(`select category from expenses where company_id = '${MID}' and amount = 400`)
    expect(e[0]!.category).toBe('Food & meals')
  })

  it('keeps a lowercase word the studio has used and has no twin for', async () => {
    const c = await active(MID)
    expect(c).toContain('equipment')
    expect(c).not.toContain('supplies')
  })

  it('switches off, never deletes', async () => {
    const r = await rows<{ n: number }>(
      `select count(*)::int as n from custom_lookups where company_id = '${MID}' and category = 'expense_category' and value = 'food'`,
    )
    expect(r[0]!.n).toBe(1)
  })
})
