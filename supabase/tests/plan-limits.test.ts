import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Plans with limits (0241, 0242). A studio's plan year starts the day it
 * pays; a monthly plan carries the yearly numbers pro rata; leads that arrive
 * by themselves are never refused; a trial and an unlimited plan are never
 * stopped; upgrading part-way costs only the difference.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'f4000000-0000-4000-8000-000000000001'
const COMPANY = 'f4000000-0000-4000-8000-0000000000aa'
const TRIAL_OWNER = 'f4000000-0000-4000-8000-000000000002'
const TRIAL = 'f4000000-0000-4000-8000-0000000000bb'
const MONTHLY_OWNER = 'f4000000-0000-4000-8000-000000000003'
const MONTHLY = 'f4000000-0000-4000-8000-0000000000cc'
const TIGHT_OWNER = 'f4000000-0000-4000-8000-000000000004'
const TIGHT = 'f4000000-0000-4000-8000-0000000000dd'
const PRO_OWNER = 'f4000000-0000-4000-8000-000000000005'
const PRO = 'f4000000-0000-4000-8000-0000000000ee'
const CLIENT = 'f4000000-0000-4000-8000-0000000000c1'
const TRIAL_CLIENT = 'f4000000-0000-4000-8000-0000000000c2'
const MONTHLY_CLIENT = 'f4000000-0000-4000-8000-0000000000c3'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const project = (company: string, client: string, name: string) =>
  q(`insert into projects (company_id, client_id, name) values ($1, $2, $3)`, [company, client, name])
const as = (uid: string | null) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
const lead = (company: string, name: string, sourceKey: string | null = null) =>
  q(`insert into crm_leads (company_id, name, source_key) values ($1, $2, $3)`, [company, name, sourceKey])

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
    insert into plans (key, name, price, billing_interval, duration_days, is_active, audience, tier, limits)
      values ('tight_test', 'Tight', 100, 'yearly', 365, false, 'outsider', 'starter',
              '{"leads":2,"team_members":2,"enquiry_forms":1,"facebook_pages":1,"packages":1,"storage_mb":1}');
    insert into auth.users (id, email) values
      ('${OWNER}', 'o@s.test'), ('${TRIAL_OWNER}', 't@s.test'), ('${MONTHLY_OWNER}', 'm@s.test'),
      ('${TIGHT_OWNER}', 'x@s.test'), ('${PRO_OWNER}', 'p@s.test');
    -- Paid 165 days ago for a year: the plan year runs to 200 days from now.
    insert into companies (id, name, owner_user_id, plan, plan_expiry, plan_period_start) values
      ('${COMPANY}', 'Starter Studio', '${OWNER}', 'starter_yearly', now() + interval '200 days', now() - interval '165 days'),
      ('${MONTHLY}', 'Monthly Studio', '${MONTHLY_OWNER}', 'starter_monthly', now() + interval '20 days', now() - interval '10 days'),
      ('${TIGHT}', 'Tight Studio', '${TIGHT_OWNER}', 'tight_test', now() + interval '100 days', now() - interval '265 days'),
      ('${PRO}', 'Pro Studio', '${PRO_OWNER}', 'pro_yearly', now() + interval '300 days', now() - interval '65 days');
    insert into companies (id, name, owner_user_id) values ('${TRIAL}', 'Trial Studio', '${TRIAL_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${TRIAL_OWNER}', '${TRIAL}', 'super_admin', 'Trial owner', 't@s.test'),
      ('${MONTHLY_OWNER}', '${MONTHLY}', 'super_admin', 'Monthly owner', 'm@s.test'),
      ('${TIGHT_OWNER}', '${TIGHT}', 'super_admin', 'Tight owner', 'x@s.test'),
      ('${PRO_OWNER}', '${PRO}', 'super_admin', 'Pro owner', 'p@s.test');
    insert into clients (id, company_id, name) values
      ('${CLIENT}', '${COMPANY}', 'Client'), ('${TRIAL_CLIENT}', '${TRIAL}', 'Client'), ('${MONTHLY_CLIENT}', '${MONTHLY}', 'Client');
  `)
})

describe('plan limits from the billing date (0242)', () => {
  it('lets a Starter studio make 30 projects in its plan year, then says when it starts again', async () => {
    for (let i = 1; i <= 30; i++) await project(COMPANY, CLIENT, `Wedding ${i}`)
    await expect(project(COMPANY, CLIENT, 'Wedding 31')).rejects.toThrow(
      /Starter plan makes 30 projects a year; the count starts again on \d{1,2} \w{3} \d{4}\. Upgrade to add more\./,
    )
  })

  it('counts from the day the studio paid, not the calendar', async () => {
    const [w] = await q<{ starts: string; anchor: string; ends: string; expiry: string }>(
      `select w.starts::text, c.plan_period_start::text as anchor, w.ends::text, c.plan_expiry::text as expiry
         from plan_window($1) w, companies c where c.id = $1`,
      [COMPANY],
    )
    expect(w!.starts).toBe(w!.anchor)
    // A project made the day before the plan year began does not count.
    await q(`update projects set created_at = now() - interval '166 days' where company_id = $1 and name = 'Wedding 1'`, [COMPANY])
    await project(COMPANY, CLIENT, 'Wedding 31')
    const [u] = await q<{ v: { projects: number } }>(`select company_usage($1) as v`, [COMPANY])
    expect(u!.v.projects).toBe(30)
  })

  it('rolls into the next plan year on the anniversary', async () => {
    await q(`update companies set plan_period_start = now() - interval '400 days' where id = $1`, [COMPANY])
    const [w] = await q<{ ok: boolean }>(
      `select abs(extract(epoch from starts - (now() - interval '35 days'))) < 60 as ok from plan_window($1)`,
      [COMPANY],
    )
    expect(w!.ok).toBe(true)
    await q(`update companies set plan_period_start = now() - interval '165 days' where id = $1`, [COMPANY])
  })

  it('gives a monthly plan its share: 3 projects a pass', async () => {
    for (let i = 1; i <= 3; i++) await project(MONTHLY, MONTHLY_CLIENT, `Shoot ${i}`)
    await expect(project(MONTHLY, MONTHLY_CLIENT, 'Shoot 4')).rejects.toThrow(/makes 3 projects a month/)
  })

  it('never stops a studio on a trial, or on Pro', async () => {
    for (let i = 1; i <= 35; i++) await project(TRIAL, TRIAL_CLIENT, `Shoot ${i}`)
    const [n] = await q<{ n: number }>(`select count(*)::int as n from projects where company_id = $1`, [TRIAL])
    expect(n!.n).toBe(35)
    const [room] = await q<{ r: number | null }>(`select plan_room($1, 'projects') as r`, [PRO])
    expect(room!.r).toBeNull()
  })

  it('refuses leads added by hand past the limit, never leads that arrive by themselves', async () => {
    await as(TIGHT_OWNER)
    await lead(TIGHT, 'Asha')
    await lead(TIGHT, 'Ravi')
    await expect(lead(TIGHT, 'Meena')).rejects.toThrow(/takes 2 leads a year\. Enquiries from your forms and Facebook still come in\./)
    await expect(lead(TIGHT, 'From a sheet', 'csv_import')).rejects.toThrow(/2 leads a year/)
    // A form or Facebook lead: captured with its source's key, or with nobody signed in.
    await lead(TIGHT, 'Facebook lead', 'fb_main')
    await as(null)
    await lead(TIGHT, 'Website lead')
    const rows = await q<{ created_via: string }>(`select created_via from crm_leads where company_id = $1 order by created_at`, [TIGHT])
    expect(rows.map((r) => r.created_via)).toEqual(['manual', 'manual', 'auto', 'auto'])
  })

  it('counts team without a login on their own, and logins on theirs', async () => {
    // A member without a login still has an account behind them, with no password.
    const crew = (name: string) =>
      q(
        `with a as (insert into auth.users (email) values ($2) returning id)
         insert into users (user_id, company_id, role, name, login_enabled) select id, $1, 'employee', $3, false from a`,
        [TIGHT, `${name.replace(' ', '').toLowerCase()}@crew.test`, name],
      )
    await crew('Crew 1')
    await crew('Crew 2')
    await expect(crew('Crew 3')).rejects.toThrow(/2 team members without a login/)
    // Switching someone off frees a place.
    await q(`update users set status = 'inactive' where company_id = $1 and name = 'Crew 1'`, [TIGHT])
    await crew('Crew 4')
    await expect(q(`update users set status = 'active' where company_id = $1 and name = 'Crew 1'`, [TIGHT])).rejects.toThrow(/without a login/)
  })

  it('checks an enquiry form brought back from the archive', async () => {
    const src = await q<{ id: string }>(
      `insert into crm_webhook_sources (company_id, source_key) values ($1, 'eq_a'), ($1, 'eq_b') returning id`,
      [TIGHT],
    )
    const [a] = await q<{ id: string }>(
      `insert into enquiry_forms (company_id, name, code, source_id) values ($1, 'Website', 'abcdefg', $2) returning id`,
      [TIGHT, src[0]!.id],
    )
    await q(`update enquiry_forms set archived_at = now() where id = $1`, [a!.id])
    await q(`insert into enquiry_forms (company_id, name, code, source_id) values ($1, 'Vendor', 'bcdefgh', $2)`, [TIGHT, src[1]!.id])
    await expect(q(`update enquiry_forms set archived_at = null where id = $1`, [a!.id])).rejects.toThrow(/1 enquiry forms/)
  })

  it('connects one Facebook Page, keeps one package (the sample is free) and 1 MB of uploads', async () => {
    await q(`insert into fb_pages (company_id, page_id, page_name) values ($1, 'p1', 'Main'), ($1, 'p2', 'Second')`, [TIGHT])
    await q(`update fb_pages set is_connected = true where company_id = $1 and page_id = 'p1'`, [TIGHT])
    await expect(q(`update fb_pages set is_connected = true where company_id = $1 and page_id = 'p2'`, [TIGHT])).rejects.toThrow(
      /connects 1 Facebook Page/,
    )
    const [room] = await q<{ r: number }>(`select plan_room($1, 'facebook_pages') as r`, [TIGHT])
    expect(room!.r).toBe(0)

    const [sample] = await q<{ n: number }>(`select count(*)::int as n from project_templates where company_id = $1 and is_sample`, [TIGHT])
    expect(sample!.n).toBe(1)
    await q(`insert into project_templates (company_id, name) values ($1, 'Gold')`, [TIGHT])
    await expect(q(`insert into project_templates (company_id, name) values ($1, 'Platinum')`, [TIGHT])).rejects.toThrow(/saves 1 packages/)

    const file = (name: string) =>
      q(`insert into files (company_id, name, mime, size_bytes, bytes) values ($1, $2, 'image/png', 600000, '\\x00')`, [TIGHT, name])
    await file('a.png')
    await expect(file('b.png')).rejects.toThrow(/uploads/)
  })

  it('prices an upgrade at the difference, and starts the new plan year that day', async () => {
    const [quote] = await q<{ kind: string; credit: string; amount: string }>(
      `select kind, credit::text, amount::text from plan_quote($1, (select id from plans where key = 'pro_yearly'))`,
      [COMPANY],
    )
    expect(quote!.kind).toBe('upgrade')
    const credit = Number(quote!.credit)
    expect(credit).toBeGreaterThan(17988 * 199 / 365)
    expect(credit).toBeLessThan(17988 * 201 / 365)
    expect(Number(quote!.amount)).toBeCloseTo(Math.round((29988 - credit) * 118) / 100, 1)

    const [renew] = await q<{ kind: string }>(`select kind from plan_quote($1, (select id from plans where key = 'starter_monthly'))`, [COMPANY])
    expect(renew!.kind).toBe('renew')
    const [down] = await q<{ kind: string; until: boolean }>(
      `select kind, blocked_until = (select plan_expiry from companies where id = $1) as until
         from plan_quote($1, (select id from plans where key = 'starter_yearly'))`,
      [PRO],
    )
    expect(down).toEqual({ kind: 'later', until: true })

    const [order] = await q<{ id: string }>(
      `insert into payment_orders (company_id, plan_id, amount, status, kind, credit)
         values ($1, (select id from plans where key = 'pro_yearly'), $2, 'created', 'upgrade', $3) returning id`,
      [COMPANY, quote!.amount, credit],
    )
    await q(`select * from activate_subscription($1, 'pay_up_1')`, [order!.id])
    const [co] = await q<{ plan: string; fresh: boolean; year: boolean }>(
      `select plan, plan_period_start > now() - interval '1 minute' as fresh,
              plan_expiry between now() + interval '364 days' and now() + interval '366 days' as year
         from companies where id = $1`,
      [COMPANY],
    )
    expect(co).toEqual({ plan: 'pro_yearly', fresh: true, year: true })
  })

  it('continues the plan year on a renewal', async () => {
    const before = await q<{ anchor: string; expiry: string }>(
      `select plan_period_start::text as anchor, plan_expiry::text as expiry from companies where id = $1`,
      [PRO],
    )
    const [order] = await q<{ id: string }>(
      `insert into payment_orders (company_id, plan_id, amount, status, kind)
         values ($1, (select id from plans where key = 'pro_yearly'), 35385.84, 'created', 'renew') returning id`,
      [PRO],
    )
    await q(`select * from activate_subscription($1, 'pay_renew_1')`, [order!.id])
    const [after] = await q<{ anchor: string; later: boolean }>(
      `select plan_period_start::text as anchor, plan_expiry = $2::timestamptz + interval '365 days' as later from companies where id = $1`,
      [PRO, before[0]!.expiry],
    )
    expect(after).toEqual({ anchor: before[0]!.anchor, later: true })
  })

  it('gives a plan its extras, and paying records the plan', async () => {
    const [before] = await q<{ ok: boolean }>(`select company_can($1, 'white_label') as ok`, [MONTHLY])
    expect(before!.ok).toBe(false)
    await q(`update companies set plan = 'max_monthly' where id = $1`, [MONTHLY])
    const [after] = await q<{ ok: boolean }>(`select company_can($1, 'white_label') as ok`, [MONTHLY])
    expect(after!.ok).toBe(true)

    const [order] = await q<{ id: string }>(
      `insert into payment_orders (company_id, plan_id, amount, status) values ($1, (select id from plans where key = 'pro_yearly'), 35385.84, 'created') returning id`,
      [TRIAL],
    )
    await q(`select * from activate_subscription($1, 'pay_test_1')`, [order!.id])
    const [co] = await q<{ plan: string; anchored: boolean }>(
      `select plan, plan_period_start is not null as anchored from companies where id = $1`,
      [TRIAL],
    )
    expect(co).toEqual({ plan: 'pro_yearly', anchored: true })
  })

  it('writes Starter, Pro and Studio Max as the owner set them, still switched off', async () => {
    const rows = await q<{ key: string; limits: Record<string, number>; free_emails_month: number | null; is_active: boolean }>(
      `select key, limits, free_emails_month, is_active from plans where tier is not null and key <> 'tight_test' order by key`,
    )
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by['starter_yearly']!.limits).toMatchObject({ projects: 30, invoices: 60, leads: 300, team_logins: 3, team_members: 20 })
    expect(by['starter_monthly']!.limits).toMatchObject({ projects: 3, invoices: 5, leads: 25, team_logins: 3 })
    expect(by['pro_yearly']!.limits).toEqual({})
    expect(by['max_yearly']!.limits).toEqual({})
    expect(rows.map((r) => r.free_emails_month)).toEqual([null, null, 300, 300, 100, 100])
    expect(rows.every((r) => !r.is_active)).toBe(true)
  })
})
