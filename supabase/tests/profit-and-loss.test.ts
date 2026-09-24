import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Profit & Loss (0167): every cost counted once, on a cash and a booked
 * basis, worked out by hand below.
 *
 * June 2026, one project worth 1,00,000 with a shoot in June and one in July:
 *   received 60,000 (paid) + 20,000 (only promised)
 *   crew on the June shoot: 15,000, of which 10,000 paid
 *   a manual payout 4,000 (completed)
 *   project expense 1,000 + 18% GST, entered excluding tax  -> 1,180
 *   studio expense 5,000 including tax                       -> 5,000
 *   salary 30,000 (paid), rent 20,000
 * Cash:   60,000 - 10,000 - 4,000 - 1,180 = 44,820 gross; - 55,000 = -10,180 net
 * Booked: 50,000 - 15,000 - 4,000 - 1,180 = 29,820 gross; - 55,000 = -25,180 net
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')


const OWNER = 'e0000000-0000-4000-8000-000000000001'
const CREW = 'e0000000-0000-4000-8000-000000000002'
const COMPANY = 'e0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'e0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'e0000000-0000-4000-8000-0000000000b1'
const JUNE_SHOOT = 'e0000000-0000-4000-8000-0000000000e1'
const JULY_SHOOT = 'e0000000-0000-4000-8000-0000000000e2'
const SLOT = 'e0000000-0000-4000-8000-0000000000f1'

let db: PGlite
type Pnl = {
  basis: string
  lines: Record<string, number>
  monthly: { month: string; income: number; net_profit: number }[]
  categories: { category: string; amount: number }[]
  projects: { project_id: string; income: number; team: number; expenses: number; profit: number; to_collect: number }[]
  rail: { still_to_collect: number; owed_to_team: number; unbanked: number }
}
const pnl = async (from: string, to: string, basis: string, project: string | null = null) =>
  (await db.query<{ r: Pnl }>(`select profit_and_loss('${from}', '${to}', '${basis}', ${project ? `'${project}'` : 'null'}) as r`)).rows[0]!.r

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${CREW}', 'c@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${CREW}', '${COMPANY}', 'employee', 'Crew', 'c@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by, created_at) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 100000, '${OWNER}', '2026-05-20');
    insert into shoots (id, company_id, project_id, name, shoot_date) values
      ('${JUNE_SHOOT}', '${COMPANY}', '${PROJECT}', 'Haldi', '2026-06-10'),
      ('${JULY_SHOOT}', '${COMPANY}', '${PROJECT}', 'Wedding', '2026-07-15');
    insert into received_payments (company_id, project_id, amount, paid_on, status, cleared_at) values
      ('${COMPANY}', '${PROJECT}', 60000, '2026-06-05', 'paid', null),
      ('${COMPANY}', '${PROJECT}', 20000, '2026-06-06', 'pending', null);
    insert into team_assignment_slots (id, company_id, user_id, shoot_id, status, estimated_cost, final_cost, start_at, end_at) values
      ('${SLOT}', '${COMPANY}', '${CREW}', '${JUNE_SHOOT}', 'booked', 12000, 15000, '2026-06-10 09:00+05:30', '2026-06-10 18:00+05:30');
    insert into team_slot_settlements (company_id, slot_id, member_uid, project_id, shoot_id, amount_due, amount_paid, paid_date, entry_type) values
      ('${COMPANY}', '${SLOT}', '${CREW}', '${PROJECT}', '${JUNE_SHOOT}', 15000, 10000, '2026-06-20', 'payment');
    insert into team_payouts (company_id, user_id, amount, period_start, period_end, status) values
      ('${COMPANY}', '${CREW}', 4000, '2026-06-01', '2026-06-30', 'completed');
    insert into expenses (company_id, project_id, category, amount, expense_date, gst_treatment, gst_rate, amount_is) values
      ('${COMPANY}', '${PROJECT}', 'Travel', 1000, '2026-06-12', 'gst_applicable', 18, 'excluding_tax'),
      ('${COMPANY}', null, 'Software', 5000, '2026-06-15', 'gst_applicable', 18, 'including_tax');
    insert into monthly_salaries (company_id, user_id, month, gross, net, paid_amount, status) values
      ('${COMPANY}', '${CREW}', '2026-06-01', 30000, 30000, 30000, 'paid');
    insert into fixed_overheads (company_id, category, label, amount, month, is_active) values
      ('${COMPANY}', 'rent', 'Studio rent', 20000, '2026-06-01', true);
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('profit and loss', () => {
  it('on cash: what came in and went out in June', async () => {
    const r = await pnl('2026-06-01', '2026-06-30', 'cash')
    expect(r.basis).toBe('cash')
    expect(r.lines).toMatchObject({
      income: 60000,
      team_crew: 10000,
      team_payouts: 4000,
      project_expenses: 1180,
      gross_profit: 44820,
      salaries: 30000,
      overheads: 20000,
      studio_expenses: 5000,
      net_profit: -10180,
    })
  })

  it('on booked: the June shoot’s half of the project, and its crew', async () => {
    const r = await pnl('2026-06-01', '2026-06-30', 'booked')
    expect(r.lines).toMatchObject({ income: 50000, team_crew: 15000, gross_profit: 29820, net_profit: -25180 })
  })

  it('never counts a promised payment as income', async () => {
    const r = await pnl('2026-06-06', '2026-06-06', 'cash')
    expect(r.lines.income).toBe(0)
  })

  it('shows each project, and what is still to collect and owed', async () => {
    const r = await pnl('2026-06-01', '2026-06-30', 'cash')
    expect(r.projects).toEqual([
      expect.objectContaining({ project_id: PROJECT, income: 60000, team: 10000, expenses: 1180, profit: 48820, to_collect: 40000 }),
    ])
    expect(r.rail).toEqual({ still_to_collect: 40000, owed_to_team: 5000, unbanked: 60000 })
  })

  it('draws twelve months ending with the period, and where the money went', async () => {
    const r = await pnl('2026-06-01', '2026-06-30', 'booked')
    expect(r.monthly).toHaveLength(12)
    expect(r.monthly.at(-1)).toMatchObject({ month: '2026-06', income: 50000 })
    expect(r.monthly.find((m) => m.month === '2026-05')?.income).toBe(0)
    expect(r.categories.map((c) => c.category)).toEqual(['rent', 'Software', 'Travel'])
  })

  it('one project over its whole life, for its Billing tab', async () => {
    const r = await pnl('2000-01-01', '2100-12-31', 'booked', PROJECT)
    expect(r.projects[0]).toMatchObject({ income: 100000, team: 15000, expenses: 1180, profit: 83820 })
  })

  it('refuses a backwards period', async () => {
    await expect(pnl('2026-07-01', '2026-06-01', 'cash')).rejects.toThrow(/start and an end/)
  })
})
