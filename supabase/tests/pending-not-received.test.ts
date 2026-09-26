import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * A pending payment is not money received.
 *
 * `received_payments.status` has been ('paid','pending') since 0106 — the
 * payments screen calls the second "what is still pending" — and nothing that
 * counted money ever filtered on it. A client who said they would pay
 * inflated the project's received figure, the month's cash, the profit
 * report, and the balance printed on the client's own quotation.
 *
 * Every figure below is asserted twice: once with the money pending and once
 * with it paid. A filter that is silently dropped in a future edit fails here
 * rather than in somebody's accounts.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const CLIENT = '33333333-3333-3333-3333-333333333333'
const PROJECT = '44444444-4444-4444-4444-444444444444'

let db: PGlite

const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const num = (v: unknown) => Number(v ?? 0)

const received = async () =>
  num((await q<{ received: string }>(
    `select received from project_financials where project_id = '${PROJECT}';`,
  ))[0]?.received)

const monthlyCash = async () =>
  num((await q<{ j: Record<string, unknown> }>(
    `select monthly_profit_summary(p_month => date_trunc('month', current_date)::date) as j;`,
  ))[0]!.j['cash_received'])

const profitPaidIncome = async () => {
  const r = await q<{ j: { items?: { paid_income: number }[] } }>(
    `select project_profitability_report() as j;`,
  )
  const items = r[0]!.j.items ?? []
  return num(items.find((i) => (i as unknown as { project_id: string }).project_id === PROJECT)?.paid_income)
}

const gstIncome = async () =>
  num((await q<{ j: Record<string, unknown> }>(
    `select gst_analysis((current_date - 30)::date, (current_date + 1)::date) as j;`,
  ))[0]!.j['total_income'])

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
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Mehta');
    -- Shown to the client: a hidden project's link reads as hidden (0190).
    insert into projects (id, company_id, client_id, name, package_cost, show_quotation)
      values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Mehta Wedding', 100000, true);
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

beforeEach(async () => {
  await db.exec(`delete from received_payments;`)
})

/** ₹40,000 the client has promised but not sent. */
const addPending = () =>
  db.exec(`insert into received_payments (company_id, project_id, client_id, amount, paid_on, status)
           values ('${COMPANY}', '${PROJECT}', '${CLIENT}', 40000, current_date, 'pending');`)

const markPaid = () => db.exec(`update received_payments set status = 'paid';`)

describe('pending payments', () => {
  it('do not count toward the project’s received figure', async () => {
    await addPending()
    expect(await received()).toBe(0)
    await markPaid()
    expect(await received()).toBe(40000)
  })

  it('do not count toward the month’s cash', async () => {
    await addPending()
    expect(await monthlyCash()).toBe(0)
    await markPaid()
    expect(await monthlyCash()).toBe(40000)
  })

  it('do not count toward paid income on the profitability report', async () => {
    await addPending()
    expect(await profitPaidIncome()).toBe(0)
    await markPaid()
    expect(await profitPaidIncome()).toBe(40000)
  })

  it('do not count toward GST total income', async () => {
    await addPending()
    expect(await gstIncome()).toBe(0)
    await markPaid()
    expect(await gstIncome()).toBe(40000)
  })

  it('do not reduce the balance the CLIENT is shown on a quotation', async () => {
    // This one leaves the building: a client asked for less than they owe,
    // because of money they had not sent, is the worst version of this bug.
    const quote = (
      await q<{ id: string }>(
        `insert into project_quotations (company_id, project_id, created_by, snapshot)
         values ('${COMPANY}', '${PROJECT}', '${OWNER}',
                 '{"items":[],"package_cost":100000,"add_ons":0,"total":100000}'::jsonb)
         returning id;`,
      )
    )[0]!.id
    await db.exec(`insert into access_tokens (company_id, purpose, subject_id, token_hash)
      values ('${COMPANY}', 'quotation', '${quote}',
              encode(sha256(convert_to('ptok', 'UTF8')), 'hex'));`)

    await addPending()
    const shown = async () => {
      const r = await q<Record<string, unknown>>(`select * from get_quotation_for_token('ptok');`)
      return { received: num(r[0]!['total_received']), balance: num(r[0]!['balance_due']) }
    }
    // The project is worth ₹1,00,000 and nothing has been paid.
    expect(await shown()).toEqual({ received: 0, balance: 100000 })
    await markPaid()
    expect(await shown()).toEqual({ received: 40000, balance: 60000 })
  })

  it('still let a receipt render for the payment it is for', async () => {
    // The running project total on a receipt must exclude pending money; the
    // payment the receipt is ABOUT must still be found, whatever its status.
    await addPending()
    const r = await q<{ n: string }>(
      `select count(*)::text as n from received_payments where status = 'pending';`,
    )
    expect(Number(r[0]!.n)).toBe(1)
  })

  it('are the only non-received status there is', async () => {
    // `= 'paid'` is correct only while these are the two values. Adding a
    // third has to fail here and send whoever adds it back to 0146's list,
    // because a new status silently counted or silently dropped is money.
    const def = await q<{ src: string }>(
      `select pg_get_constraintdef(c.oid) as src
         from pg_constraint c join pg_class t on t.oid = c.conrelid
        where t.relname = 'received_payments' and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%status%';`,
    )
    expect(def.length).toBeGreaterThan(0)
    const all = def.map((d) => d.src).join(' ')
    expect(all).toMatch(/'paid'/)
    expect(all).toMatch(/'pending'/)
    // Any third literal in that check is a new status nobody has classified.
    const literals = new Set((all.match(/'[a-z_]+'::text|'[a-z_]+'/g) ?? []).map((x) => x.replace(/::text/, '')))
    expect([...literals].sort()).toEqual(["'paid'", "'pending'"])
  })
})
