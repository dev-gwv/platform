import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0258: the Monday email. The owner alone, Monday from 8 am IST, once a
 * week, only with something to say, and never once they switch it off.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'f5800000-0000-4000-8000-000000000001'
const ADMIN = 'f5800000-0000-4000-8000-000000000002'
const OTHER = 'f5800000-0000-4000-8000-000000000003'
const COMPANY = 'f5800000-0000-4000-8000-0000000000aa'
const COMPANY_B = 'f5800000-0000-4000-8000-0000000000bb'
const CLIENT = 'f5800000-0000-4000-8000-0000000000c1'
const PROJECT = 'f5800000-0000-4000-8000-0000000000d1'

// Monday 5 Oct 2026 at 08:30 and 07:30 IST, and Tuesday at 08:30 IST, as UTC.
const MON_0830 = `'2026-10-05T03:00:00Z'`
const MON_0730 = `'2026-10-05T02:00:00Z'`
const TUE_0830 = `'2026-10-06T03:00:00Z'`

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows

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
    insert into auth.users (id, email) values
      ('${OWNER}', 'asha@week.test'), ('${ADMIN}', 'dev@week.test'), ('${OTHER}', 'kiran@week.test');
    update auth.users set email_verified = true;
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Asha Studio', '${OWNER}'), ('${COMPANY_B}', 'Quiet Films', '${OTHER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'asha@week.test', 'active'),
      ('${ADMIN}', '${COMPANY}', 'admin', 'Dev', 'dev@week.test', 'active'),
      ('${OTHER}', '${COMPANY_B}', 'super_admin', 'Kiran', 'kiran@week.test', 'active');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Mehta Family');
    insert into projects (id, company_id, client_id, name) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Mehta Wedding');
    insert into invoices (company_id, client_id, invoice_number, status, total, balance_due, due_date) values
      ('${COMPANY}', '${CLIENT}', 'W-1', 'sent', 40000, 40000, '2026-09-30'),
      ('${COMPANY}', '${CLIENT}', 'W-2', 'sent', 25000, 25000, '2026-10-08');
    insert into shoots (company_id, project_id, name, shoot_date) values
      ('${COMPANY}', '${PROJECT}', 'Haldi', '2026-10-07'), ('${COMPANY}', '${PROJECT}', 'Wedding', '2026-10-08');
  `)
})

beforeEach(async () => {
  await db.exec(`delete from weekly_emails; update users set weekly_email_off = false;`)
})

interface Row {
  user_id: string
  overdue_amount: string
  overdue_count: number
  due_week_amount: string
  shoots_week: number
  shoots_unstaffed: number
}
const due = (at: string) =>
  q<Row>(`select user_id, overdue_amount::text, overdue_count, due_week_amount::text, shoots_week, shoots_unstaffed from weekly_email_due(${at})`)

describe('the Monday email', () => {
  it('goes to the owner alone, Monday from 8 am, with the week in numbers', async () => {
    const rows = await due(MON_0830)
    expect(rows.map((r) => r.user_id)).toEqual([OWNER])
    expect(rows[0]).toMatchObject({ overdue_amount: '40000.00', overdue_count: 1, due_week_amount: '25000.00', shoots_week: 2, shoots_unstaffed: 2 })
  })

  it('waits for 8 am and for Monday; a studio with nothing to say gets nothing', async () => {
    expect(await due(MON_0730)).toEqual([])
    expect(await due(TUE_0830)).toEqual([])
    expect((await due(MON_0830)).some((r) => r.user_id === OTHER)).toBe(false)
  })

  it('is sent once a week: the second mark is refused', async () => {
    const [first] = await q<{ ok: boolean }>(`select weekly_email_mark('${OWNER}', '${COMPANY}', '2026-10-05') as ok`)
    const [second] = await q<{ ok: boolean }>(`select weekly_email_mark('${OWNER}', '${COMPANY}', '2026-10-05') as ok`)
    expect([first!.ok, second!.ok]).toEqual([true, false])
    expect(await due(MON_0830)).toEqual([])
  })

  it('stops when the owner switches it off, and comes back when switched on', async () => {
    await q(`select weekly_email_set('${OWNER}', true)`)
    expect(await due(MON_0830)).toEqual([])
    await q(`select weekly_email_set('${OWNER}', false)`)
    expect((await due(MON_0830)).length).toBe(1)
  })

  it('a signed-in user cannot read the list or the sent-log', async () => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${OWNER}';`)
    try {
      await expect(db.query(`select * from weekly_email_due()`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select * from weekly_emails`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role;`)
    }
  })
})
