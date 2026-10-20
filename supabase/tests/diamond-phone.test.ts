import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0262: an IPC Diamond member proves it with the mobile number the member
 * list (a Google Sheet, copied into diamond_roster) carries. A match makes
 * the studio Diamond with 30 days from sign-up; one number opens one studio;
 * ten tries a day at most.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const ADMIN = 'd2000000-0000-4000-8000-000000000001'
const A_OWNER = 'd2000000-0000-4000-8000-000000000002'
const B_OWNER = 'd2000000-0000-4000-8000-000000000003'
const A = 'd2000000-0000-4000-8000-0000000000a1'
const B = 'd2000000-0000-4000-8000-0000000000a2'

let db: PGlite
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0]!
const verify = async (company: string, phone: string) =>
  (await one<{ r: string }>(`select diamond_verify_phone('${company}', '${phone}') as r`)).r
const trialDays = async (id: string) =>
  (await one<{ d: number }>(`select round(extract(epoch from grandfathered_until - created_at) / 86400)::int as d from companies where id = '${id}'`)).d
const tier = async (id: string) => (await one<{ t: string }>(`select member_tier as t from companies where id = '${id}'`)).t

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
    insert into auth.users (id, email) values ('${ADMIN}', 'a@s.test'), ('${A_OWNER}', 'a1@s.test'), ('${B_OWNER}', 'b1@s.test');
    insert into platform_admins (user_id) values ('${ADMIN}');
    insert into companies (id, name, owner_user_id) values ('${A}', 'A', '${A_OWNER}'), ('${B}', 'B', '${B_OWNER}');
    insert into diamond_roster (phone, name) values ('9876543210', 'Asha'), ('9123456780', 'Ravi');
  `)
})

describe('Diamond by phone number', () => {
  it('a new studio starts outside, on 7 days', async () => {
    expect(await tier(A)).toBe('outsider')
    expect(await trialDays(A)).toBe(7)
  })

  it('a number not on the list changes nothing', async () => {
    expect(await verify(A, '9000000000')).toBe('not_found')
    expect(await verify(A, '12')).toBe('not_found')
    expect(await tier(A)).toBe('outsider')
  })

  it('a listed number, however it is typed, makes the studio Diamond with 30 days', async () => {
    expect(await verify(A, '+91 98765-43210')).toBe('verified')
    expect(await tier(A)).toBe('diamond')
    expect(await trialDays(A)).toBe(30)
    expect((await one<{ p: string }>(`select diamond_phone as p from companies where id = '${A}'`)).p).toBe('9876543210')
    expect(await verify(A, '9876543210')).toBe('already')
  })

  it('one number opens one studio', async () => {
    expect(await verify(B, '09876543210')).toBe('taken')
    expect(await tier(B)).toBe('outsider')
  })

  it('stops after ten tries a day', async () => {
    for (let i = 0; i < 9; i++) await verify(B, `90000000${String(i).padStart(2, '0')}`)
    expect(await verify(B, '9123456780')).toBe('too_many')
    expect(await tier(B)).toBe('outsider')
  })

  it('a revoke lets the number go', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ADMIN}', false)`)
    await db.query(`select platform_diamond_revoke('${A}', 'not a member')`)
    expect(await tier(A)).toBe('outsider')
    expect((await one<{ p: string | null }>(`select diamond_phone as p from companies where id = '${A}'`)).p).toBeNull()
  })

  it('keeps every miss for the platform owner, who can look up and grant (0277)', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ADMIN}', false)`)
    const misses = (await db.query<{ studio: string; phone: string; why: string; tries: number; on_list: boolean }>(
      `select studio, phone, why, tries, on_list from platform_diamond_misses()`,
    )).rows
    expect(misses.find((m) => m.phone === '9876543210')).toMatchObject({ studio: 'B', why: 'taken', tries: 1, on_list: true })
    expect(misses.find((m) => m.phone === '9000000000')).toMatchObject({ why: 'not_found', on_list: false })

    expect((await one<{ r: { on_list: boolean; name: string } }>(`select platform_diamond_lookup('+91 91234 56780') as r`)).r)
      .toMatchObject({ on_list: true, name: 'Ravi', studio: null })
    await expect(db.query(`select platform_diamond_lookup('123')`)).rejects.toThrow(/ten-digit/)

    await db.query(`select platform_diamond_grant('${B}', '9123456780')`)
    expect(await tier(B)).toBe('diamond')
    expect(await trialDays(B)).toBe(30)
    expect((await db.query(`select 1 from platform_diamond_misses() where company_id = '${B}'`)).rows).toHaveLength(0)

    await db.exec(`select set_config('request.jwt.claim.sub', '${B_OWNER}', false)`)
    await expect(db.query(`select * from platform_diamond_misses()`)).rejects.toThrow(/platform access only/)
    await expect(db.query(`select platform_diamond_grant('${B}', null)`)).rejects.toThrow(/platform access only/)
  })

  it('the list and the check are the service’s alone', async () => {
    await db.exec(`set role authenticated`)
    try {
      await expect(db.query(`select * from diamond_roster`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select diamond_verify_phone('${B}', '9123456780')`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role`)
    }
  })

  it('WhatsApp us goes to the owner’s number', async () => {
    expect((await one<{ w: string }>(`select support_whatsapp as w from platform_settings`)).w).toBe('919109192065')
  })
})
