import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0315: what a project still owes is one rule (project_outstanding, the same
 * as projectOutstanding in packages/domain), no live function reads the UTC
 * day, and a plan given "after the current plan" waits for it. The migration
 * is applied twice: it must be safe to run again.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const ADMIN = 'e9150000-0000-4000-8000-000000000001'
const OWNER = 'e9150000-0000-4000-8000-000000000002'
const COMPANY = 'e9150000-0000-4000-8000-0000000000aa'
const ELSEWHERE = 'e9150000-0000-4000-8000-0000000000bb'
const PROJECT = 'e9150000-0000-4000-8000-0000000000c1'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const one = async <T>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0]!
const asAdmin = async <T>(sql: string) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ADMIN}';`)
  try {
    return await q<T>(sql)
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
  }
}

/**
 * Live functions that read current_date on purpose. Each needs a reason; a
 * new one is India's today (india_today()) unless it truly means UTC.
 */
const UTC_ON_PURPOSE: Record<string, string> = {}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  // Safe to run twice.
  await db.exec(readFileSync(join(migDir, '0315_audit_third.sql'), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@p.test'), ('${OWNER}', 'asha@s.test');
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Asha Studio', '${OWNER}'), ('${ELSEWHERE}', 'Platform', '${ADMIN}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'asha@s.test', 'active'),
      ('${ADMIN}', '${ELSEWHERE}', 'super_admin', 'Platform', 'admin@p.test', 'active');
    insert into platform_admins (user_id) values ('${ADMIN}');
    insert into plans (key, name, price, billing_interval, duration_days, audience, tier, limits) values
      ('t-max', 'Test Max', 95988, 'yearly', 365, 'outsider', 'max', '{}'::jsonb),
      ('t-starter', 'Test Starter', 35988, 'yearly', 365, 'outsider', 'starter', '{"projects":30}'::jsonb)
      on conflict (key) do nothing;
    grant usage on schema auth to authenticated;
    insert into clients (id, company_id, name) values ('e9150000-0000-4000-8000-0000000000d1', '${COMPANY}', 'Priya');
    insert into projects (id, company_id, client_id, name, package_cost) values ('${PROJECT}', '${COMPANY}', 'e9150000-0000-4000-8000-0000000000d1', 'Mehta Wedding', 100000);
  `)
})

describe('0315: what a project still owes', () => {
  const owes = async () => Number((await one<{ n: string }>(`select project_outstanding($1)::text as n`, [PROJECT])).n)
  const invoice = (total: number, tax: number, balance: number) =>
    q(`insert into invoices (company_id, project_id, invoice_number, total, tax, subtotal, taxable, balance_due, status)
       values ($1, $2, 'T-' || gen_random_uuid()::text, $3::numeric, $4::numeric, $3::numeric - $4::numeric, $3::numeric - $4::numeric, $5::numeric, 'sent') returning id`, [COMPANY, PROJECT, total, tax, balance])

  it('is value less money in when nothing is invoiced', async () => {
    expect(await owes()).toBe(100000)
    await q(`insert into received_payments (company_id, project_id, amount, paid_on, status) values ($1, $2, 30000, india_today(), 'paid')`, [COMPANY, PROJECT])
    await q(`insert into received_payments (company_id, project_id, amount, paid_on, status) values ($1, $2, 5000, india_today(), 'pending')`, [COMPANY, PROJECT])
    // A promise is not money.
    expect(await owes()).toBe(70000)
    await q(`delete from received_payments where project_id = $1`, [PROJECT])
  })

  it('does not count GST paid on an invoice against the value', async () => {
    // ₹50,000 + 18% invoiced and paid: ₹50,000 of the value is still to bill.
    await invoice(59000, 9000, 0)
    await q(`insert into received_payments (company_id, project_id, amount, paid_on, status) values ($1, $2, 59000, india_today(), 'paid')`, [COMPANY, PROJECT])
    expect(await owes()).toBe(50000)
  })

  it('counts an open invoice with its GST', async () => {
    await invoice(59000, 9000, 59000)
    expect(await owes()).toBe(59000)
  })
})

describe('0315: today is India’s today', () => {
  it('leaves no live function reading current_date', async () => {
    const rows = await q<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc ~* '\\mcurrent_date\\M' order by 1`,
    )
    expect(rows.map((r) => r.name).filter((n) => !(n in UTC_ON_PURPOSE))).toEqual([])
  })
})

describe('0315: a plan given after the current plan waits for it', () => {
  it('keeps Studio Max’s limits until Max ends, then starts Starter', async () => {
    await asAdmin(`select platform_assign_plan('${COMPANY}', 't-max', true)`)
    await asAdmin(`select platform_assign_plan('${COMPANY}', 't-starter', false)`)
    const c = await one<{ plan: string; next: string; starts_days: number; ends_days: number; limits: unknown }>(
      `select c.plan, c.plan_next as next,
              round(extract(epoch from c.plan_next_from - now()) / 86400)::int as starts_days,
              round(extract(epoch from c.plan_expiry - now()) / 86400)::int as ends_days,
              (company_plan(c.id)).limits as limits
         from companies c where c.id = $1`,
      [COMPANY],
    )
    expect(c).toEqual({ plan: 't-max', next: 't-starter', starts_days: 365, ends_days: 730, limits: {} })

    // Nothing to switch yet.
    expect((await one<{ n: number }>(`select apply_pending_plans() as n`)).n).toBe(0)
    // Max ends: Starter starts, with its plan year from that day.
    await q(`update companies set plan_next_from = now() - interval '1 minute' where id = $1`, [COMPANY])
    expect((await one<{ n: number }>(`select apply_pending_plans() as n`)).n).toBe(1)
    const after = await one<{ plan: string; next: string | null; limits: unknown }>(
      `select c.plan, c.plan_next as next, (company_plan(c.id)).limits as limits from companies c where c.id = $1`,
      [COMPANY],
    )
    expect(after).toEqual({ plan: 't-starter', next: null, limits: { projects: 30 } })
  })

  it('a studio on its trial (no plan) gets the plan at once, as before', async () => {
    await q(`update companies set plan = null, plan_next = null, plan_next_from = null, plan_expiry = now() + interval '5 days' where id = $1`, [COMPANY])
    await asAdmin(`select platform_assign_plan('${COMPANY}', 't-starter', false)`)
    const c = await one<{ plan: string; next: string | null }>(`select plan, plan_next as next from companies where id = $1`, [COMPANY])
    expect(c).toEqual({ plan: 't-starter', next: null })
  })

  it('start today replaces the plan at once and clears anything waiting', async () => {
    await asAdmin(`select platform_assign_plan('${COMPANY}', 't-max', true)`)
    await asAdmin(`select platform_assign_plan('${COMPANY}', 't-starter', false)`)
    await asAdmin(`select platform_assign_plan('${COMPANY}', 't-starter', true)`)
    const c = await one<{ plan: string; next: string | null }>(`select plan, plan_next as next from companies where id = $1`, [COMPANY])
    expect(c).toEqual({ plan: 't-starter', next: null })
  })
})
