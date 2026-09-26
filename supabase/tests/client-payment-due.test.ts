import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Payment reminders to clients (0188): the hourly cron emails a client 3 days
 * before an invoice is due, on the day, and 3 and 10 days after, once each,
 * after 10 am India time, while money is still due and the studio has the
 * reminder switched on. By hand from the invoice: charged and capped like any
 * email, the switch does not apply, and a double click sends once.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e0000000-0000-4000-8000-000000000001'
const OWNER_B = 'e0000000-0000-4000-8000-000000000002'
const STUDIO = 'e0000000-0000-4000-8000-0000000000aa'
const STUDIO_B = 'e0000000-0000-4000-8000-0000000000bb'
const CLIENT = 'e0000000-0000-4000-8000-0000000000c1'
const CLIENT_NO_MAIL = 'e0000000-0000-4000-8000-0000000000c2'
const CLIENT_B = 'e0000000-0000-4000-8000-0000000000c3'
const INV = 'e0000000-0000-4000-8000-0000000000d1'
const INV_PAID = 'e0000000-0000-4000-8000-0000000000d2'
const INV_DRAFT = 'e0000000-0000-4000-8000-0000000000d3'
const INV_NO_MAIL = 'e0000000-0000-4000-8000-0000000000d4'
const INV_B = 'e0000000-0000-4000-8000-0000000000d5'
const INV_CANCELLED = 'e0000000-0000-4000-8000-0000000000d6'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

async function asUser<T>(uid: string, sql: string) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`)
  try {
    return (await db.query<T>(sql)).rows
  } finally {
    await db.exec(`reset role; set request.jwt.claim.sub = '';`)
  }
}
async function fails(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (e) {
    return (e as Error).message
  }
  return null
}

/** Run the cron at this India wall-clock time. */
const runAt = (local: string) =>
  one<{ s: { due: number; queued: number } }>(`select run_client_payment_due_cron(false, '${local}+05:30'::timestamptz) as s`)
const reminders = (invoice: string) =>
  q<{ dedupe_key: string; status: string; subject: string; body: string; to_address: string }>(`
    select dedupe_key, status, subject, body, to_address from message_outbox
     where entity_type = 'invoice' and entity_id = '${invoice}' order by created_at, dedupe_key`)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'owner@lens.test'), ('${OWNER_B}', 'b@other.test');
    insert into companies (id, name, owner_user_id, invoice_phone, invoice_email) values
      ('${STUDIO}', 'Lens Studio', '${OWNER}', '98765 43210', 'accounts@lens.test'),
      ('${STUDIO_B}', 'Other Studio', '${OWNER_B}', null, null);
    insert into users (user_id, company_id, role, name, email, phone) values
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Owner', 'owner@lens.test', '9000000001'),
      ('${OWNER_B}', '${STUDIO_B}', 'super_admin', 'Other', 'b@other.test', '9000000002');
    insert into clients (id, company_id, name, email) values
      ('${CLIENT}', '${STUDIO}', 'Rahul Mehta', 'Rahul@Example.com'),
      ('${CLIENT_NO_MAIL}', '${STUDIO}', 'No Mail', null),
      ('${CLIENT_B}', '${STUDIO_B}', 'Anita', 'anita@example.com');
    insert into invoices (id, company_id, client_id, invoice_number, invoice_date, due_date, status, total, amount_paid, balance_due) values
      ('${INV}', '${STUDIO}', '${CLIENT}', 'INV-012', '2026-09-20', '2026-10-10', 'partial', 20000, 7500, 12500),
      ('${INV_PAID}', '${STUDIO}', '${CLIENT}', 'INV-013', '2026-09-20', '2026-10-10', 'paid', 5000, 5000, 0),
      ('${INV_DRAFT}', '${STUDIO}', '${CLIENT}', 'INV-014', '2026-09-20', '2026-10-10', 'draft', 5000, 0, 5000),
      ('${INV_NO_MAIL}', '${STUDIO}', '${CLIENT_NO_MAIL}', 'INV-015', '2026-09-20', '2026-10-10', 'sent', 5000, 0, 5000),
      ('${INV_B}', '${STUDIO_B}', '${CLIENT_B}', 'B-001', '2026-09-20', '2026-10-10', 'sent', 1500000.5, 0, 1500000.5),
      ('${INV_CANCELLED}', '${STUDIO}', '${CLIENT}', 'INV-016', '2026-09-20', '2026-10-10', 'cancelled', 5000, 0, 0);
  `)
  // Studio A switches automatic reminders on; studio B leaves them off.
  await asUser(OWNER, `select set_messaging_setting('client_payment_due', false, true)`)
})

describe('the daily run', () => {
  it('does nothing before 10 am India time', async () => {
    const s = await runAt('2026-10-07 09:30')
    expect(s.s.due).toBe(0)
    expect(await reminders(INV)).toHaveLength(0)
  })

  it('emails 3 days before the due date, once however often the hourly job runs', async () => {
    const s = await runAt('2026-10-07 10:05')
    expect(s.s).toMatchObject({ due: 1, queued: 1 })
    expect((await runAt('2026-10-07 11:05')).s.due).toBe(0)
    expect((await runAt('2026-10-07 18:05')).s.due).toBe(0)
    const r = await reminders(INV)
    expect(r).toHaveLength(1)
    expect(r[0]!.dedupe_key).toBe(`pay_due:${INV}:before_3:2026-10-10`)
    expect(r[0]!.status).toBe('queued')
    expect(r[0]!.to_address).toBe('rahul@example.com')
  })

  it('writes a warm plain email with the amount in Indian style and the studio contact, no link', async () => {
    const [r] = await reminders(INV)
    expect(r!.subject).toBe('Payment reminder: Invoice INV-012 from Lens Studio')
    expect(r!.body).toContain('Dear Rahul Mehta,')
    expect(r!.body).toContain('Amount due: ₹12,500')
    expect(r!.body).toContain('is due on 10 Oct 2026')
    expect(r!.body).toContain('call us on 98765 43210 or write to accounts@lens.test')
    expect(r!.body).not.toMatch(/https?:|token/)
    const link = await one<{ link: string | null }>(`select link from message_outbox where entity_id = '${INV}'`)
    expect(link.link).toBeNull()
  })

  it('is quiet on the days between, then fires on the day, 3 days after and 10 days after', async () => {
    for (const d of ['2026-10-08', '2026-10-09', '2026-10-11', '2026-10-12', '2026-10-15', '2026-10-21']) {
      expect((await runAt(`${d} 12:00`)).s.due, d).toBe(0)
    }
    expect((await runAt('2026-10-10 12:00')).s.due).toBe(1)
    expect((await runAt('2026-10-13 12:00')).s.due).toBe(1)
    expect((await runAt('2026-10-20 12:00')).s.due).toBe(1)
    const keys = (await reminders(INV)).map((r) => r.dedupe_key.split(':')[2])
    expect(keys.sort()).toEqual(['after_10', 'after_3', 'before_3', 'due'])
    const late = (await reminders(INV)).find((r) => r.dedupe_key.includes(':after_3:'))!
    expect(late.body).toContain('was due on 10 Oct 2026')
    expect(late.body).toContain('If you have already paid')
  })

  it('never chases a paid, draft or cancelled invoice, or a client with no email', async () => {
    for (const id of [INV_PAID, INV_DRAFT, INV_CANCELLED, INV_NO_MAIL]) {
      expect(await reminders(id), id).toHaveLength(0)
    }
  })

  it('sends nothing for a studio that has not switched it on', async () => {
    expect(await reminders(INV_B)).toHaveLength(0)
  })

  it('a dry run counts without writing', async () => {
    await q(`update invoices set due_date = '2026-10-25' where id = '${INV_NO_MAIL}'`)
    await q(`update clients set email = 'nomail@example.com' where id = '${CLIENT_NO_MAIL}'`)
    const s = await one<{ s: { due: number; queued: number } }>(
      `select run_client_payment_due_cron(true, '2026-10-22 12:00+05:30'::timestamptz) as s`)
    expect(s.s).toMatchObject({ due: 1, queued: 0 })
    expect(await reminders(INV_NO_MAIL)).toHaveLength(0)
  })

  it('a moved due date starts the stages again', async () => {
    await q(`update invoices set due_date = '2026-10-30' where id = '${INV}'`)
    expect((await runAt('2026-10-27 12:00')).s.due).toBeGreaterThanOrEqual(1)
    expect((await reminders(INV)).some((r) => r.dedupe_key === `pay_due:${INV}:before_3:2026-10-30`)).toBe(true)
  })

  it('only the service role runs it', async () => {
    expect(await fails(() => asUser(OWNER, `select run_client_payment_due_cron(true)`))).toMatch(/permission denied/)
  })
})

describe('by hand from the invoice', () => {
  it('sends even with the switch off, and a double click sends once', async () => {
    const [a] = await asUser<{ id: string; status: string; repeated: boolean; free_allowance: boolean }>(OWNER_B, `select * from send_client_payment_reminder('${INV_B}')`)
    expect(a).toMatchObject({ status: 'queued', repeated: false, free_allowance: true })
    const [b] = await asUser<{ id: string; repeated: boolean }>(OWNER_B, `select * from send_client_payment_reminder('${INV_B}')`)
    expect(b).toMatchObject({ id: a!.id, repeated: true })
    const [r] = await reminders(INV_B)
    expect(r!.body).toContain('₹15,00,000.50')
    // No phone or email on the studio: the owner's details are used.
    expect(r!.body).toContain('call us on 9000000002 or write to b@other.test')
    const [quote] = await asUser<{ last_sent_at: string | null; reminders_sent: number; auto_on: boolean; free_used: number }>(OWNER_B,
      `select * from client_payment_reminder_quote('${INV_B}')`)
    expect(quote!.last_sent_at).not.toBeNull()
    expect(quote).toMatchObject({ reminders_sent: 1, auto_on: false, free_used: 1 })
  })

  it("cannot touch another studio's invoice", async () => {
    expect(await fails(() => asUser(OWNER, `select * from send_client_payment_reminder('${INV_B}')`))).toMatch(/not found/)
    expect(await fails(() => asUser(OWNER, `select * from client_payment_reminder_quote('${INV_B}')`))).toMatch(/not found/)
  })

  it('refuses when nothing is due, and says so when the client has no email', async () => {
    expect(await fails(() => asUser(OWNER, `select * from send_client_payment_reminder('${INV_PAID}')`))).toMatch(/nothing is due/)
    expect(await fails(() => asUser(OWNER, `select * from send_client_payment_reminder('${INV_DRAFT}')`))).toMatch(/draft/)
    await q(`update clients set email = null where id = '${CLIENT_NO_MAIL}'`)
    const [r] = await asUser<{ id: string | null; status: string }>(OWNER, `select * from send_client_payment_reminder('${INV_NO_MAIL}')`)
    expect(r).toMatchObject({ id: null, status: 'no_email' })
  })

  it('is charged from the wallet after the free emails, and waits for a recharge without balance', async () => {
    await q(`insert into messaging_prices (channel, category, meta_cost_paise, markup_pct, markup_fixed_paise, free_monthly)
             values ('email', 'email', 0, 0, 20, 1)`)
    // Studio B used its one free email above. No balance: skipped, nothing charged.
    await q(`update message_outbox set created_at = now() - interval '11 minutes' where entity_id = '${INV_B}'`)
    const [a] = await asUser<{ status: string; cost_paise: string }>(OWNER_B, `select * from send_client_payment_reminder('${INV_B}')`)
    expect(a!.status).toBe('skipped_no_balance')
    await q(`select credit_wallet('${STUDIO_B}', 100, 'adjustment', null, 'test')`)
    const [b] = await asUser<{ status: string; cost_paise: string; repeated: boolean }>(OWNER_B, `select * from send_client_payment_reminder('${INV_B}')`)
    expect(b).toMatchObject({ status: 'queued', repeated: false })
    expect(Number(b!.cost_paise)).toBe(20)
    expect(Number((await one<{ b: string }>(`select balance_paise::text as b from wallets where company_id = '${STUDIO_B}'`)).b)).toBe(80)
  })
})
