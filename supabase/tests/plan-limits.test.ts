import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Plans with limits (0241): a Starter studio makes so many projects and
 * invoices a month and no more; a trial and an unlimited plan are never
 * stopped; extras come with the plan; paying records the plan.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'f4000000-0000-4000-8000-000000000001'
const COMPANY = 'f4000000-0000-4000-8000-0000000000aa'
const TRIAL_OWNER = 'f4000000-0000-4000-8000-000000000002'
const TRIAL = 'f4000000-0000-4000-8000-0000000000bb'
const CLIENT = 'f4000000-0000-4000-8000-0000000000c1'
const TRIAL_CLIENT = 'f4000000-0000-4000-8000-0000000000c2'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const project = (company: string, client: string, name: string) =>
  q(`insert into projects (company_id, client_id, name) values ($1, $2, $3)`, [company, client, name])

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${TRIAL_OWNER}', 't@s.test');
    insert into companies (id, name, owner_user_id, plan, plan_expiry) values
      ('${COMPANY}', 'Starter Studio', '${OWNER}', 'starter_monthly', now() + interval '20 days');
    insert into companies (id, name, owner_user_id) values ('${TRIAL}', 'Trial Studio', '${TRIAL_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${TRIAL_OWNER}', '${TRIAL}', 'super_admin', 'Trial owner', 't@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Client'), ('${TRIAL_CLIENT}', '${TRIAL}', 'Client');
  `)
})

describe('plan limits (0241)', () => {
  it('lets a Starter studio make 8 projects a month, then says why it stops', async () => {
    for (let i = 1; i <= 8; i++) await project(COMPANY, CLIENT, `Wedding ${i}`)
    await expect(project(COMPANY, CLIENT, 'Wedding 9')).rejects.toThrow(/Starter plan makes 8 projects a month\. Upgrade to add more\./)
  })

  it('counts this month only', async () => {
    await q(`update projects set created_at = now() - interval '40 days' where company_id = $1 and name = 'Wedding 1'`, [COMPANY])
    await project(COMPANY, CLIENT, 'Wedding 9')
    const [u] = await q<{ v: { projects_per_month: number } }>(`select company_usage($1) as v`, [COMPANY])
    expect(u!.v.projects_per_month).toBe(8)
  })

  it('never stops a studio on a trial', async () => {
    for (let i = 1; i <= 10; i++) await project(TRIAL, TRIAL_CLIENT, `Shoot ${i}`)
    const [n] = await q<{ n: number }>(`select count(*)::int as n from projects where company_id = $1`, [TRIAL])
    expect(n!.n).toBe(10)
  })

  it('counts team logins, not the owner and not people without a login', async () => {
    await q(`insert into auth.users (id, email) select gen_random_uuid(), 'm' || g || '@s.test' from generate_series(1, 6) g`)
    const ids = await q<{ id: string }>(`select id from auth.users where email like 'm%@s.test' order by email`)
    for (const [i, r] of ids.slice(0, 5).entries()) {
      await q(`insert into users (user_id, company_id, role, name, email) values ($1, $2, 'employee', $3, $4)`, [r.id, COMPANY, `M${i}`, `m${i}@x.test`])
    }
    await expect(
      q(`insert into users (user_id, company_id, role, name, email) values ($1, $2, 'employee', 'Sixth', 'six@x.test')`, [ids[5]!.id, COMPANY]),
    ).rejects.toThrow(/5 team logins/)
    await q(
      `insert into users (user_id, company_id, role, name, email, login_enabled) values ($1, $2, 'employee', 'Freelancer', 'fl@x.test', false)`,
      [ids[5]!.id, COMPANY],
    )
  })

  it('gives a plan its extras, and paying records the plan', async () => {
    const [before] = await q<{ ok: boolean }>(`select company_can($1, 'white_label') as ok`, [COMPANY])
    expect(before!.ok).toBe(false)
    await q(`update companies set plan = 'max_monthly' where id = $1`, [COMPANY])
    const [after] = await q<{ ok: boolean }>(`select company_can($1, 'white_label') as ok`, [COMPANY])
    expect(after!.ok).toBe(true)

    const [plan] = await q<{ id: string }>(`select id from plans where key = 'pro_yearly'`)
    const [order] = await q<{ id: string }>(
      `insert into payment_orders (company_id, plan_id, amount, status) values ($1, $2, 35385.84, 'created') returning id`,
      [TRIAL, plan!.id],
    )
    await q(`select * from activate_subscription($1, 'pay_test_1')`, [order!.id])
    const [co] = await q<{ plan: string }>(`select plan from companies where id = $1`, [TRIAL])
    expect(co!.plan).toBe('pro_yearly')
  })

  it('keeps the new plans switched off until the owner picks', async () => {
    const rows = await q<{ n: number }>(`select count(*)::int as n from plans where tier is not null and is_active`)
    expect(rows[0]!.n).toBe(0)
  })
})
