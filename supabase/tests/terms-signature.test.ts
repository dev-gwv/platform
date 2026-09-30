import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0220: the client signs the terms with a finger, and the platform admin
 * sets a studio's access to an exact date.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e2200000-0000-4000-8000-000000000001'
const ADMIN = 'e2200000-0000-4000-8000-000000000002'
const COMPANY = 'e2200000-0000-4000-8000-0000000000aa'
const CLIENT = 'e2200000-0000-4000-8000-0000000000c1'
const PROJECT = 'e2200000-0000-4000-8000-0000000000b1'
const SIG = 'data:image/png;base64,iVBORw0KGgo='

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${ADMIN}', 'a@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'TMW', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
    insert into clients (id, company_id, name, email) values ('${CLIENT}', '${COMPANY}', 'Pulkit', 'pulkit@example.com');
    insert into projects (id, company_id, client_id, name, package_cost) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Pulkit Wedding', 150000);
    insert into platform_admins (user_id) values ('${ADMIN}');
  `)
})

beforeEach(async () => {
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
  await db.exec(`delete from project_terms_documents; delete from access_tokens where purpose = 'terms_ack';`)
})

const issue = () =>
  one<{ document_id: string; token: string }>(`select * from issue_client_terms('${PROJECT}', 'Clause one', 'Terms', null, 150000, null, 336)`)
const signature = (doc: string) =>
  one<{ s: string | null }>(`select acknowledged_signature as s from project_terms_documents where id = '${doc}'`).then((r) => r.s)

describe('signing the terms', () => {
  it('keeps the signature drawn when the client agrees, and shows it on their link', async () => {
    const { document_id, token } = await issue()
    await db.query(`select acknowledge_terms('${token}', 'Pulkit')`)
    expect((await one<{ ok: boolean }>(`select terms_sign('${token}', '${SIG}') as ok`)).ok).toBe(true)
    expect(await signature(document_id)).toBe(SIG)
    expect((await one<{ s: string }>(`select terms_signature_for_token('${token}') as s`)).s).toBe(SIG)
  })

  it('takes no signature before agreeing, a second one, or something that is not a picture', async () => {
    const { document_id, token } = await issue()
    expect((await one<{ ok: boolean }>(`select terms_sign('${token}', '${SIG}') as ok`)).ok).toBe(false)
    await db.query(`select acknowledge_terms('${token}', 'Pulkit')`)
    expect((await one<{ ok: boolean }>(`select terms_sign('${token}', 'javascript:alert(1)') as ok`)).ok).toBe(false)
    await db.query(`select terms_sign('${token}', '${SIG}')`)
    expect((await one<{ ok: boolean }>(`select terms_sign('${token}', '${SIG}AA') as ok`)).ok).toBe(false)
    expect(await signature(document_id)).toBe(SIG)
  })

  it('is out of reach of the browser roles', async () => {
    for (const fn of ['terms_sign(text, text)', 'terms_signature_for_token(text)']) {
      const r = await one<{ ok: boolean }>(`select has_function_privilege('anon', '${fn}', 'execute') or has_function_privilege('authenticated', '${fn}', 'execute') as ok`)
      expect(r.ok).toBe(false)
    }
  })
})

describe('access to an exact date', () => {
  it('ends access at the end of the chosen day in India time, for a platform admin only', async () => {
    await expect(db.query(`select platform_set_access_until('${COMPANY}', current_date + 40)`)).rejects.toThrow(/platform access only/)
    await db.exec(`set request.jwt.claim.sub = '${ADMIN}';`)
    const r = await one<{ d: string }>(`
      select (platform_set_access_until('${COMPANY}', '2099-03-10') at time zone 'Asia/Kolkata')::text as d`)
    expect(r.d).toBe('2099-03-11 00:00:00')
    await expect(db.query(`select platform_set_access_until('${COMPANY}', '2000-01-01')`)).rejects.toThrow(/today or a later date/)
  })
})
