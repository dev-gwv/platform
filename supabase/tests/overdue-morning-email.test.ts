import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0198: the overdue-invoice alert runs on its own for every studio, and owners
 * and admins get one morning email a day when there is something to say.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'f0000000-0000-4000-8000-000000000001'
const ADMIN = 'f0000000-0000-4000-8000-000000000002'
const STAFF = 'f0000000-0000-4000-8000-000000000003'
const OTHER = 'f0000000-0000-4000-8000-000000000004'
const COMPANY = 'f0000000-0000-4000-8000-0000000000aa'
const COMPANY_B = 'f0000000-0000-4000-8000-0000000000bb'
const CLIENT = 'f0000000-0000-4000-8000-0000000000c1'

// 2026-10-05 10:30 IST and 07:30 IST, as UTC instants.
const TEN_THIRTY = `'2026-10-05T05:00:00Z'`
const SEVEN_THIRTY = `'2026-10-05T02:00:00Z'`
const EIGHT_THIRTY = `'2026-10-05T03:00:00Z'`

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows

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
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'asha@studio.test'), ('${ADMIN}', 'dev@studio.test'),
      ('${STAFF}', 'ravi@studio.test'), ('${OTHER}', 'kiran@other.test');
    update auth.users set email_verified = true;
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Asha Studio', '${OWNER}'), ('${COMPANY_B}', 'Kiran Films', '${OTHER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'asha@studio.test', 'active'),
      ('${ADMIN}', '${COMPANY}', 'admin', 'Dev', 'dev@studio.test', 'active'),
      ('${STAFF}', '${COMPANY}', 'employee', 'Ravi', 'ravi@studio.test', 'active'),
      ('${OTHER}', '${COMPANY_B}', 'super_admin', 'Kiran', 'kiran@other.test', 'active');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma Family');
  `)
})

beforeEach(async () => {
  await db.exec(`
    delete from notifications; delete from morning_emails; delete from invoices;
    update users set morning_email_off = false;
  `)
})

const invoice = (no: string, status: string, balance: number, due: string | null) =>
  db.exec(`insert into invoices (company_id, client_id, invoice_number, status, total, balance_due, due_date)
            values ('${COMPANY}', '${CLIENT}', '${no}', '${status}', ${balance}, ${balance}, ${due ? `'${due}'` : 'null'})`)

const alerts = () =>
  q<{ recipient_uid: string; body: string }>(`select recipient_uid, body from notifications where type = 'invoice.overdue' order by recipient_uid`)

describe('overdue invoices, on the cron', () => {
  it('alerts the owner and admins once, with who and how much', async () => {
    await invoice('INV-1', 'sent', 45000, '2026-10-01')
    const [{ s }] = (await q<{ s: { due: number; created: number } }>(
      `select run_invoice_overdue_cron(false, ${TEN_THIRTY}) as s`,
    )) as [{ s: { due: number; created: number } }]
    expect(s.created).toBe(2)
    const rows = await alerts()
    expect(rows.map((r) => r.recipient_uid)).toEqual([OWNER, ADMIN].sort())
    expect(rows[0]!.body).toContain('Sharma Family')
    expect(rows[0]!.body).toContain('45,000')
    // The next hour's tick adds nothing.
    await q(`select run_invoice_overdue_cron(false, ${TEN_THIRTY}::timestamptz + interval '1 hour')`)
    expect(await alerts()).toHaveLength(2)
  })

  it('leaves drafts, paid, cancelled and not-yet-due invoices alone', async () => {
    await invoice('D', 'draft', 1000, '2026-10-01')
    await invoice('P', 'paid', 0, '2026-10-01')
    await invoice('C', 'cancelled', 1000, '2026-10-01')
    await invoice('F', 'sent', 1000, '2026-10-09')
    await invoice('N', 'sent', 1000, null)
    await q(`select run_invoice_overdue_cron(false, ${TEN_THIRTY})`)
    expect(await alerts()).toEqual([])
  })

  it('waits until 10 am, and a dry run writes nothing', async () => {
    await invoice('INV-2', 'partial', 2000, '2026-10-01')
    await q(`select run_invoice_overdue_cron(false, ${SEVEN_THIRTY})`)
    expect(await alerts()).toEqual([])
    const [{ s }] = (await q<{ s: { due: number } }>(`select run_invoice_overdue_cron(true, ${TEN_THIRTY}) as s`)) as [
      { s: { due: number } },
    ]
    expect(s.due).toBe(2)
    expect(await alerts()).toEqual([])
  })
})

type Due = { user_id: string; company_id: string; overdue_count: number; overdue_amount: string; shoots: unknown[] }
const due = (at: string) => q<Due>(`select * from morning_email_due(${at}) order by user_id`)

describe('the morning email', () => {
  it('goes to owners and admins, not staff, from 8 am, only with something to say', async () => {
    expect(await due(EIGHT_THIRTY)).toEqual([])
    await invoice('INV-3', 'sent', 12000, '2026-10-01')
    expect(await due(SEVEN_THIRTY)).toEqual([])
    const rows = await due(EIGHT_THIRTY)
    expect(rows.map((r) => r.user_id)).toEqual([OWNER, ADMIN].sort())
    expect(rows[0]).toMatchObject({ company_id: COMPANY, overdue_count: 1 })
    expect(Number(rows[0]!.overdue_amount)).toBe(12000)
  })

  it('is sent once a day', async () => {
    await invoice('INV-4', 'sent', 500, '2026-10-01')
    expect((await q<{ ok: boolean }>(`select morning_email_mark('${OWNER}', '${COMPANY}', '2026-10-05') as ok`))[0]!.ok).toBe(true)
    expect((await q<{ ok: boolean }>(`select morning_email_mark('${OWNER}', '${COMPANY}', '2026-10-05') as ok`))[0]!.ok).toBe(false)
    expect((await due(EIGHT_THIRTY)).map((r) => r.user_id)).toEqual([ADMIN])
  })

  it('stops when asked, and comes back when switched on', async () => {
    await invoice('INV-5', 'sent', 500, '2026-10-01')
    await q(`select morning_email_set('${ADMIN}', true)`)
    expect((await due(EIGHT_THIRTY)).map((r) => r.user_id)).toEqual([OWNER])
    await q(`select morning_email_set('${ADMIN}', false)`)
    expect(await due(EIGHT_THIRTY)).toHaveLength(2)
  })

  it('lists only that studio’s shoots for today', async () => {
    await db.exec(`
      insert into projects (id, company_id, client_id, name) values
        ('f0000000-0000-4000-8000-0000000000f1', '${COMPANY}', '${CLIENT}', 'Sharma Wedding');
      insert into shoots (company_id, project_id, name, shoot_date, start_at, location) values
        ('${COMPANY}', 'f0000000-0000-4000-8000-0000000000f1', 'Haldi', '2026-10-05', '2026-10-05T05:30:00Z', 'Jaipur');
    `)
    try {
      const rows = await due(EIGHT_THIRTY)
      expect(rows[0]!.shoots).toEqual([{ name: 'Haldi', time: '11:00 am', place: 'Jaipur' }])
      expect(rows.some((r) => r.company_id === COMPANY_B)).toBe(false)
    } finally {
      await db.exec(`delete from shoots; delete from projects;`)
    }
  })

  it('a signed-in user cannot read the list or the sent-log', async () => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${OWNER}';`)
    try {
      await expect(db.query(`select * from morning_email_due()`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select * from morning_emails`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select run_invoice_overdue_cron()`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role;`)
    }
  })
})
