import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0210: every studio that is not paying gets 30 days; the owner's own studio
 * and paying studios are left alone; the 2-year plan is Rs 33,000 + GST.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const ADMIN = 'b1000000-0000-4000-8000-000000000001'
const FREE_OWNER = 'b1000000-0000-4000-8000-000000000002'
const PAID_OWNER = 'b1000000-0000-4000-8000-000000000003'
const MINE = 'b1000000-0000-4000-8000-0000000000a1'
const FREE = 'b1000000-0000-4000-8000-0000000000a2'
const PAID = 'b1000000-0000-4000-8000-0000000000a3'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const days = async (id: string) =>
  (await q<{ d: number }>(`select round(extract(epoch from grandfathered_until - now()) / 86400)::int as d from companies where id = '${id}'`))[0]!.d

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  const cut = files.findIndex((f) => f.startsWith('0210_'))
  expect(cut).toBeGreaterThan(0)
  for (const f of files.slice(0, cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  // Three studios on the old 10-year open access: the owner's own, a free
  // one, and one that pays.
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'a@s.test'), ('${FREE_OWNER}', 'f@s.test'), ('${PAID_OWNER}', 'p@s.test');
    insert into platform_admins (user_id) values ('${ADMIN}');
    insert into companies (id, name, owner_user_id) values ('${MINE}', 'Mine', '${ADMIN}'), ('${FREE}', 'Free', '${FREE_OWNER}'), ('${PAID}', 'Paid', '${PAID_OWNER}');
    update companies set plan_expiry = now() + interval '200 days' where id = '${PAID}';
  `)
  expect(await days(FREE)).toBeGreaterThan(3000)

  for (const f of files.slice(cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))
})

describe('the 30-day trial', () => {
  it('starts today for a free studio already on the app', async () => {
    expect(await days(FREE)).toBe(30)
  })

  it('leaves the owner’s own studio and a paying studio alone', async () => {
    expect(await days(MINE)).toBeGreaterThan(3000)
    expect(await days(PAID)).toBeGreaterThan(3000)
  })

  it('is no longer what a new studio gets: 0214 made that 7 days, 30 for IPC Diamond members', async () => {
    const [{ id }] = await q<{ id: string }>(`insert into companies (name, owner_user_id) values ('New', '${FREE_OWNER}') returning id`)
    expect(await days(id!)).toBe(7)
  })

  it('ends access on the trial date when no plan is paid', async () => {
    const [r] = await q<{ ok: boolean }>(
      `select company_access_until(plan_expiry, grandfathered_until, grace_until) = grandfathered_until as ok from companies where id = '${FREE}'`,
    )
    expect(r!.ok).toBe(true)
    const [p] = await q<{ ok: boolean }>(
      `select company_access_until(plan_expiry, grandfathered_until, grace_until) = plan_expiry as ok from companies where id = '${PAID}'`,
    )
    expect(p!.ok).toBe(true)
  })
})

describe('the 2-year plan', () => {
  it('is Rs 33,000 before GST', async () => {
    const [p] = await q<{ price: string; monthly_equivalent: string }>(`select price::text, monthly_equivalent::text from plans where key = 'ipc_2year'`)
    expect(Number(p!.price)).toBe(33000)
    expect(Number(p!.monthly_equivalent)).toBe(1375)
  })
})
