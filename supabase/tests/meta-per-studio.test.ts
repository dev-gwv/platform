import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0204: each studio connects its own Facebook page. The page id in Meta's
 * post finds the studio and its lead-ads source; the page token is never
 * readable by anyone signed in.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e4000000-0000-4000-8000-000000000001'
const COMPANY = 'e4000000-0000-4000-8000-0000000000aa'
const OTHER = 'e4000000-0000-4000-8000-0000000000bb'
const OTHER_OWNER = 'e4000000-0000-4000-8000-000000000002'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
type Found = { company_id: string; source_key: string; page_name: string }
const find = (pageId: string) => q<Found>(`select * from meta_page_company('${pageId}')`)

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${OTHER_OWNER}', 'p@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}'), ('${OTHER}', 'Other Studio', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'o@s.test', 'active'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Prem', 'p@s.test', 'active');
    grant usage on schema auth to authenticated;
  `)
})

beforeEach(async () => {
  await db.exec(`delete from crm_leads; delete from fb_page_tokens; delete from fb_pages; delete from crm_webhook_sources;`)
})

describe('meta_page_company', () => {
  it('finds the studio behind a connected page and makes its lead-ads source once', async () => {
    await db.exec(`insert into fb_pages (company_id, page_id, page_name, is_connected) values ('${COMPANY}', '111', 'Asha Weddings', true)`)
    const [first] = await find('111')
    expect(first).toMatchObject({ company_id: COMPANY, page_name: 'Asha Weddings' })
    expect(first!.source_key).toMatch(/^meta_[0-9a-f]{32}$/)
    const [again] = await find('111')
    expect(again!.source_key).toBe(first!.source_key)
    const sources = await q<{ label: string; kind: string; default_source: string }>(
      `select label, kind, default_source from crm_webhook_sources where company_id = '${COMPANY}'`,
    )
    expect(sources).toEqual([{ label: 'Facebook lead ads', kind: 'meta', default_source: 'facebook' }])

    // And the source captures a lead as Facebook's, for that studio.
    const [{ id }] = await q<{ id: string }>(
      `select capture_lead('${first!.source_key}', 'Riya', '98765 43210', null, '{"page_id":"111"}') as id`,
    )
    const [lead] = await q<{ company_id: string; source: string }>(`select company_id, source from crm_leads where id = '${id}'`)
    expect(lead).toEqual({ company_id: COMPANY, source: 'facebook' })
  })

  it('reuses a lead-ads source the studio already had', async () => {
    await db.exec(`insert into crm_webhook_sources (company_id, source_key, kind, label) values ('${COMPANY}', 'meta_old', 'meta', 'Old')`)
    await db.exec(`insert into fb_pages (company_id, page_id, page_name, is_connected) values ('${COMPANY}', '222', 'P', true)`)
    expect((await find('222'))[0]!.source_key).toBe('meta_old')
  })

  it('knows nothing of a page that is not connected, or never seen', async () => {
    await db.exec(`insert into fb_pages (company_id, page_id, page_name, is_connected) values ('${COMPANY}', '333', 'P', false)`)
    expect(await find('333')).toEqual([])
    expect(await find('nope')).toEqual([])
  })
})

describe('page tokens', () => {
  it('belong to one studio only, and nobody signed in can read them', async () => {
    await db.exec(`insert into fb_page_tokens (company_id, page_id, token_enc) values ('${COMPANY}', '111', 'v1:sealed')`)
    await expect(db.exec(`insert into fb_page_tokens (company_id, page_id, token_enc) values ('${OTHER}', '111', 'v1:other')`)).rejects.toThrow()
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${OWNER}', false);`)
    await expect(db.query(`select token_enc from fb_page_tokens`)).rejects.toThrow(/permission denied/)
    await db.exec(`reset role;`)
  })
})
