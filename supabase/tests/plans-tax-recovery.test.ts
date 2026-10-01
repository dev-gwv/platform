import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0226: give a studio a plan from the catalogue, a studio's own expense tax
 * rates, and the Razorpay orders that took money without giving a plan.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const ADMIN = 'b2260000-0000-4000-8000-000000000001'
const OWNER = 'b2260000-0000-4000-8000-000000000002'
const STAFF = 'b2260000-0000-4000-8000-000000000003'
const OTHER = 'b2260000-0000-4000-8000-000000000004'
const STUDIO = 'b2260000-0000-4000-8000-0000000000aa'
const ELSEWHERE = 'b2260000-0000-4000-8000-0000000000bb'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = async <T>(user: string, sql: string) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await q<T>(sql)
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
  }
}
const fails = (user: string, sql: string) =>
  as(user, sql).then(
    () => null,
    (e: Error) => e.message,
  )

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
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@p.test'), ('${OWNER}', 'o@s.test'), ('${STAFF}', 's@s.test'), ('${OTHER}', 'x@e.test');
    insert into companies (id, name, owner_user_id, plan_expiry) values
      ('${STUDIO}', 'Asha Studio', '${OWNER}', now() + interval '10 days'),
      ('${ELSEWHERE}', 'Other Studio', '${OTHER}', null);
    insert into users (user_id, company_id, role, name, email, status) values
      ('${ADMIN}', '${ELSEWHERE}', 'super_admin', 'Platform', 'admin@p.test', 'active'),
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Asha', 'o@s.test', 'active'),
      ('${STAFF}', '${STUDIO}', 'employee', 'Ravi', 's@s.test', 'active'),
      ('${OTHER}', '${ELSEWHERE}', 'super_admin', 'Other', 'x@e.test', 'active');
    insert into platform_admins (user_id) values ('${ADMIN}');
    insert into plans (key, name, price, billing_interval, duration_days, audience)
      values ('t-annual', 'Test annual', 18000, 'yearly', 365, 'diamond')
      on conflict (key) do nothing;
    grant usage on schema auth to authenticated;
  `)
})

describe('assigning a plan from the catalogue', () => {
  it('is the platform admin’s alone', async () => {
    expect(await fails(OWNER, `select platform_assign_plan('${STUDIO}', 't-annual')`)).toMatch(/platform access only/)
    expect(await fails(OWNER, `select * from platform_plans()`)).toMatch(/platform access only/)
  })

  it('sets the plan and adds its length to the later of today and the current end', async () => {
    const [{ until }] = await as<{ until: string }>(ADMIN, `select platform_assign_plan('${STUDIO}', 't-annual')::text as until`)
    const [c] = await q<{ plan: string; days: number }>(
      `select plan, round(extract(epoch from plan_expiry - now()) / 86400)::int as days from companies where id = '${STUDIO}'`,
    )
    expect(c).toEqual({ plan: 't-annual', days: 375 })
    expect(until).toBeTruthy()
    expect(await q(`select kind from billing_events where company_id = '${STUDIO}' and kind = 'platform_plan_assigned'`)).toHaveLength(1)
    expect(await q(`select 1 from company_subscriptions where company_id = '${STUDIO}'`)).toHaveLength(1)
  })

  it('refuses a plan that is not in the catalogue', async () => {
    expect(await fails(ADMIN, `select platform_assign_plan('${STUDIO}', 'nope')`)).toMatch(/unknown plan/)
    const plans = await as<{ key: string }>(ADMIN, `select key from platform_plans()`)
    expect(plans.map((p) => p.key)).toContain('t-annual')
  })
})

describe('a studio’s own tax rates', () => {
  it('are added by the owner, seen by the team, written by nobody else', async () => {
    await as(OWNER, `insert into expense_tax_rates (name, rate) values ('GST 3%', 3)`)
    expect(await as(STAFF, `select name, rate::float as rate from expense_tax_rates`)).toEqual([{ name: 'GST 3%', rate: 3 }])
    expect(await fails(STAFF, `insert into expense_tax_rates (name, rate) values ('Cess', 1)`)).toMatch(/row-level security/)
    expect(await as(OTHER, `select 1 from expense_tax_rates`)).toEqual([])
    expect(await fails(OWNER, `insert into expense_tax_rates (name, rate) values ('gst 3%', 5)`)).toMatch(/duplicate key/)
    expect(await fails(OWNER, `insert into expense_tax_rates (name, rate) values ('Too much', 101)`)).toMatch(/check constraint/)
  })
})

describe('payments to check', () => {
  it('lists an unfinished order Razorpay captured, and ignores a failed payment', async () => {
    await db.exec(`
      insert into payment_orders (id, company_id, plan_id, amount, razorpay_order_id, status, created_at)
        select 'b2260000-0000-4000-8000-0000000000f1', '${STUDIO}', id, 21240, 'order_paid_1', 'created', now() - interval '1 hour' from plans where key = 't-annual';
      insert into payment_orders (id, company_id, plan_id, amount, razorpay_order_id, status, created_at)
        select 'b2260000-0000-4000-8000-0000000000f2', '${STUDIO}', id, 21240, 'order_failed_1', 'created', now() - interval '1 hour' from plans where key = 't-annual';
      insert into payment_orders (id, company_id, plan_id, amount, razorpay_order_id, status, created_at)
        select 'b2260000-0000-4000-8000-0000000000f3', '${STUDIO}', id, 21240, 'order_new_1', 'created', now() from plans where key = 't-annual';
      insert into razorpay_webhook_events (event_id, payload) values
        ('evt_cap', '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_ok","order_id":"order_paid_1","amount":2124000}}}}'),
        ('evt_fail', '{"event":"payment.failed","payload":{"payment":{"entity":{"id":"pay_bad","order_id":"order_failed_1","amount":2124000}}}}'),
        ('evt_lost', '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_lost","order_id":"order_elsewhere","amount":99900,"email":"a@b.test"}}}}');
    `)
    const [{ r }] = await as<{ r: { stuck: Array<{ razorpay_order_id: string; captured_payment_id: string | null }>; unmatched: Array<{ payment_id: string; amount: number }> } }>(
      ADMIN,
      `select platform_payment_recovery() as r`,
    )
    const byOrder = Object.fromEntries(r.stuck.map((s) => [s.razorpay_order_id, s.captured_payment_id]))
    expect(byOrder).toEqual({ order_paid_1: 'pay_ok', order_failed_1: null })
    expect(r.unmatched.map((u) => [u.payment_id, Number(u.amount)])).toEqual([['pay_lost', 999]])
    expect(await fails(OWNER, `select platform_payment_recovery()`)).toMatch(/platform access only/)
  })
})
