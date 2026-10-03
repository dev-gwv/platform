import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * A client's birthdays and anniversary (0243): the wedding day fills the
 * anniversary by itself and moves it when the wedding moves, never a date
 * somebody typed; one studio never sees another's dates; the next day comes
 * round each year, 29 Feb kept on 28 Feb.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const A_OWNER = 'f5000000-0000-4000-8000-000000000001'
const A = 'f5000000-0000-4000-8000-0000000000aa'
const B_OWNER = 'f5000000-0000-4000-8000-000000000002'
const B = 'f5000000-0000-4000-8000-0000000000bb'
const PRIYA = 'f5000000-0000-4000-8000-0000000000c1'
const MEERA = 'f5000000-0000-4000-8000-0000000000c2'
const WEDDING = 'f5000000-0000-4000-8000-0000000000d1'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const asUser = async <T>(uid: string, fn: () => Promise<T>) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
const anniversary = () =>
  q<{ month: number; day: number; year: number | null; source: string }>(
    `select month, day, year, source from client_occasions where client_id = $1 and kind = 'anniversary'`,
    [PRIYA],
  )

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
  // Production grants table access by default privileges; RLS is what keeps studios apart.
  await db.exec(`grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant execute on all functions in schema public, auth to authenticated;`)
  await db.exec(`
    insert into auth.users (id, email) values ('${A_OWNER}', 'a@s.test'), ('${B_OWNER}', 'b@s.test');
    insert into companies (id, name, owner_user_id) values ('${A}', 'Asha Studio', '${A_OWNER}'), ('${B}', 'Other Studio', '${B_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${A_OWNER}', '${A}', 'super_admin', 'Asha', 'a@s.test'), ('${B_OWNER}', '${B}', 'super_admin', 'Bina', 'b@s.test');
    insert into clients (id, company_id, name) values ('${PRIYA}', '${A}', 'Priya Sharma'), ('${MEERA}', '${A}', 'Meera Rao');
    insert into projects (id, company_id, client_id, name) values ('${WEDDING}', '${A}', '${PRIYA}', 'Priya & Rahul Wedding');
  `)
})

describe('client birthdays and anniversaries (0243)', () => {
  it('fills the anniversary from the wedding day, not from the pre-wedding', async () => {
    await q(`insert into shoots (company_id, project_id, name, shoot_date) values ($1, $2, 'Pre-wedding', '2026-11-20')`, [A, WEDDING])
    expect(await anniversary()).toEqual([])
    await q(`insert into shoots (company_id, project_id, name, shoot_date) values ($1, $2, 'Wedding Day', '2026-12-12')`, [A, WEDDING])
    expect(await anniversary()).toEqual([{ month: 12, day: 12, year: 2026, source: 'wedding_day' }])
  })

  it('moves it with the wedding, and never touches one somebody typed', async () => {
    await q(`update shoots set shoot_date = '2026-12-14' where project_id = $1 and name = 'Wedding Day'`, [WEDDING])
    expect((await anniversary())[0]).toMatchObject({ month: 12, day: 14 })
    await q(`update client_occasions set source = 'studio', day = 13 where client_id = $1 and kind = 'anniversary'`, [PRIYA])
    await q(`update shoots set shoot_date = '2026-12-20' where project_id = $1 and name = 'Wedding Day'`, [WEDDING])
    expect((await anniversary())[0]).toMatchObject({ month: 12, day: 13, source: 'studio' })
  })

  it('keeps several birthdays per client, one per person, and refuses a day that does not exist', async () => {
    await asUser(A_OWNER, async () => {
      await q(
        `insert into client_occasions (company_id, client_id, kind, person_name, month, day) values ($1, $2, 'birthday', 'Priya', 3, 14), ($1, $2, 'birthday', 'Rahul', 8, 2)`,
        [A, PRIYA],
      )
      await expect(
        q(`insert into client_occasions (company_id, client_id, kind, person_name, month, day) values ($1, $2, 'birthday', 'Priya', 4, 1)`, [A, PRIYA]),
      ).rejects.toThrow()
      await expect(
        q(`insert into client_occasions (company_id, client_id, kind, person_name, month, day) values ($1, $2, 'birthday', 'Meera', 2, 31)`, [A, MEERA]),
      ).rejects.toThrow()
    })
    const [n] = await q<{ n: number }>(`select count(*)::int as n from client_occasions where client_id = $1 and kind = 'birthday'`, [PRIYA])
    expect(n!.n).toBe(2)
  })

  it('never shows one studio the dates of another, nor lets it write to another studio\'s client', async () => {
    const seen = await asUser(B_OWNER, () => q(`select id from client_occasions`))
    expect(seen).toEqual([])
    await asUser(B_OWNER, () =>
      expect(
        q(`insert into client_occasions (company_id, client_id, kind, person_name, month, day) values ($1, $2, 'birthday', 'X', 1, 1)`, [B, PRIYA]),
      ).rejects.toThrow(),
    )
  })

  it('finds the next time a day comes round, 29 Feb kept on 28 Feb', async () => {
    const rows = await q<{ a: string; b: string; c: string; d: string }>(`
      select occasion_next(3, 14, '2026-10-03')::text as a, occasion_next(10, 3, '2026-10-03')::text as b,
             occasion_next(1, 5, '2026-10-03')::text as c, occasion_next(2, 29, '2026-10-03')::text as d`)
    expect(rows[0]).toEqual({ a: '2027-03-14', b: '2026-10-03', c: '2027-01-05', d: '2027-02-28' })
  })
})
