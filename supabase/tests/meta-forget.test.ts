import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/** 0230: Disconnect Facebook forgets the pages and tokens, never the leads. */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'b2300000-0000-4000-8000-000000000001'
const OTHER = 'b2300000-0000-4000-8000-000000000002'
const STUDIO = 'b2300000-0000-4000-8000-0000000000aa'
const ELSEWHERE = 'b2300000-0000-4000-8000-0000000000bb'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const n = async (sql: string) => (await q<{ n: number }>(`select count(*)::int as n from ${sql}`))[0]!.n

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@studio.in'), ('${OTHER}', 'x@other.in');
    insert into companies (id, name, owner_user_id) values ('${STUDIO}', 'Mulberry', '${OWNER}'), ('${ELSEWHERE}', 'Other', '${OTHER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Owner', 'o@studio.in', 'active'),
      ('${OTHER}', '${ELSEWHERE}', 'super_admin', 'Other', 'x@other.in', 'active');
    insert into fb_pages (company_id, page_id, page_name, is_connected, webhook_subscribed) values
      ('${STUDIO}', '111', 'The Mulberry Weddings Delhi', true, true),
      ('${STUDIO}', '222', 'Another page', false, false),
      ('${ELSEWHERE}', '333', 'Someone else', true, true);
    insert into fb_page_tokens (company_id, page_id, token_enc) values
      ('${STUDIO}', '111', 'sealed-a'), ('${STUDIO}', '222', 'sealed-b'), ('${ELSEWHERE}', '333', 'sealed-c');
    insert into crm_leads (company_id, name, phone, source) values ('${STUDIO}', 'Riya', '9876500001', 'facebook');
    insert into fb_lead_imports (company_id, page_id, page_name, leadgen_id, name, status) values
      ('${STUDIO}', '111', 'The Mulberry Weddings Delhi', 'lg1', 'Riya', 'imported');
  `)
})

describe('0230 Disconnect Facebook', () => {
  it('forgets every page and token of the studio and keeps its leads and import log', async () => {
    const [r] = await q<{ n: number }>(`select meta_forget_studio('${STUDIO}') as n`)
    expect(r!.n).toBe(2)
    expect(await n(`fb_pages where company_id = '${STUDIO}'`)).toBe(0)
    expect(await n(`fb_page_tokens where company_id = '${STUDIO}'`)).toBe(0)
    expect(await n(`crm_leads where company_id = '${STUDIO}'`)).toBe(1)
    expect(await n(`fb_lead_imports where company_id = '${STUDIO}'`)).toBe(1)
  })

  it('leaves another studio alone', async () => {
    expect(await n(`fb_pages where company_id = '${ELSEWHERE}'`)).toBe(1)
    expect(await n(`fb_page_tokens where company_id = '${ELSEWHERE}'`)).toBe(1)
  })

  it('is not callable by a signed-in user', async () => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${OWNER}';`)
    const err = await db.query(`select meta_forget_studio('${ELSEWHERE}')`).then(() => null, (e: Error) => e.message)
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
    expect(err).toMatch(/permission denied/)
  })
})
