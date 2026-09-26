import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Reports (0189): the four tabs, worked out by hand for June 2026.
 *
 * Sales:    8 enquiries in June (4 Instagram, 3 referral, 1 Facebook), 3 booked
 *           -> 37.5%. Two lost, both "Budget". A May lead and an archived June
 *           lead are left out. Two projects booked in June worth 1,50,000 (a
 *           cancelled one is not a booking).
 * Money:    billed 1,00,000 (a draft and a July invoice are not); received
 *           60,000 (a promised 10,000 is not); still to collect 40,000 + 45,000
 *           + 30,000 = 1,15,000; overdue 40,000 on one invoice; expenses
 *           1,180 (1,000 + 18% entered without tax) + 5,000 = 6,180.
 * Delivery: 3 client deliverables delivered; 2 had a due date, 1 on time ->
 *           50%; 9, 19 and 15 days after the shoot -> 14.3; 1 late right now.
 * Team:     Crew did 2 shoots, delivered 2, was present 2 days. Editor
 *           delivered 1 (internal work counts for the person), has 1 late,
 *           and took 3.5 days of approved leave.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'f0000000-0000-4000-8000-000000000001'
const CREW = 'f0000000-0000-4000-8000-000000000002'
const EDIT = 'f0000000-0000-4000-8000-000000000003'
const OWNER_B = 'f0000000-0000-4000-8000-000000000004'
const A = 'f0000000-0000-4000-8000-0000000000aa'
const B = 'f0000000-0000-4000-8000-0000000000bb'
const C1 = 'f0000000-0000-4000-8000-0000000000c1'
const C2 = 'f0000000-0000-4000-8000-0000000000c2'
const CB = 'f0000000-0000-4000-8000-0000000000c3'
const P1 = 'f0000000-0000-4000-8000-0000000000b1'
const P2 = 'f0000000-0000-4000-8000-0000000000b2'
const P3 = 'f0000000-0000-4000-8000-0000000000b3'
const P4 = 'f0000000-0000-4000-8000-0000000000b4'
const PB = 'f0000000-0000-4000-8000-0000000000b5'
const S1 = 'f0000000-0000-4000-8000-0000000000e1'
const S2 = 'f0000000-0000-4000-8000-0000000000e2'
const I1 = 'f0000000-0000-4000-8000-0000000000d1'
const D4 = 'f0000000-0000-4000-8000-0000000000f4'

const FROM = '2026-06-01'
const TO = '2026-06-30'

let db: PGlite

type Sales = {
  enquiries: number
  booked: number
  conversion_pct: number | null
  bookings: number
  booking_value: number
  sources: { source: string; enquiries: number; booked: number }[]
  lost: number
  lost_reasons: { reason: string; count: number }[]
}
type Money = {
  billed: number
  invoices: number
  received: number
  to_collect: number
  overdue: number
  overdue_invoices: number
  expenses: number
  owes: { client_id: string; client_name: string; outstanding: number; overdue: number; overdue_days: number | null; invoice_id: string | null; project_id: string | null }[]
}
type Delivery = {
  delivered: number
  with_due_date: number
  on_time: number
  on_time_pct: number | null
  avg_days_to_deliver: number | null
  late_now: number
  late: { id: string; title: string; project_name: string; client_name: string | null; days_late: number; assignee_name: string | null }[]
}
type Team = {
  members: { user_id: string; name: string; shoots: number; delivered: number; late_now: number; days_present: number; leave_days: number }[]
}

const report = async <T>(fn: string, company = A, from = FROM, to = TO) =>
  (await db.query<{ r: T }>(`select ${fn}('${company}', '${from}', '${to}') as r`)).rows[0]!.r

async function asUser<T>(uid: string, sql: string): Promise<T> {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`)
  try {
    return (await db.query<{ r: T }>(sql)).rows[0]!.r
  } finally {
    await db.exec(`reset role; set request.jwt.claim.sub = '';`)
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  // The grants deploy/db/00_bootstrap.sql gives, so the RLS checks below run as the API does.
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'o@r.test'), ('${CREW}', 'c@r.test'), ('${EDIT}', 'e@r.test'), ('${OWNER_B}', 'b@r.test');
    insert into companies (id, name, owner_user_id) values ('${A}', 'Studio A', '${OWNER}'), ('${B}', 'Studio B', '${OWNER_B}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${A}', 'super_admin', 'Owner', 'o@r.test'),
      ('${CREW}', '${A}', 'employee', 'Crew', 'c@r.test'),
      ('${EDIT}', '${A}', 'employee', 'Editor', 'e@r.test'),
      ('${OWNER_B}', '${B}', 'super_admin', 'Other owner', 'b@r.test');
    insert into clients (id, company_id, name) values
      ('${C1}', '${A}', 'Sharma'), ('${C2}', '${A}', 'Verma'), ('${CB}', '${B}', 'Elsewhere');

    -- Sales
    insert into crm_leads (company_id, name, source, status, created_at, converted_at) values
      ('${A}', 'i1', 'instagram', 'converted', '2026-06-02 10:00+05:30', '2026-06-05'),
      ('${A}', 'i2', 'instagram', 'converted', '2026-06-03 10:00+05:30', '2026-06-06'),
      ('${A}', 'i3', 'instagram', 'new', '2026-06-04 10:00+05:30', null),
      ('${A}', 'i4', 'instagram', 'contacted', '2026-06-30 23:30+05:30', null),
      ('${A}', 'r1', 'referral', 'converted', '2026-06-01 00:30+05:30', '2026-06-09'),
      ('${A}', 'r2', 'referral', 'new', '2026-06-10 10:00+05:30', null),
      ('${A}', 'may', 'referral', 'converted', '2026-05-31 23:00+05:30', '2026-06-01');
    insert into crm_leads (company_id, name, source, status, lost_reason, created_at, stage_changed_at) values
      ('${A}', 'r3', 'referral', 'lost', 'Budget', '2026-06-11 10:00+05:30', '2026-06-12 10:00+05:30'),
      ('${A}', 'f1', 'facebook', 'lost', 'Budget', '2026-06-12 10:00+05:30', '2026-06-13 10:00+05:30');
    insert into crm_leads (company_id, name, source, status, created_at, is_archived) values
      ('${A}', 'archived', 'instagram', 'new', '2026-06-15 10:00+05:30', true);
    insert into crm_leads (company_id, name, source, status, created_at) values
      ('${B}', 'b1', 'instagram', 'converted', '2026-06-15 10:00+05:30');

    insert into projects (id, company_id, client_id, name, package_cost, status, created_by, created_at) values
      ('${P1}', '${A}', '${C1}', 'Sharma Wedding', 100000, 'active', '${OWNER}', '2026-06-05 12:00+05:30'),
      ('${P2}', '${A}', '${C2}', 'Verma Pre-wedding', 50000, 'active', '${OWNER}', '2026-06-20 12:00+05:30'),
      ('${P3}', '${A}', '${C1}', 'Sharma Engagement', 30000, 'completed', '${OWNER}', '2026-05-10 12:00+05:30'),
      ('${P4}', '${A}', '${C2}', 'Cancelled', 99999, 'cancelled', '${OWNER}', '2026-06-21 12:00+05:30'),
      ('${PB}', '${B}', '${CB}', 'Other studio', 777777, 'active', '${OWNER_B}', '2026-06-10 12:00+05:30');

    -- Money
    insert into invoices (id, company_id, client_id, project_id, invoice_number, invoice_date, due_date, status, subtotal, taxable, total, balance_due) values
      ('${I1}', '${A}', '${C1}', '${P1}', 'INV-1', '2026-06-06', '2026-06-15', 'sent', 100000, 100000, 100000, 100000);
    insert into invoices (company_id, client_id, project_id, invoice_number, invoice_date, due_date, status, subtotal, taxable, total, balance_due) values
      ('${A}', '${C2}', '${P2}', 'INV-2', '2026-06-21', '2026-06-25', 'draft', 50000, 50000, 50000, 50000),
      ('${A}', '${C2}', '${P2}', 'INV-3', '2026-07-02', '2099-01-01', 'sent', 20000, 20000, 20000, 20000),
      ('${B}', '${CB}', '${PB}', 'B-1', '2026-06-10', '2026-06-11', 'sent', 777777, 777777, 777777, 777777);
    insert into received_payments (company_id, project_id, invoice_id, amount, paid_on, status) values
      ('${A}', '${P1}', '${I1}', 60000, '2026-06-10', 'paid'),
      ('${A}', '${P1}', null, 10000, '2026-06-11', 'pending'),
      ('${A}', '${P2}', null, 5000, '2026-05-30', 'paid'),
      ('${B}', '${PB}', null, 1234, '2026-06-10', 'paid');
    insert into expenses (company_id, project_id, category, amount, expense_date, gst_treatment, gst_rate, amount_is) values
      ('${A}', '${P1}', 'Travel', 1000, '2026-06-12', 'gst_applicable', 18, 'excluding_tax'),
      ('${A}', null, 'Software', 5000, '2026-06-15', 'gst_applicable', 18, 'including_tax'),
      ('${A}', null, 'Software', 700, '2026-07-01', 'non_gst', 0, 'including_tax'),
      ('${B}', null, 'Software', 999, '2026-06-15', 'non_gst', 0, 'including_tax');

    -- Delivery
    insert into shoots (id, company_id, project_id, name, shoot_date) values
      ('${S1}', '${A}', '${P1}', 'Wedding', '2026-06-01'),
      ('${S2}', '${A}', '${P2}', 'Pre-wedding', '2026-06-10');
    insert into deliverables (company_id, project_id, shoot_id, list_key, title, status, estimated_date, delivered_at, assignee_id, visibility_scope) values
      ('${A}', '${P1}', '${S1}', 'primary', 'Teaser', 'completed', '2026-06-15', '2026-06-10 10:00+05:30', '${CREW}', 'client'),
      ('${A}', '${P1}', '${S1}', 'primary', 'Album', 'completed', '2026-06-15', '2026-06-20 10:00+05:30', '${CREW}', 'client'),
      ('${A}', '${P2}', null, 'primary', 'Photos', 'completed', null, '2026-06-25 10:00+05:30', null, 'client'),
      ('${A}', '${P1}', '${S1}', 'primary', 'Backup', 'completed', null, '2026-06-11 10:00+05:30', '${EDIT}', 'internal'),
      ('${A}', '${P1}', '${S1}', 'primary', 'Film', 'in_progress', '2099-01-01', null, null, 'client');
    insert into deliverables (id, company_id, project_id, list_key, title, status, estimated_date, assignee_id, visibility_scope) values
      ('${D4}', '${A}', '${P2}', 'primary', 'Reel', 'pending', '2026-06-01', '${EDIT}', 'client');

    -- Team
    insert into team_assignment_slots (company_id, user_id, shoot_id, status, start_at, end_at) values
      ('${A}', '${CREW}', '${S1}', 'booked', '2026-06-01 09:00+05:30', '2026-06-01 18:00+05:30'),
      ('${A}', '${CREW}', '${S2}', 'booked', '2026-06-10 09:00+05:30', '2026-06-10 18:00+05:30'),
      ('${A}', '${EDIT}', '${S2}', 'cancelled', '2026-06-10 09:00+05:30', '2026-06-10 18:00+05:30');
    insert into attendance (company_id, user_id, a_date, status) values
      ('${A}', '${CREW}', '2026-06-02', 'present'),
      ('${A}', '${CREW}', '2026-06-03', 'late'),
      ('${A}', '${CREW}', '2026-06-04', 'absent'),
      ('${A}', '${CREW}', '2026-07-01', 'present');
    insert into leave_requests (company_id, user_id, kind, start_date, end_date, half_day, status) values
      ('${A}', '${EDIT}', 'casual', '2026-06-08', '2026-06-10', false, 'approved'),
      ('${A}', '${EDIT}', 'casual', '2026-06-30', '2026-06-30', true, 'approved'),
      ('${A}', '${EDIT}', 'casual', '2026-06-15', '2026-06-16', false, 'rejected');
  `)
})

describe('reports: sales', () => {
  it('counts enquiries in the period and how many became bookings', async () => {
    const r = await report<Sales>('report_sales')
    expect(r.enquiries).toBe(8)
    expect(r.booked).toBe(3)
    expect(r.conversion_pct).toBe(37.5)
    expect(r.bookings).toBe(2)
    expect(r.booking_value).toBe(150000)
  })

  it('names the top sources and why leads were lost', async () => {
    const r = await report<Sales>('report_sales')
    expect(r.sources).toEqual([
      { source: 'instagram', enquiries: 4, booked: 2 },
      { source: 'referral', enquiries: 3, booked: 1 },
      { source: 'facebook', enquiries: 1, booked: 0 },
    ])
    expect(r.lost).toBe(2)
    expect(r.lost_reasons).toEqual([{ reason: 'Budget', count: 2 }])
  })

  it('has no conversion rate when nothing came in', async () => {
    const r = await report<Sales>('report_sales', A, '2020-01-01', '2020-01-31')
    expect(r.enquiries).toBe(0)
    expect(r.conversion_pct).toBeNull()
  })
})

describe('reports: money', () => {
  it('billed, received, still to collect, overdue and expenses', async () => {
    const r = await report<Money>('report_money')
    expect(r.billed).toBe(100000)
    expect(r.invoices).toBe(1)
    expect(r.received).toBe(60000)
    expect(r.to_collect).toBe(115000)
    expect(r.overdue).toBe(40000)
    expect(r.overdue_invoices).toBe(1)
    expect(r.expenses).toBe(6180)
  })

  it('matches the P&L on cash income and expenses', async () => {
    const pnl = (await db.query<{ r: { lines: Record<string, number>; rail: Record<string, number> } }>(
      `select profit_and_loss('${FROM}', '${TO}', 'cash', null) as r`,
    )).rows[0]!.r
    const r = await report<Money>('report_money')
    // The P&L here is not scoped by RLS (superuser), so compare on studio A only
    // where the other studio has nothing that month: expenses differ by B's 999.
    expect(r.received + 1234).toBe(pnl.lines.income)
    expect(r.expenses + 999).toBe(pnl.lines.project_expenses! + pnl.lines.studio_expenses!)
  })

  it('lists who owes the most, with how late they are', async () => {
    const r = await report<Money>('report_money')
    const today = (await db.query<{ d: string }>(`select report_today()::text as d`)).rows[0]!.d
    const days = Math.round((Date.parse(today) - Date.parse('2026-06-15')) / 86_400_000)
    expect(r.owes).toEqual([
      { client_id: C1, client_name: 'Sharma', outstanding: 70000, overdue: 40000, overdue_days: days, invoice_id: I1, project_id: P1 },
      { client_id: C2, client_name: 'Verma', outstanding: 45000, overdue: 0, overdue_days: null, invoice_id: null, project_id: P2 },
    ])
  })
})

describe('reports: delivery', () => {
  it('on time against the due date, and days from shoot to delivery', async () => {
    const r = await report<Delivery>('report_delivery')
    expect(r.delivered).toBe(3)
    expect(r.with_due_date).toBe(2)
    expect(r.on_time).toBe(1)
    expect(r.on_time_pct).toBe(50)
    expect(r.avg_days_to_deliver).toBe(14.3)
  })

  it('lists what is late right now', async () => {
    const r = await report<Delivery>('report_delivery')
    expect(r.late_now).toBe(1)
    expect(r.late).toEqual([
      expect.objectContaining({ id: D4, title: 'Reel', project_name: 'Verma Pre-wedding', client_name: 'Verma', assignee_name: 'Editor' }),
    ])
    expect(r.late[0]!.days_late).toBeGreaterThan(0)
  })
})

describe('reports: team', () => {
  it('shoots, work delivered, late work, days present and leave per person', async () => {
    const r = await report<Team>('report_team')
    const by = Object.fromEntries(r.members.map((m) => [m.name, m]))
    expect(by['Crew']).toMatchObject({ shoots: 2, delivered: 2, late_now: 0, days_present: 2, leave_days: 0 })
    expect(by['Editor']).toMatchObject({ shoots: 0, delivered: 1, late_now: 1, days_present: 0, leave_days: 3.5 })
    expect(by['Owner']).toMatchObject({ shoots: 0, delivered: 0 })
    expect(r.members.map((m) => m.name)).not.toContain('Other owner')
  })

  it('does not count a weekly off as a leave day', async () => {
    // 2026-06-08 is a Monday; make Mondays the weekly off.
    await db.exec(`insert into attendance_policy (company_id, weekly_off) values ('${A}', '{1}')
                   on conflict (company_id) do update set weekly_off = excluded.weekly_off`)
    try {
      const r = await report<Team>('report_team')
      expect(r.members.find((m) => m.name === 'Editor')!.leave_days).toBe(2.5)
    } finally {
      await db.exec(`delete from attendance_policy where company_id = '${A}'`)
    }
  })
})

describe('reports: one studio never sees another', () => {
  it('the other studio reads only its own numbers', async () => {
    const s = await report<Sales>('report_sales', B)
    expect(s).toMatchObject({ enquiries: 1, booked: 1, bookings: 1, booking_value: 777777 })
    const m = await report<Money>('report_money', B)
    expect(m).toMatchObject({ billed: 777777, received: 1234, expenses: 999 })
  })

  it('under RLS, asking about another studio returns nothing', async () => {
    const s = await asUser<Sales>(OWNER, `select report_sales('${B}', '${FROM}', '${TO}') as r`)
    expect(s).toMatchObject({ enquiries: 0, bookings: 0, booking_value: 0 })
    const m = await asUser<Money>(OWNER, `select report_money('${B}', '${FROM}', '${TO}') as r`)
    expect(m).toMatchObject({ billed: 0, received: 0, to_collect: 0, overdue: 0, expenses: 0, owes: [] })
    const t = await asUser<Team>(OWNER_B, `select report_team('${A}', '${FROM}', '${TO}') as r`)
    expect(t.members).toEqual([])
  })

  it('under RLS, the owner reads their own studio in full', async () => {
    const m = await asUser<Money>(OWNER, `select report_money('${A}', '${FROM}', '${TO}') as r`)
    expect(m).toMatchObject({ billed: 100000, received: 60000, to_collect: 115000, overdue: 40000, expenses: 6180 })
    const d = await asUser<Delivery>(OWNER, `select report_delivery('${A}', '${FROM}', '${TO}') as r`)
    expect(d).toMatchObject({ delivered: 3, on_time_pct: 50 })
  })
})
