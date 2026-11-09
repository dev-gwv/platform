import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/** The client's link to a quotation design (0296): service-only, opens counted once per ten minutes. */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const OWNER = 'f6000000-0000-4000-8000-000000000001'
const CO = 'f6000000-0000-4000-8000-0000000000aa'
const DESIGN = 'f6000000-0000-4000-8000-0000000000d1'
const TOKEN = 'f6000000-0000-4000-8000-000000000001f6000000-0000-4000-8000-000000000002'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'dl@s.test');
    insert into companies (id, name, owner_user_id) values ('${CO}', 'Link Studio', '${OWNER}');
    insert into quotation_designs (id, company_id, title) values ('${DESIGN}', '${CO}', 'Q');
    insert into quotation_design_links (design_id, token) values ('${DESIGN}', '${TOKEN}');
  `)
})

describe('designer client link (0296)', () => {
  it('counts an open once, and a refresh inside ten minutes not again', async () => {
    await q(`select design_link_opened($1)`, [TOKEN])
    await q(`select design_link_opened($1)`, [TOKEN])
    const [r] = await q<{ views: number; first: boolean }>(`select views, first_viewed_at is not null as first from quotation_design_links where design_id = $1`, [DESIGN])
    expect(r).toEqual({ views: 1, first: true })
    await q(`update quotation_design_links set last_viewed_at = now() - interval '11 minutes' where design_id = $1`, [DESIGN])
    await q(`select design_link_opened($1)`, [TOKEN])
    const [s] = await q<{ views: number }>(`select views from quotation_design_links where design_id = $1`, [DESIGN])
    expect(s!.views).toBe(2)
  })

  it('keeps the token from signed-in people and the public', async () => {
    const [g] = await q<{ a: boolean; b: boolean; c: boolean }>(
      `select has_table_privilege('authenticated', 'quotation_design_links', 'select') as a,
              has_table_privilege('anon', 'quotation_design_links', 'select') as b,
              has_function_privilege('authenticated', 'design_link_opened(text)', 'execute') as c`,
    )
    expect(g).toEqual({ a: false, b: false, c: false })
  })

  it('goes with its design', async () => {
    await q(`delete from quotation_designs where id = $1`, [DESIGN])
    const [n] = await q<{ n: number }>(`select count(*)::int as n from quotation_design_links`)
    expect(n!.n).toBe(0)
  })
})
