import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0217: the email log is the service's alone, every studio has photography
 * expense categories (without doubling words it already had), and the
 * Diamond group link is readable by studios but not writable by them.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'f0000000-0000-4000-8000-000000000001'
const COMPANY = 'f0000000-0000-4000-8000-0000000000aa'
const NEW_OWNER = 'f0000000-0000-4000-8000-000000000002'
const NEW_COMPANY = 'f0000000-0000-4000-8000-0000000000ab'

let db: PGlite
const rows = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await rows<T>(sql))[0]!

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
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  // An existing studio, made before 0217, that already had the old lowercase list.
  for (const f of files.filter((x) => x < '0217')) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@e.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Mulberry', '${OWNER}');
    insert into expenses (company_id, category, amount, expense_date) values ('${COMPANY}', 'travel', 900, '2026-09-01');
  `)
  for (const f of files.filter((x) => x >= '0217')) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  // A studio made after 0217.
  await db.exec(`
    insert into auth.users (id, email) values ('${NEW_OWNER}', 'n@e.test');
    insert into companies (id, name, owner_user_id) values ('${NEW_COMPANY}', 'Fresh', '${NEW_OWNER}');
  `)
})

const categories = (company: string) =>
  rows<{ value: string }>(`select value from custom_lookups where company_id = '${company}' and category = 'expense_category'`).then((r) =>
    r.map((x) => x.value),
  )

describe('0217', () => {
  it('keeps the email log away from every client role', async () => {
    for (const role of ['authenticated', 'anon']) {
      const p = await one<{ ok: boolean }>(`select has_table_privilege('${role}', 'email_log', 'select') as ok`)
      expect(p.ok).toBe(false)
    }
    const svc = await one<{ ok: boolean }>(`select has_table_privilege('service_role', 'email_log', 'insert') as ok`)
    expect(svc.ok).toBe(true)
  })

  it('gives an existing studio the photography categories without doubling a word it had', async () => {
    const c = await categories(COMPANY)
    expect(c).toContain('Equipment rental')
    expect(c).toContain('Album & printing')
    // It had 'travel': that becomes 'Travel', not a second entry beside it.
    expect(c.filter((v) => v.toLowerCase() === 'travel')).toEqual(['Travel'])
    expect(c).not.toContain('food')
  })

  it('moves the studio\'s old expenses to the renamed category', async () => {
    const e = await one<{ category: string }>(`select category from expenses where company_id = '${COMPANY}'`)
    expect(e.category).toBe('Travel')
  })

  it('orders the list with the photography set first', async () => {
    const r = await rows<{ value: string }>(
      `select value from custom_lookups where company_id = '${COMPANY}' and category = 'expense_category' order by sort_order, value limit 3`,
    )
    expect(r.map((x) => x.value)).toEqual(['Travel', 'Fuel', 'Food & meals'])
  })

  it('gives a new studio the list through its trigger', async () => {
    const c = await categories(NEW_COMPANY)
    expect(c).toContain('Freelancer fee')
    expect(c).toContain('Hard drives & storage')
  })

  it('lets studios read the Diamond group link but never change it', async () => {
    const read = await one<{ ok: boolean }>(`select has_table_privilege('authenticated', 'platform_settings', 'select') as ok`)
    const write = await one<{ ok: boolean }>(`select has_table_privilege('authenticated', 'platform_settings', 'update') as ok`)
    expect(read.ok).toBe(true)
    expect(write.ok).toBe(false)
    await expect(db.query(`update platform_settings set diamond_group_link = 'http://not-https.example'`)).rejects.toThrow()
    const n = await one<{ n: number }>(`select count(*)::int as n from platform_settings`)
    expect(n.n).toBe(1)
  })
})
