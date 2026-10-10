import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The three plans the studio actually sells.
 *
 * `plans` was empty, so /settings/subscription honestly reported "No plans are
 * on offer yet" and no studio could renew. The prices come from the old app's
 * own seed. What these check is the part that is easy to get wrong: a 2-year
 * plan could not previously be stored at all (the interval check allowed only
 * monthly and yearly), and a plan whose duration is expressed in days has to
 * beat the interval when activation works out the new expiry -- otherwise a
 * ₹30,000 two-year purchase silently buys one year.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'

let db: PGlite

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
  // Production grants these in deploy/db/00_bootstrap.sql, before any
  // migration runs. Without them a perfectly good policy fails with
  // "permission denied for table", which reads as a policy rejection and is
  // not one -- the harness lying rather than the schema.
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(
    `alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`,
  )
  await db.exec(
    `alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`,
  )
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)

  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
    .sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'owner@s.test');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

/** Read as a signed-in studio user, with RLS applied rather than bypassed. */
async function asUser<T>(uid: string, sql: string) {
  await db.exec(`set role authenticated;`)
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
  try {
    return await db.query<T>(sql)
  } finally {
    await db.exec(`reset role;`)
  }
}

const plan = async (key: string) => {
  const r = await db.query<Record<string, unknown>>(`select * from plans where key = $1;`, [key])
  return r.rows[0]
}

describe('plan pricing', () => {
  it('offers members exactly the three plans, in the order they should be read', async () => {
    const r = await db.query<{ key: string }>(
      `select key from plans where is_active and audience = 'diamond' order by sort_order, price;`,
    )
    expect(r.rows.map((x) => x.key)).toEqual(['ipc_monthly', 'ipc_yearly', 'ipc_2year'])
  })

  it('offers outsiders Starter, Pro and Studio Max; the ₹1,00,000 plan is off sale (0256)', async () => {
    const r = await db.query<{ key: string; price: string }>(
      `select key, price from plans where is_active and audience = 'outsider' order by sort_order;`,
    )
    expect(r.rows.map((x) => [x.key, Number(x.price)])).toEqual([
      ['starter_yearly', 17988],
      ['starter_monthly', 1999],
      ['pro_yearly', 29988],
      ['pro_monthly', 2999],
      ['max_yearly', 47988],
      ['max_monthly', 4999],
    ])
    expect((await plan('studio_yearly'))!['is_active']).toBe(false)
  })

  it('carries the old app’s prices', async () => {
    expect(Number((await plan('ipc_monthly'))!['price'])).toBe(1999)
    expect(Number((await plan('ipc_yearly'))!['price'])).toBe(18000)
    // 0210: the owner set the 2-year plan at Rs 33,000 + GST.
    expect(Number((await plan('ipc_2year'))!['price'])).toBe(33000)
  })

  it('states a saving that matches the arithmetic', async () => {
    // A savings line nobody checked against the prices is how a card ends up
    // promising a discount the invoice does not give.
    const monthly = Number((await plan('ipc_monthly'))!['price'])
    const yearly = await plan('ipc_yearly')
    const twoYear = await plan('ipc_2year')
    expect(monthly * 12 - Number(yearly!['price'])).toBe(5988)
    expect(String(yearly!['savings_label'])).toContain('5,988')
    expect(monthly * 24 - Number(twoYear!['price'])).toBe(14976)
    expect(String(twoYear!['savings_label'])).toContain('14,976')
  })

  it('quotes a per-month figure that matches the price and the term', async () => {
    const yearly = await plan('ipc_yearly')
    expect(Number(yearly!['monthly_equivalent'])).toBe(Number(yearly!['price']) / 12)
    const twoYear = await plan('ipc_2year')
    expect(Number(twoYear!['monthly_equivalent'])).toBe(Number(twoYear!['price']) / 24)
  })

  it('can store a two-year interval at all', async () => {
    expect((await plan('ipc_2year'))!['billing_interval']).toBe('biennial')
  })

  it('extends a fresh account by the plan’s own duration, not its interval', async () => {
    // The trap: 'biennial' is not 'yearly', so an interval-driven expiry would
    // fall through to one month and sell two years for a thirty-day extension.
    const p = await plan('ipc_2year')
    const order = await db.query<{ id: string }>(
      `insert into payment_orders (company_id, plan_id, amount, status, created_by)
       values ($1, $2, 30000, 'created', $3) returning id;`,
      [COMPANY, p!['id'], OWNER],
    )
    const r = await db.query<{ duplicate: boolean; expires_at: string }>(
      `select * from activate_subscription($1::uuid, 'pay_test');`,
      [order.rows[0]!.id],
    )
    const days = Math.round((new Date(r.rows[0]!.expires_at).getTime() - Date.now()) / 86_400_000)
    expect(days).toBe(730)
  })

  it('a signed-in studio can actually read them', async () => {
    // Seeding as the migration owner proves nothing: `plans` has RLS, and a
    // policy that filters every row away looks exactly like an empty table --
    // which is the state this whole change set out to fix.
    const r = await asUser<{ key: string }>(OWNER, `select key from plans where is_active;`)
    expect(r.rows.map((x) => x.key).sort()).toEqual([
      'ipc_2year', 'ipc_monthly', 'ipc_yearly',
      'max_monthly', 'max_yearly', 'pro_monthly', 'pro_yearly', 'starter_monthly', 'starter_yearly',
    ])
  })

  it('hides a plan the platform has withdrawn', async () => {
    await db.exec(`update plans set is_active = false where key = 'ipc_2year';`)
    const r = await asUser<{ key: string }>(OWNER, `select key from plans;`)
    expect(r.rows.map((x) => x.key)).not.toContain('ipc_2year')
    await db.exec(`update plans set is_active = true where key = 'ipc_2year';`)
  })

  it('Platform → Plans is the platform admin\'s alone, and counts the studios on each plan (0256)', async () => {
    await expect(asUser(OWNER, `select platform_set_plan_on_sale('pro_yearly', false);`)).rejects.toThrow(/platform access only/)
    await expect(asUser(OWNER, `select * from platform_plans();`)).rejects.toThrow(/platform access only/)

    await db.exec(`insert into platform_admins (user_id) values ('${OWNER}') on conflict do nothing;`)
    await db.exec(`update companies set plan = 'starter_yearly', plan_expiry = now() + interval '200 days' where id = '${COMPANY}';`)
    try {
      const rows = await asUser<{ key: string; studios: number; tier: string | null; limits: Record<string, number> }>(
        OWNER,
        `select key, studios, tier, limits from platform_plans();`,
      )
      const starter = rows.rows.find((r) => r.key === 'starter_yearly')!
      expect(starter.studios).toBe(1)
      expect(starter.tier).toBe('starter')
      expect(starter.limits).toMatchObject({ projects: 30 })
      const counts = await asUser<{ paying: number }>(OWNER, `select * from platform_plan_counts();`)
      expect(counts.rows[0]!.paying).toBe(1)

      await asUser(OWNER, `select platform_set_plan_on_sale('pro_yearly', false);`)
      expect((await plan('pro_yearly'))!['is_active']).toBe(false)
      await asUser(OWNER, `select platform_set_plan_on_sale('pro_yearly', true);`)
      expect((await plan('pro_yearly'))!['is_active']).toBe(true)
      await expect(asUser(OWNER, `select platform_set_plan_on_sale('no_such_plan', true);`)).rejects.toThrow(/unknown plan/)
    } finally {
      await db.exec(`delete from platform_admins where user_id = '${OWNER}';`)
      await db.exec(`update companies set plan = null, plan_expiry = null where id = '${COMPANY}';`)
    }
  })

  it('re-running the seed updates rather than duplicating', async () => {
    // The whole suite applies every migration twice in the idempotency check.
    await db.exec(readFileSync(join(migDir, '0141_plan_pricing.sql'), 'utf8'))
    // The tiered plans 0241 adds (Starter / Pro / Studio Max) are not this seed's.
    const r = await db.query<{ n: string }>(`select count(*) as n from plans where tier is null;`)
    expect(Number(r.rows[0]!.n)).toBe(4) // three member plans + the outsider's Yearly (0214)
  })
})
