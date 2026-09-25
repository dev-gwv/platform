import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Billing reshape (0170): receipt numbers per financial year, and one
 * expenses ledger that took in each person's own entries.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'f0000000-0000-4000-8000-000000000001'
const CREW = 'f0000000-0000-4000-8000-000000000002'
const OTHER_OWNER = 'f0000000-0000-4000-8000-000000000003'
const COMPANY = 'f0000000-0000-4000-8000-0000000000aa'
const OTHER = 'f0000000-0000-4000-8000-0000000000ab'
const CLIENT = 'f0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'f0000000-0000-4000-8000-0000000000b1'
const PE = 'f0000000-0000-4000-8000-0000000000d1'
const P_MARCH = 'f0000000-0000-4000-8000-0000000000a1'
const P_APRIL = 'f0000000-0000-4000-8000-0000000000a2'
const P_PROMISED = 'f0000000-0000-4000-8000-0000000000a3'
const P_LATER_CREATED_EARLIER_PAID = 'f0000000-0000-4000-8000-0000000000a5'
const OTHER_PROJECT = 'f0000000-0000-4000-8000-0000000000b2'

let db: PGlite
const one = async <T,>(q: string) => (await db.query<T>(q)).rows[0]!

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  // Everything before 0170, then the data the reshape has to take in, then 0170.
  for (const f of files.filter((x) => x < '0170_')) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${CREW}', 'c@s.test'), ('${OTHER_OWNER}', 'x@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${CREW}', '${COMPANY}', 'employee', 'Crew', 'c@s.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into clients (id, company_id, name) values ('f0000000-0000-4000-8000-0000000000c2', '${OTHER}', 'Verma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 100000, '${OWNER}'),
      ('${OTHER_PROJECT}', '${OTHER}', 'f0000000-0000-4000-8000-0000000000c2', 'Verma Reception', 50000, '${OTHER_OWNER}');
    insert into received_payments (id, company_id, project_id, amount, paid_on, status, created_at) values
      ('${P_APRIL}', '${COMPANY}', '${PROJECT}', 20000, '2026-04-01', 'paid', '2026-04-01 10:00+05:30'),
      ('${P_MARCH}', '${COMPANY}', '${PROJECT}', 10000, '2026-03-31', 'paid', '2026-03-31 10:00+05:30'),
      ('${P_LATER_CREATED_EARLIER_PAID}', '${COMPANY}', '${PROJECT}', 5000, '2026-03-01', 'paid', '2026-04-02 10:00+05:30'),
      ('${P_PROMISED}', '${COMPANY}', '${PROJECT}', 30000, '2026-04-10', 'pending', '2026-04-05 10:00+05:30');
    insert into personal_expense (id, company_id, user_id, amount, expense_date, category, gst_treatment, description, gst_rate, tax_amount)
      values ('${PE}', '${COMPANY}', '${CREW}', 1200, '2026-04-03', 'travel', 'gst_applicable', 'Cab to venue', 5, 60);
    insert into expense_attachments (company_id, personal_expense_id, file_name, file_url, url)
      values ('${COMPANY}', '${PE}', 'cab.jpg', '/files/abc', '/files/abc');
  `)
  for (const f of files.filter((x) => x >= '0170_')) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('receipt numbers', () => {
  it('numbers money already received by the date it came in, per financial year', async () => {
    const rows = (await db.query<{ id: string; receipt_number: string }>(`select id, receipt_number from received_payments`)).rows
    const by = Object.fromEntries(rows.map((r) => [r.id, r.receipt_number]))
    expect(by[P_LATER_CREATED_EARLIER_PAID]).toBe('RCP-2025-26-0001') // 1 Mar, though recorded last
    expect(by[P_MARCH]).toBe('RCP-2025-26-0002') // 31 Mar is still last year
    expect(by[P_APRIL]).toBe('RCP-2026-27-0001') // 1 Apr starts the new series
    expect(by[P_PROMISED]).toBeNull()
  })

  it('a promise gets its number the day it is received, after the ones before it', async () => {
    await db.exec(`update received_payments set status = 'paid' where id = '${P_PROMISED}'`)
    expect((await one<{ n: string }>(`select receipt_number as n from received_payments where id = '${P_PROMISED}'`)).n).toBe('RCP-2026-27-0002')
    // Numbering is permanent: an edit does not hand out a new one.
    await db.exec(`update received_payments set amount = 31000, status = 'paid' where id = '${P_PROMISED}'`)
    expect((await one<{ n: string }>(`select receipt_number as n from received_payments where id = '${P_PROMISED}'`)).n).toBe('RCP-2026-27-0002')
  })

  it('a new payment continues the series; another studio starts its own', async () => {
    await db.exec(`insert into received_payments (company_id, project_id, amount, paid_on, status) values ('${COMPANY}', '${PROJECT}', 100, '2026-05-01', 'paid')`)
    expect((await one<{ n: string }>(`select receipt_number as n from received_payments where amount = 100`)).n).toBe('RCP-2026-27-0003')
    await db.exec(`insert into received_payments (company_id, project_id, amount, paid_on, status) values ('${OTHER}', '${OTHER_PROJECT}', 700, '2026-05-01', 'paid')`)
    expect((await one<{ n: string }>(`select receipt_number as n from received_payments where amount = 700`)).n).toBe('RCP-2026-27-0001')
  })

  it('the client’s receipt shows it', async () => {
    const t = (await one<{ t: string }>(`select issue_payment_receipt(p_payment_id => '${P_APRIL}', p_ttl_hours => 24) as t`)).t
    const r = await one<{ receipt_number: string }>(`select receipt_number from get_receipt_for_token('${t}')`)
    expect(r.receipt_number).toBe('RCP-2026-27-0001')
  })

  it('reads the financial year the way accountants write it', async () => {
    const r = await one<{ a: string; b: string; c: string }>(`select fy_label('2026-03-31') as a, fy_label('2026-04-01') as b, fy_label('2029-12-25') as c`)
    expect([r.a, r.b, r.c]).toEqual(['2025-26', '2026-27', '2029-30'])
  })
})

describe('one expenses ledger', () => {
  it('took in the person’s own entry, with who paid and their bill attached', async () => {
    const e = await one<{ id: string; amount: number; paid_by_user_id: string; reimbursement_status: string; gst_rate: number; tax_amount: number; category: string }>(
      `select id, amount::float as amount, paid_by_user_id, reimbursement_status, gst_rate::float as gst_rate, tax_amount::float as tax_amount, category
         from expenses where source_personal_expense_id = '${PE}'`,
    )
    expect(e).toMatchObject({ amount: 1200, paid_by_user_id: CREW, reimbursement_status: 'none', gst_rate: 5, tax_amount: 60, category: 'travel' })
    const a = await one<{ n: number }>(`select count(*)::int as n from expense_attachments where expense_id = '${e.id}' and file_name = 'cab.jpg'`)
    expect(a.n).toBe(1)
  })

  it('copies each entry once, however many times the migration runs', async () => {
    await db.exec(readFileSync(join(migDir, readdirSync(migDir).find((x) => x.startsWith('0170_'))!), 'utf8'))
    const n = await one<{ n: number }>(`select count(*)::int as n from expenses where source_personal_expense_id = '${PE}'`)
    expect(n.n).toBe(1)
  })

  it('counts it in the studio’s Profit & Loss, and the rail no longer has a banked figure', async () => {
    const r = await one<{ r: { lines: { studio_expenses: number }; rail: Record<string, number> } }>(
      `select profit_and_loss('2026-04-01', '2026-04-30', 'cash') as r`,
    )
    expect(r.r.lines.studio_expenses).toBe(1260) // 1,200 + 5% GST, entered excluding tax
    expect(r.r.rail.still_to_collect).toBeDefined()
  })

  it('can be marked paid back', async () => {
    await db.exec(`update expenses set reimbursement_status = 'pending' where source_personal_expense_id = '${PE}'`)
    await db.exec(`update expenses set reimbursement_status = 'reimbursed', reimbursed_at = now() where source_personal_expense_id = '${PE}'`)
    const e = await one<{ s: string }>(`select reimbursement_status as s from expenses where source_personal_expense_id = '${PE}'`)
    expect(e.s).toBe('reimbursed')
    await expect(db.exec(`update expenses set reimbursement_status = 'lost' where source_personal_expense_id = '${PE}'`)).rejects.toThrow()
  })
})
