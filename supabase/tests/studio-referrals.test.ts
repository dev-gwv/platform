import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Refer a studio (0237): each studio gets one code, a new studio is linked to
 * the one whose code it came with -- never to itself, never twice -- and the
 * referrer sees only the referred studio's name and dates.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const A = 'f0000000-0000-4000-8000-00000000000a'
const B = 'f0000000-0000-4000-8000-00000000000b'
const C = 'f0000000-0000-4000-8000-00000000000c'
const UA = 'f0000000-0000-4000-8000-0000000000a1'
const UB = 'f0000000-0000-4000-8000-0000000000b1'

let db: PGlite
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0]!
const as = (uid: string) => db.exec(`set request.jwt.claim.sub = '${uid}';`)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${UA}', 'a@r.test'), ('${UB}', 'b@r.test');
    insert into companies (id, name, owner_user_id) values ('${A}', 'Asha Studio', '${UA}'), ('${B}', 'Bina Films', '${UB}'), ('${C}', 'Chitra Clicks', null);
    insert into users (user_id, company_id, role, name, email) values
      ('${UA}', '${A}', 'super_admin', 'Asha', 'a@r.test'), ('${UB}', '${B}', 'super_admin', 'Bina', 'b@r.test');
  `)
})

describe('refer a studio (0237)', () => {
  it('gives a studio one code that never changes', async () => {
    await as(UA)
    const first = await one<{ c: string }>(`select my_studio_ref_code() as c`)
    const again = await one<{ c: string }>(`select my_studio_ref_code() as c`)
    expect(first.c).toMatch(/^[A-Z0-9]{8}$/)
    expect(again.c).toBe(first.c)
  })

  it('links a new studio to the code it came with, once, and never to itself', async () => {
    const code = (await one<{ c: string }>(`select studio_ref_code as c from companies where id = '${A}'`)).c
    expect((await one<{ ok: boolean }>(`select claim_studio_referral('${B}', '${code.toLowerCase()}') as ok`)).ok).toBe(true)
    expect((await one<{ ok: boolean }>(`select claim_studio_referral('${B}', '${code}') as ok`)).ok).toBe(false)
    expect((await one<{ ok: boolean }>(`select claim_studio_referral('${A}', '${code}') as ok`)).ok).toBe(false)
    expect((await one<{ ok: boolean }>(`select claim_studio_referral('${C}', 'NOPE0000') as ok`)).ok).toBe(false)
    expect((await one<{ ok: boolean }>(`select claim_studio_referral('${C}', 'x; drop') as ok`)).ok).toBe(false)
  })

  it('shows the referrer only the studio name and dates; paid once its first order is paid', async () => {
    await as(UA)
    let rows = (await db.query<{ studio_name: string; paid_at: string | null }>(`select * from my_studio_referrals()`)).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]!.studio_name).toBe('Bina Films')
    expect(rows[0]!.paid_at).toBeNull()
    const plan = await one<{ id: string }>(`select id from plans limit 1`)
    await db.exec(`insert into payment_orders (company_id, plan_id, amount, status) values ('${B}', '${plan.id}', 1999, 'paid')`)
    rows = (await db.query<{ studio_name: string; paid_at: string | null }>(`select * from my_studio_referrals()`)).rows
    expect(rows[0]!.paid_at).not.toBeNull()
    await as(UB)
    expect((await db.query(`select * from my_studio_referrals()`)).rows).toHaveLength(0)
  })

  it('keeps the table closed to studios', async () => {
    await db.exec(`set role authenticated`)
    await expect(db.exec(`select * from studio_referrals`)).rejects.toThrow()
    await expect(db.exec(`select claim_studio_referral('${C}', 'ABCDEFGH')`)).rejects.toThrow()
    await db.exec(`reset role`)
  })
})
