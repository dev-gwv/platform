import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0284: an invoice with money on it can still be changed (never below what
 * was received), a cancelled one reopens, a payroll month reopens and a
 * salary marked paid can be undone, and invoices can be numbered by date or
 * typed by hand.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const OWNER = 'e8400000-0000-4000-8000-000000000001'
const RAVI = 'e8400000-0000-4000-8000-000000000002'
const COMPANY = 'e8400000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const one = async <T>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0]!

const ITEMS = (amount: number) => JSON.stringify([{ description: 'Wedding', quantity: 1, rate: amount, amount, gst_rate: 0, taxable: amount, cgst: 0, sgst: 0, igst: 0 }])
const makeInvoice = async (total: number, number: string | null = null, date = '2026-10-26') =>
  one<{ id: string; invoice_number: string }>(
    `select * from create_invoice(null, null, null, $1::date, null, $2, 0, $2, 0, $2, $3::jsonb, null, null, $4)`,
    [date, total, ITEMS(total), number],
  )
const update = (id: string, total: number) =>
  q(`select update_invoice($1, null, null, null, true, null, null, $2, 0, $2, 0, $2, $3::jsonb)`, [id, total, ITEMS(total)])
const pay = (id: string, amount: number) =>
  q(`insert into received_payments (company_id, invoice_id, amount, paid_on, status, client_id, project_id)
     values ($1, $2, $3, current_date, 'paid', null, null)`, [COMPANY, id, amount])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'asha@s.test'), ('${RAVI}', 'ravi@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'asha@s.test'),
      ('${RAVI}', '${COMPANY}', 'employee', 'Ravi', 'ravi@s.test');
    set request.jwt.claim.sub = '${OWNER}';
  `)
})

describe('0284 edit and undo: money', () => {
  it('edits an invoice with money on it, never below what was received', async () => {
    const inv = await makeInvoice(10000)
    await pay(inv.id, 4000)
    await update(inv.id, 12000)
    let row = await one<{ total: number; amount_paid: number; balance_due: number; status: string }>(
      `select total::float8 as total, amount_paid::float8 as amount_paid, balance_due::float8 as balance_due, status from invoices where id = $1`, [inv.id])
    expect(row).toEqual({ total: 12000, amount_paid: 4000, balance_due: 8000, status: 'partial' })
    await expect(update(inv.id, 3000)).rejects.toThrow(/less than/)
    await update(inv.id, 4000)
    row = await one(`select total::float8 as total, amount_paid::float8 as amount_paid, balance_due::float8 as balance_due, status from invoices where id = $1`, [inv.id])
    expect(row.status).toBe('paid')
  })

  it('keeps a cancelled invoice cancelled, and reopens it on purpose', async () => {
    const inv = await makeInvoice(5000)
    await q(`update invoices set status = 'cancelled', balance_due = 0 where id = $1`, [inv.id])
    await expect(update(inv.id, 6000)).rejects.toThrow(/reopen/)
    await pay(inv.id, 1000)
    expect((await one<{ status: string }>(`select status from invoices where id = $1`, [inv.id])).status).toBe('cancelled')
    expect((await one<{ s: string }>(`select reopen_invoice($1) as s`, [inv.id])).s).toBe('partial')
  })

  it('numbers invoices by their date, or refuses a blank one when the studio types them', async () => {
    await q(`update companies set invoice_number_mode = 'date', invoice_number_prefix = 'INV-' where id = $1`, [COMPANY])
    expect((await makeInvoice(100, null, '2026-10-26')).invoice_number).toBe('INV-20261026')
    expect((await makeInvoice(100, null, '2026-10-26')).invoice_number).toBe('INV-20261026-2')
    expect((await makeInvoice(100, null, '2026-11-01')).invoice_number).toBe('INV-20261101')
    await q(`update companies set invoice_number_mode = 'manual' where id = $1`, [COMPANY])
    await expect(makeInvoice(100)).rejects.toThrow(/type the invoice number/)
    expect((await makeInvoice(100, 'GWV/26/007')).invoice_number).toBe('GWV/26/007')
    await q(`update companies set invoice_number_mode = 'running' where id = $1`, [COMPANY])
    expect((await makeInvoice(100)).invoice_number).toMatch(/^INV-\d{4}$/)
  })

  it('reopens an approved payroll month, and undoes a salary marked paid', async () => {
    const run = await one<{ id: string }>(
      `insert into payroll_runs (company_id, pay_year, pay_month, status) values ($1, 2026, 9, 'approved') returning id`, [COMPANY])
    const line = await one<{ id: string }>(
      `insert into payroll_lines (run_id, company_id, user_id, pay_year, pay_month, period_start, period_end, base_amount, net_pay, released) values ($1, $2, $3, 2026, 9, '2026-09-01', '2026-09-30', 20000, 20000, true) returning id`,
      [run.id, COMPANY, RAVI])
    await q(`select payroll_mark_paid($1, $2, $3, $4, 'UPI', 'ref1')`, [COMPANY, run.id, line.id, OWNER])
    await expect(q(`select payroll_reopen($1, $2, $3)`, [COMPANY, run.id, OWNER])).rejects.toThrow(/already marked paid/)
    await q(`select payroll_unmark_paid($1, $2, $3, $4)`, [COMPANY, run.id, line.id, OWNER])
    expect(await one(`select paid_at, paid_amount::float8 as paid_amount from payroll_lines where id = $1`, [line.id])).toEqual({ paid_at: null, paid_amount: 0 })
    expect((await one<{ status: string }>(`select status from payroll_runs where id = $1`, [run.id])).status).toBe('approved')
    expect((await one<{ status: string }>(`select status from monthly_salaries where user_id = $1 and pay_year = 2026 and pay_month = 9`, [RAVI])).status).toBe('unpaid')
    await q(`select payroll_reopen($1, $2, $3)`, [COMPANY, run.id, OWNER])
    expect(await one(`select status, approved_at from payroll_runs where id = $1`, [run.id])).toEqual({ status: 'draft', approved_at: null })
  })
})
