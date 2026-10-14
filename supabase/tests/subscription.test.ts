import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The two queries behind the Subscription screen, run against every migration.
 *
 * Both of them selected columns that exist on no table — plans.description,
 * plans.currency, plans.duration_days, companies.plan_key, companies.plan_name,
 * companies.plan_gate, users.plan_gate, users.plan_expiry and
 * payment_orders.expires_at — so every request 400'd and the page read "This
 * didn't load" for as long as it has shipped. The column names sit inside
 * template literals, so nothing static could see it.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const PLAN = '33333333-3333-3333-3333-333333333333'
const ORDER = '44444444-4444-4444-4444-444444444444'

/** The /subscription/plans query, verbatim. */
const PLANS_SQL = `
  select id, key, name, price, billing_interval,
         description, currency, duration_days, features, is_active,
         badge, billing_label, savings_label, monthly_equivalent, sort_order
  from plans where is_active = true order by sort_order, price`

/** The /subscription/status company query, verbatim apart from the bound id. */
const STATUS_SQL = `
  select c.plan as plan_key,
         p.name as plan_name,
         c.plan_expiry::text as plan_expiry,
         case
           when coalesce(c.plan_expiry,         'epoch'::timestamptz) > now() then 'active'
           when coalesce(c.grandfathered_until, 'epoch'::timestamptz) > now() then 'grandfathered'
           when coalesce(c.grace_until,         'epoch'::timestamptz) > now() then 'grace'
           else 'expired'
         end as plan_gate
    from companies c
    left join plans p on p.key = c.plan
   where c.id = '${COMPANY}'`

/** The /subscription/status history query, verbatim apart from the bound id. */
const HISTORY_SQL = `
  select o.id, o.status, o.amount, pl.name as plan_name,
         o.created_at::text as created_at,
         cs.expires_at::text as expires_at
    from payment_orders o
    left join plans pl on pl.id = o.plan_id
    left join lateral (
      select s.expires_at from company_subscriptions s
       where s.company_id = o.company_id
         and (s.order_id = o.id
              or (s.order_id is null and s.plan_id = o.plan_id and s.started_at >= o.created_at))
       order by s.order_id nulls last, s.started_at
       limit 1
    ) cs on true
   where o.company_id = '${COMPANY}'
   order by o.created_at desc
   limit 10`

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

  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
    .sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
  await db.exec(`
    insert into plans (id, key, name, price, billing_interval, description, duration_days)
    values ('${PLAN}', 'studio', 'Studio', 2999, 'monthly', 'Everything a working studio needs.', null);
    insert into companies (id, name, owner_user_id, plan, grandfathered_until)
    values ('${COMPANY}', 'Studio', '${OWNER}', 'studio', now() + interval '30 days');
    insert into users (user_id, company_id, role, name, email)
    values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'owner@studio.test');
    insert into payment_orders (id, company_id, plan_id, amount, status, created_at)
    values ('${ORDER}', '${COMPANY}', '${PLAN}', 3539, 'paid', now() - interval '1 day');
    insert into company_subscriptions (company_id, plan_id, expires_at, order_id)
    values ('${COMPANY}', '${PLAN}', now() + interval '29 days', '${ORDER}');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('subscription screen queries', () => {
  it('the plans query runs — every column it names exists', async () => {
    // This is the router's query verbatim. Its job is to fail the moment the
    // query names a column the table does not have, which is how the whole
    // subscription screen came to 400 on every call.
    const res = await db.query<{
      key: string
      currency: string
      description: string | null
      badge: string | null
      sort_order: number
    }>(PLANS_SQL)
    // 0141 publishes the three real plans; this file adds its own fixture.
    const own = res.rows.find((r) => r.key === 'studio')
    expect(own).toBeDefined()
    expect(own!.currency).toBe('INR')
    expect(own!.description).toBe('Everything a working studio needs.')
    // Sold in the order a studio should read them, cheapest commitment first.
    // The old member plans are off sale since 0262; Starter, Pro and Studio Max are on.
    expect(res.rows.some((r) => r.key.startsWith('ipc_'))).toBe(false)
    expect(res.rows.filter((r) => /^(starter|pro|max)_yearly$/.test(r.key)).map((r) => r.key)).toEqual([
      'starter_yearly',
      'pro_yearly',
      'max_yearly',
    ])
    expect(res.rows.find((r) => r.key === 'pro_yearly')!.badge).toBe('Most Popular')
  })

  it('the status query runs and names the plan the company is on', async () => {
    const res = await db.query<{ plan_key: string; plan_name: string; plan_gate: string }>(STATUS_SQL)
    expect(res.rows[0]!.plan_key).toBe('studio')
    expect(res.rows[0]!.plan_name).toBe('Studio')
  })

  it('derives the same gate the access payload does', async () => {
    // Grandfathered, not expired: plan_expiry is null but grandfathered_until
    // is in the future. Reading a stored companies.plan_gate — which does not
    // exist — is what used to break this.
    const res = await db.query<{ plan_gate: string }>(STATUS_SQL)
    expect(res.rows[0]!.plan_gate).toBe('grandfathered')

    await db.exec(`update companies set plan_expiry = now() + interval '5 days' where id = '${COMPANY}';`)
    const active = await db.query<{ plan_gate: string }>(STATUS_SQL)
    expect(active.rows[0]!.plan_gate).toBe('active')

    await db.exec(`update companies set plan_expiry = null, grandfathered_until = null,
                   grace_until = now() + interval '2 days' where id = '${COMPANY}';`)
    const grace = await db.query<{ plan_gate: string }>(STATUS_SQL)
    expect(grace.rows[0]!.plan_gate).toBe('grace')

    await db.exec(`update companies set grace_until = null where id = '${COMPANY}';`)
    const expired = await db.query<{ plan_gate: string }>(STATUS_SQL)
    expect(expired.rows[0]!.plan_gate).toBe('expired')
  })

  it('an order in the history says what it bought and until when', async () => {
    const res = await db.query<{ plan_name: string; status: string; expires_at: string | null }>(HISTORY_SQL)
    expect(res.rows.length).toBe(1)
    expect(res.rows[0]!.plan_name).toBe('Studio')
    expect(res.rows[0]!.status).toBe('paid')
    expect(res.rows[0]!.expires_at).not.toBeNull()
  })

  it('activation links the subscription back to the order that paid for it', async () => {
    const order = await db.query<{ id: string }>(
      `insert into payment_orders (company_id, plan_id, amount, status)
       values ('${COMPANY}', '${PLAN}', 3539, 'created') returning id;`,
    )
    const id = order.rows[0]!.id
    await db.query(`select * from activate_subscription(p_order_id => '${id}', p_payment_id => 'pay_x');`)
    const linked = await db.query<{ order_id: string }>(
      `select order_id from company_subscriptions where order_id = '${id}';`,
    )
    expect(linked.rows.length).toBe(1)
  })
})
