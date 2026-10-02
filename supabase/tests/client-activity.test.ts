import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0235: a client's opens of a document link, for the project's Overview --
 * one per ten minutes, never the studio's own people, read only by the studio.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e3500000-0000-4000-8000-000000000001'
const OTHER_OWNER = 'e3500000-0000-4000-8000-000000000002'
const COMPANY = 'e3500000-0000-4000-8000-0000000000aa'
const OTHER = 'e3500000-0000-4000-8000-0000000000ab'
const CLIENT = 'e3500000-0000-4000-8000-0000000000c1'
const PROJECT = 'e3500000-0000-4000-8000-0000000000b1'
const QUOTE = 'e3500000-0000-4000-8000-0000000000d1'
const RAW = 'raw-quote-token'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)
const record = async (raw = RAW, viewer: string | null = null) =>
  (await q<{ ok: boolean }>(`select record_client_view('quotation', '${raw}', ${viewer ? `'${viewer}'` : 'null'}) as ok`))[0]!.ok

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
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@ca.test'), ('${OTHER_OWNER}', 'x@ca.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@ca.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@ca.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
    insert into project_quotations (id, company_id, project_id, snapshot) values ('${QUOTE}', '${COMPANY}', '${PROJECT}', '{}');
    insert into access_tokens (company_id, purpose, subject_id, token_hash)
    values ('${COMPANY}', 'quotation', '${QUOTE}', encode(sha256(convert_to('${RAW}', 'UTF8')), 'hex'));
  `)
})

beforeEach(async () => {
  await db.exec(`reset role; delete from client_document_views;`)
})

describe('record_client_view', () => {
  it('records the client opening the quotation, against its project', async () => {
    expect(await record()).toBe(true)
    const rows = await q<{ project_id: string; kind: string }>(`select project_id, kind from client_document_views`)
    expect(rows).toEqual([{ project_id: PROJECT, kind: 'quotation' }])
  })

  it('counts a refresh inside ten minutes once', async () => {
    await record()
    expect(await record()).toBe(false)
    await db.exec(`update client_document_views set viewed_at = now() - interval '11 minutes'`)
    expect(await record()).toBe(true)
    expect(await q(`select 1 from client_document_views`)).toHaveLength(2)
  })

  it('leaves out the studio itself, but not someone from another studio', async () => {
    expect(await record(RAW, OWNER)).toBe(false)
    expect(await record(RAW, OTHER_OWNER)).toBe(true)
  })

  it('ignores a token it does not know, and a kind it does not keep', async () => {
    expect(await record('nope')).toBe(false)
    expect((await q<{ ok: boolean }>(`select record_client_view('receipt', '${RAW}', null) as ok`))[0]!.ok).toBe(false)
  })
})

describe('client_activity', () => {
  it('reads the opens to the studio, and to nobody else', async () => {
    await record()
    await db.exec(`update client_document_views set viewed_at = now() - interval '11 minutes'`)
    await record()
    await as(OWNER)
    const mine = await q<{ kind: string; views: number }>(`select kind, views from client_activity('${PROJECT}')`)
    expect(mine).toEqual([{ kind: 'quotation', views: 2 }])
    await as(OTHER_OWNER)
    expect(await q(`select * from client_activity('${PROJECT}')`)).toHaveLength(0)
  })
})
