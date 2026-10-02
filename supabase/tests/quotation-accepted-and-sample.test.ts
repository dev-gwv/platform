import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0231: a client's Accept rings the bell for the owner and the project's
 * creator, once. 0232: every studio starts with one sample project template,
 * and a deleted sample never comes back.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e0000000-0000-4000-8000-000000000001'
const MANAGER = 'e0000000-0000-4000-8000-000000000002'
const COMPANY = 'e0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'e0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'e0000000-0000-4000-8000-0000000000b1'
const OTHER = 'e0000000-0000-4000-8000-0000000000ab'

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${MANAGER}', 'm@s.test');
    insert into companies (id, name, owner_user_id, quote_number_prefix) values ('${COMPANY}', 'Studio', '${OWNER}', 'QT-');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${MANAGER}', '${COMPANY}', 'manager', 'Manager', 'm@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by, show_quotation)
      values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${MANAGER}', true);
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

const issue = async () => one<{ quotation_id: string; token: string }>(`select * from issue_project_quotation('${PROJECT}')`)
const respond = (token: string, accept: boolean) =>
  one<{ ok: boolean }>(`select respond_to_quotation('${token}', ${accept}, 'Priya', '1.2.3.4', 'test') as ok`)
const notices = () =>
  q<{ recipient_uid: string; title: string; body: string; deep_link: string }>(
    `select recipient_uid, title, body, deep_link from notifications where type = 'quotation_accepted' order by recipient_uid`,
  )

describe('a client accepting a quotation (0231)', () => {
  it('tells the owner and the project creator, once each', async () => {
    const { token } = await issue()
    expect((await respond(token, true)).ok).toBe(true)
    const n = await notices()
    expect(n.map((x) => x.recipient_uid).sort()).toEqual([OWNER, MANAGER].sort())
    expect(n[0]!.title).toBe('Priya accepted the quotation')
    expect(n[0]!.body).toMatch(/^Sharma Wedding/)
    expect(n[0]!.deep_link).toBe(`/projects/${PROJECT}/quotation`)
  })

  it('does not ring again for accept, decline, accept', async () => {
    const { token } = await issue()
    await db.exec(`delete from notifications`)
    await respond(token, true)
    await respond(token, false)
    await respond(token, true)
    expect((await notices()).length).toBe(2)
  })

  it('says nothing for a decline, and refuses a hidden quotation', async () => {
    const { token } = await issue()
    await db.exec(`delete from notifications`)
    expect((await respond(token, false)).ok).toBe(true)
    expect((await notices()).length).toBe(0)
    const fresh = await issue()
    await db.exec(`update projects set show_quotation = false where id = '${PROJECT}'`)
    expect((await respond(fresh.token, true)).ok).toBe(false)
    expect((await notices()).length).toBe(0)
    await db.exec(`update projects set show_quotation = true where id = '${PROJECT}'`)
  })
})

describe('the sample project template (0232)', () => {
  it('gives a studio exactly one sample', async () => {
    const rows = await q<{ name: string; is_sample: boolean; shoots: number }>(
      `select name, is_sample, jsonb_array_length(shoots_json) as shoots from project_templates where company_id = '${COMPANY}'`,
    )
    expect(rows).toEqual([{ name: 'Sample — Wedding', is_sample: true, shoots: 3 }])
  })

  it('seeds a new studio, and a deleted sample never comes back', async () => {
    await db.exec(`insert into companies (id, name, owner_user_id) values ('${OTHER}', 'Other', '${OWNER}')`)
    expect((await one<{ n: number }>(`select count(*)::int as n from project_templates where company_id = '${OTHER}'`)).n).toBe(1)
    await db.exec(`delete from project_templates where company_id = '${OTHER}'`)
    await db.exec(`update companies set name = 'Other studio' where id = '${OTHER}'`)
    expect((await one<{ n: number }>(`select count(*)::int as n from project_templates where company_id = '${OTHER}'`)).n).toBe(0)
  })

  it('is not callable by a signed-in user', async () => {
    const r = await one<{ ok: boolean }>(
      `select has_function_privilege('authenticated', 'seed_sample_project_template(uuid)', 'execute') as ok`,
    )
    expect(r.ok).toBe(false)
  })
})
