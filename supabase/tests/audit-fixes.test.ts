import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0314: the audit's money and database fixes -- an edit never knocks a
 * part-paid invoice back to sent, no money lands on a draft or cancelled
 * invoice, usage_events can be pruned without losing "last seen", and the
 * date columns default to India's today. The migration is applied twice:
 * it must be safe to run again.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const OWNER = 'e9140000-0000-4000-8000-000000000001'
const RAVI = 'e9140000-0000-4000-8000-000000000002'
const COMPANY = 'e9140000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const one = async <T>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0]!

const ITEMS = (amount: number) => JSON.stringify([{ description: 'Wedding', quantity: 1, rate: amount, amount, gst_rate: 0, taxable: amount, cgst: 0, sgst: 0, igst: 0 }])
const makeInvoice = async (total: number) =>
  one<{ id: string }>(`select * from create_invoice(null, null, null, null, null, $1, 0, $1, 0, $1, $2::jsonb)`, [total, ITEMS(total)])
const update = (id: string, total: number) =>
  q(`select update_invoice($1, null, null, null, true, null, null, $2, 0, $2, 0, $2, $3::jsonb)`, [id, total, ITEMS(total)])
const pay = (id: string, amount: number) =>
  q(`insert into received_payments (company_id, invoice_id, amount, paid_on, status) values ($1, $2, $3, current_date, 'paid')`, [COMPANY, id, amount])
/**
 * The status line of writeInvoiceExtras (services/api/src/modules/billing/
 * routes-invoices.ts), run after update_invoice as the edit does: the form
 * only chooses between draft and sent.
 */
const writeStatus = (id: string, status: 'draft' | 'sent') =>
  q(`update invoices set status = case when status in ('draft', 'sent') then $2 else status end where id = $1`, [id, status])
const statusOf = async (id: string) => (await one<{ status: string }>(`select status from invoices where id = $1`, [id])).status

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  // Safe to run twice.
  await db.exec(readFileSync(join(migDir, '0314_audit_fixes.sql'), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'asha@s.test'), ('${RAVI}', 'ravi@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'asha@s.test'),
      ('${RAVI}', '${COMPANY}', 'employee', 'Ravi', 'ravi@s.test');
    set request.jwt.claim.sub = '${OWNER}';
  `)
})

describe('0314 audit fixes', () => {
  it('keeps a part-paid invoice part paid when it is edited and saved as sent', async () => {
    const inv = await makeInvoice(10000)
    await pay(inv.id, 4000)
    expect(await statusOf(inv.id)).toBe('partial')
    await update(inv.id, 12000)
    await writeStatus(inv.id, 'sent')
    expect(await statusOf(inv.id)).toBe('partial')
    await update(inv.id, 4000)
    await writeStatus(inv.id, 'sent')
    expect(await statusOf(inv.id)).toBe('paid')
  })

  it('still moves an unpaid invoice between draft and sent', async () => {
    const inv = await makeInvoice(5000)
    await writeStatus(inv.id, 'draft')
    expect(await statusOf(inv.id)).toBe('draft')
    await writeStatus(inv.id, 'sent')
    expect(await statusOf(inv.id)).toBe('sent')
  })

  it('refuses money on a draft or a cancelled invoice, with words the API can read', async () => {
    const draft = await makeInvoice(3000)
    await writeStatus(draft.id, 'draft')
    await expect(pay(draft.id, 1000)).rejects.toThrow(/invoice is still a draft/)
    const cancelled = await makeInvoice(3000)
    await q(`update invoices set status = 'cancelled', balance_due = 0 where id = $1`, [cancelled.id])
    await expect(pay(cancelled.id, 1000)).rejects.toThrow(/invoice is cancelled/)
    // Moving a payment onto one is refused the same way, with check_violation.
    const first = await makeInvoice(3000)
    await pay(first.id, 700)
    const loose = await one<{ id: string }>(`select id from received_payments where invoice_id = $1`, [first.id])
    const err = await q(`update received_payments set invoice_id = $1 where id = $2`, [cancelled.id, loose.id]).catch((e: { code?: string }) => e)
    expect((err as { code?: string }).code).toBe('23514')
    // A sent invoice takes it, and an edit of a payment that stays put is never blocked.
    const sent = await makeInvoice(3000)
    await q(`update received_payments set invoice_id = $1 where id = $2`, [sent.id, loose.id])
    expect(await statusOf(sent.id)).toBe('partial')
    await q(`update invoices set status = 'cancelled' where id = $1`, [sent.id])
    await q(`update received_payments set reference = 'UTR 1' where id = $1`, [loose.id])
  })

  it('prunes old usage events but keeps each person and studio last seen', async () => {
    const ins = (user: string | null, days: number, module = 'other') =>
      q(`insert into usage_events (company_id, user_id, session_id, module, occurred_at) values ($1, $2, 's', $3, now() - make_interval(days => $4))`, [COMPANY, user, module, days])
    await ins(OWNER, 200)
    await ins(OWNER, 120)
    await ins(RAVI, 300)
    await ins(null, 150, 'flow')
    await ins(null, 400, 'flow')
    await ins(OWNER, 5)
    const gone = await one<{ n: number }>(`select prune_usage_events() as n`)
    expect(gone.n).toBe(3)
    const left = await q<{ user_id: string | null; days: number }>(
      `select user_id, extract(day from now() - occurred_at)::int as days from usage_events order by occurred_at`)
    expect(left).toEqual([
      { user_id: RAVI, days: 300 }, // Ravi's only row: his last seen
      { user_id: null, days: 150 }, // a flow row, kept for a year
      { user_id: OWNER, days: 5 },
    ])
  })

  it("defaults the date columns to India's today", async () => {
    const r = await one<{ d: string }>(`select column_default as d from information_schema.columns where table_name = 'received_payments' and column_name = 'paid_on'`)
    expect(r.d).toMatch(/india_today\(\)/)
    const t = await one<{ ok: boolean }>(`select india_today() = (now() at time zone 'Asia/Kolkata')::date as ok`)
    expect(t.ok).toBe(true)
  })
})
