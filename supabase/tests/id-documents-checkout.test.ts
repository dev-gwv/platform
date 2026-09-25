import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0178: ID proof is private to the member and the owner -- a teammate cannot
 * read it even knowing its id -- and a check-out after midnight closes the
 * shift that began the day before.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'd0000000-0000-4000-8000-000000000001'
const PRIYA = 'd0000000-0000-4000-8000-000000000002'
const AMAN = 'd0000000-0000-4000-8000-000000000003'
const COMPANY = 'd0000000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)
const fails = async (sql: string) => {
  try {
    await db.query(sql)
  } catch (e) {
    return (e as Error).message
  }
  return null
}

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
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test'), ('${AMAN}', 'a@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, created_at) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test', '2020-01-01'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test', '2020-01-01'),
      ('${AMAN}', '${COMPANY}', 'employee', 'Aman', 'a@s.test', '2020-01-01');
  `)
})

describe('ID proof', () => {
  it('only the member and the owner can see it', async () => {
    await as(PRIYA)
    await db.exec(`set role authenticated`)
    await q(`insert into member_documents (company_id, user_id, kind, name, mime, size_bytes, bytes)
             values ('${COMPANY}', '${PRIYA}', 'aadhaar', 'a.jpg', 'image/jpeg', 3, '\\x010203')`)
    expect(await q(`select kind from member_documents`)).toEqual([{ kind: 'aadhaar' }])
    // Nobody files an ID in someone else's name.
    expect(
      await fails(`insert into member_documents (company_id, user_id, kind, name, mime, size_bytes, bytes)
                   values ('${COMPANY}', '${AMAN}', 'aadhaar', 'x.jpg', 'image/jpeg', 3, '\\x010203')`),
    ).toMatch(/row-level security/)
    await as(AMAN)
    expect(await q(`select id from member_documents`)).toEqual([])
    expect(await q(`delete from member_documents returning id`)).toEqual([])
    await as(OWNER)
    expect(await q(`select kind from member_documents where user_id = '${PRIYA}'`)).toEqual([{ kind: 'aadhaar' }])
    await db.exec(`reset role`)
  })

  it('refuses anything but a photo or a PDF', async () => {
    expect(
      await fails(`insert into member_documents (company_id, user_id, kind, name, mime, size_bytes, bytes)
                   values ('${COMPANY}', '${PRIYA}', 'other', 'x.exe', 'application/x-msdownload', 3, '\\x010203')`),
    ).toMatch(/check constraint/)
  })
})

describe('check-out after midnight', () => {
  it('closes the shift that began last night', async () => {
    await as(PRIYA)
    await db.exec(`
      insert into attendance (company_id, user_id, a_date, check_in_at, status)
      values ('${COMPANY}', '${PRIYA}', ((now() - interval '5 hours') at time zone 'Asia/Kolkata')::date,
              now() - interval '5 hours', 'present')`)
    const [{ id }] = (await q<{ id: string }>(`select check_out() as id`)) as [{ id: string }]
    const [row] = await q<{ closed: boolean }>(`select check_out_at is not null as closed from attendance where id = '${id}'`)
    expect(row).toEqual({ closed: true })
    // A second tap does not move the first check-out.
    expect(await fails(`select check_out()`)).toMatch(/no_open_check_in/)
  })

  it('leaves a shift forgotten for more than 20 hours to a manager', async () => {
    await as(AMAN)
    await db.exec(`
      insert into attendance (company_id, user_id, a_date, check_in_at, status)
      values ('${COMPANY}', '${AMAN}', (now() - interval '2 days')::date, now() - interval '30 hours', 'present')`)
    expect(await fails(`select check_out()`)).toMatch(/no_open_check_in/)
  })
})
