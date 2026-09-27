import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Onboarding emails (0194): a new studio owner gets one nudge on day 1, 3 and
 * 7 while setup is unfinished, naming the next step; finishing, skipping or
 * stopping ends it, and nothing is ever sent twice.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'd0000000-0000-4000-8000-000000000001'
const MEMBER = 'd0000000-0000-4000-8000-000000000002'
const COMPANY = 'd0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'd0000000-0000-4000-8000-0000000000c1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows

type Due = { user_id: string; kind: string; step: number; email: string; name: string }
const dueAt = (days: number) => q<Due>(`select * from onboarding_email_due(now() + interval '${days} days')`)
const mark = async (kind: string) =>
  (await q<{ ok: boolean }>(`select onboarding_email_mark('${OWNER}', '${kind}') as ok`))[0]!.ok

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
    insert into auth.users (id, email) values ('${OWNER}', 'asha@studio.test'), ('${MEMBER}', 'meera@studio.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha Rao', 'asha@studio.test');
  `)
})

beforeEach(async () => {
  await db.exec(`
    delete from onboarding_emails;
    delete from projects; delete from clients;
    delete from users where user_id = '${MEMBER}';
    update auth.users set email_verified = true, email_verified_at = now() where id = '${OWNER}';
    update companies set setup_done_at = null, setup_skipped_at = null, onboarding_emails_off = false,
                         created_at = now()
     where id = '${COMPANY}';
  `)
})

describe('who is due, and for which step', () => {
  it('nobody on day 0; the owner on day 1 with step 1', async () => {
    expect(await dueAt(0)).toEqual([])
    expect(await dueAt(1.1)).toMatchObject([{ user_id: OWNER, kind: 'day1', step: 1, name: 'Asha Rao' }])
  })

  it('names the next step as setup moves on', async () => {
    await db.exec(`insert into users (user_id, company_id, role, name, email, status)
                   values ('${MEMBER}', '${COMPANY}', 'employee', 'Meera', 'meera@studio.test', 'active')`)
    expect((await dueAt(3.1))[0]).toMatchObject({ kind: 'day3', step: 2 })
    await db.exec(`insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma')`)
    expect((await dueAt(7.1))[0]).toMatchObject({ kind: 'day7', step: 3 })
  })

  it('sends only the latest nudge after a gap, never a backlog', async () => {
    const rows = await dueAt(8)
    expect(rows.map((r) => r.kind)).toEqual(['day7'])
  })

  it('an unverified owner gets nothing', async () => {
    await db.exec(`update auth.users set email_verified = false where id = '${OWNER}'`)
    expect(await dueAt(1.1)).toEqual([])
  })
})

describe('what stops it', () => {
  it('finishing setup', async () => {
    await db.exec(`insert into users (user_id, company_id, role, name, email, status)
                   values ('${MEMBER}', '${COMPANY}', 'employee', 'Meera', 'meera@studio.test', 'active')`)
    await db.exec(`insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma')`)
    await db.exec(`insert into projects (company_id, client_id, name) values ('${COMPANY}', '${CLIENT}', 'Sharma Wedding')`)
    expect(await dueAt(3.1)).toEqual([])
  })

  it('skipping setup, or marking it done', async () => {
    await db.exec(`update companies set setup_skipped_at = now() where id = '${COMPANY}'`)
    expect(await dueAt(1.1)).toEqual([])
  })

  it('the stop link', async () => {
    expect((await q<{ ok: boolean }>(`select onboarding_emails_stop('${COMPANY}') as ok`))[0]!.ok).toBe(true)
    expect(await dueAt(1.1)).toEqual([])
    expect(await q(`select * from onboarding_welcome_for('${OWNER}')`)).toEqual([])
  })

  it('studios older than ten days are left alone', async () => {
    await db.exec(`update companies set created_at = now() - interval '11 days' where id = '${COMPANY}'`)
    await db.exec(`update auth.users set email_verified_at = now() - interval '11 days' where id = '${OWNER}'`)
    expect(await dueAt(0)).toEqual([])
  })
})

describe('once only', () => {
  it('a kind is marked once; a marked nudge is no longer due', async () => {
    expect(await mark('day1')).toBe(true)
    expect(await mark('day1')).toBe(false)
    expect(await dueAt(1.1)).toEqual([])
    expect((await dueAt(3.1))[0]).toMatchObject({ kind: 'day3' })
  })

  it('the welcome goes to the owner only', async () => {
    expect(await q(`select email from onboarding_welcome_for('${OWNER}')`)).toEqual([{ email: 'asha@studio.test' }])
    expect(await q(`select * from onboarding_welcome_for('${MEMBER}')`)).toEqual([])
  })
})

describe('who may call it', () => {
  it('a signed-in user cannot read the sent-log or the due list', async () => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${OWNER}';`)
    try {
      await expect(db.query(`select * from onboarding_emails`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select * from onboarding_email_due()`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select onboarding_emails_stop('${COMPANY}')`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role;`)
    }
  })
})
