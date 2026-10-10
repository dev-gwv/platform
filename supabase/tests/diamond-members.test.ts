import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0214: IPC Diamond members get 30 days and the member prices; everyone else
 * gets 7 days and one plan at Rs 1,00,000 + GST a year. A studio proves it is a
 * member with a screenshot; the API decides (diamond_decide) or the platform
 * owner does, and can revoke.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const ADMIN = 'd1000000-0000-4000-8000-000000000001'
const OWNER = 'd1000000-0000-4000-8000-000000000002'
const OLD_OWNER = 'd1000000-0000-4000-8000-000000000003'
const STUDIO = 'd1000000-0000-4000-8000-0000000000a1'
const OLD = 'd1000000-0000-4000-8000-0000000000a2'
const IMG = 'd1000000-0000-4000-8000-0000000000f1'
const PDF = 'd1000000-0000-4000-8000-0000000000f2'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!
const as = (uid: string | null) => db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`)
const trialDays = async (id: string) =>
  (await one<{ d: number }>(`select round(extract(epoch from grandfathered_until - created_at) / 86400)::int as d from companies where id = '${id}'`)).d
const tier = async (id: string) => (await one<{ t: string }>(`select member_tier as t from companies where id = '${id}'`)).t

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  const cut = files.findIndex((f) => f.startsWith('0214_'))
  expect(cut).toBeGreaterThan(0)
  for (const f of files.slice(0, cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  // A studio already on its 30-day trial before 0214 lands.
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'a@s.test'), ('${OWNER}', 'o@s.test'), ('${OLD_OWNER}', 'x@s.test');
    insert into platform_admins (user_id) values ('${ADMIN}');
    insert into companies (id, name, owner_user_id) values ('${OLD}', 'Old', '${OLD_OWNER}');
  `)
  for (const f of files.slice(cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${STUDIO}', 'New', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values ('${OWNER}', '${STUDIO}', 'super_admin', 'Owner', 'o@s.test');
    insert into files (id, company_id, name, mime, size_bytes, bytes) values
      ('${IMG}', '${STUDIO}', 'group.png', 'image/png', 3, '\\x010203'),
      ('${PDF}', '${STUDIO}', 'doc.pdf', 'application/pdf', 3, '\\x010203');
  `)
})

describe('a new studio', () => {
  it('is an outsider on a 7-day trial', async () => {
    expect(await tier(STUDIO)).toBe('outsider')
    expect(await trialDays(STUDIO)).toBe(7)
  })

  it('leaves a studio already inside with the 30 days it had', async () => {
    expect(await trialDays(OLD)).toBe(30)
  })

  it('sees Starter, Pro and Studio Max (0256), and cannot order a member plan', async () => {
    const outsider = await q<{ key: string }>(`select key from plans where audience = 'outsider' and is_active order by sort_order`)
    expect(outsider.map((p) => p.key)).toEqual(['starter_yearly', 'starter_monthly', 'pro_yearly', 'pro_monthly', 'max_yearly', 'max_monthly'])
    await as(OWNER)
    const member = await one<{ id: string }>(`select id from plans where key = 'ipc_yearly'`)
    await expect(db.query(`select * from create_payment_order('${member.id}')`)).rejects.toThrow(/unknown plan/)
    const own = await one<{ id: string }>(`select id from plans where key = 'starter_yearly'`)
    const order = await one<{ amount: string }>(`select amount::text from create_payment_order('${own.id}')`)
    expect(Number(order.amount)).toBe(21225.84)
  })
})

describe('claiming Diamond', () => {
  it('takes an image the studio uploaded, not a PDF', async () => {
    await as(OWNER)
    await expect(db.query(`select diamond_submit_claim('${PDF}')`)).rejects.toThrow(/screenshot/)
  })

  it('keeps one pending claim at a time: a second try replaces the first', async () => {
    await as(OWNER)
    await db.query(`select diamond_submit_claim('${IMG}')`)
    await db.query(`select diamond_submit_claim('${IMG}')`)
    const pending = await q(`select 1 from diamond_claims where company_id = '${STUDIO}' and status = 'pending'`)
    expect(pending).toHaveLength(1)
  })

  it('once approved, makes the studio a member with 30 days from sign-up and member plans', async () => {
    const claim = await one<{ id: string }>(`select id from diamond_claims where company_id = '${STUDIO}' and status = 'pending'`)
    await as(null)
    await db.query(`select diamond_decide('${claim.id}', true, 'auto', null, '{"group_title":"IPC Diamonds - Premium"}'::jsonb)`)
    expect(await tier(STUDIO)).toBe('diamond')
    expect(await trialDays(STUDIO)).toBe(30)
    await as(OWNER)
    const member = await one<{ id: string }>(`select id from plans where key = 'ipc_monthly'`)
    const order = await one<{ amount: string }>(`select amount::text from create_payment_order('${member.id}')`)
    expect(Number(order.amount)).toBeCloseTo(1999 * 1.18, 2)
    await expect(db.query(`select diamond_submit_claim('${IMG}')`)).rejects.toThrow(/already verified/)
  })

  it('shows up in the platform inbox, and only for a platform admin', async () => {
    await as(OWNER)
    await expect(db.query(`select * from platform_list_diamond_claims(null)`)).rejects.toThrow(/platform access only/)
    await as(ADMIN)
    const rows = await q<{ status: string; decided_by: string }>(`select status, decided_by from platform_list_diamond_claims(null)`)
    expect(rows).toEqual([{ status: 'approved', decided_by: 'auto' }])
    const file = await q(`select * from platform_diamond_claim_file((select id from diamond_claims where status = 'approved'))`)
    expect(file).toHaveLength(1)
  })

  it('can be revoked by the platform owner: back to 7 days and the outsider price', async () => {
    await as(ADMIN)
    await db.query(`select platform_diamond_revoke('${STUDIO}', 'not in the group')`)
    expect(await tier(STUDIO)).toBe('outsider')
    expect(await trialDays(STUDIO)).toBe(7)
    const c = await one<{ status: string }>(`select status from diamond_claims where company_id = '${STUDIO}' order by created_at desc limit 1`)
    expect(c.status).toBe('revoked')
  })

  it('a rejected claim leaves the studio as it was', async () => {
    await as(OWNER)
    const [{ id }] = await q<{ id: string }>(`select diamond_submit_claim('${IMG}') as id`)
    await as(ADMIN)
    await db.query(`select platform_diamond_decide('${id}', false, 'wrong group')`)
    expect(await tier(STUDIO)).toBe('outsider')
    expect(await trialDays(STUDIO)).toBe(7)
  })
})
