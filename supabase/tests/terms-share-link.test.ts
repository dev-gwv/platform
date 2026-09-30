import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Terms share links (0215): the studio can hand out the same live link
 * again, the email log keeps what the email service answered, and a client
 * whose link does not open is told why.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'd0000000-0000-4000-8000-000000000001'
const OTHER_OWNER = 'd0000000-0000-4000-8000-000000000002'
const COMPANY = 'd0000000-0000-4000-8000-0000000000aa'
const OTHER = 'd0000000-0000-4000-8000-0000000000ab'
const CLIENT = 'd0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'd0000000-0000-4000-8000-0000000000b1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${OTHER_OWNER}', 'x@t.test');
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Mulberry', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@t.test');
    insert into clients (id, company_id, name, email) values ('${CLIENT}', '${COMPANY}', 'Pulkit', 'pulkit@example.com');
    insert into projects (id, company_id, client_id, name, package_cost) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Pulkit Wedding', 150000);
  `)
})

beforeEach(async () => {
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
  await db.exec(`delete from project_terms_documents; delete from access_tokens where purpose = 'terms_ack';`)
})

const issue = (body = 'Clause one') =>
  one<{ document_id: string; token: string }>(`select * from issue_client_terms('${PROJECT}', '${body}', 'Terms', null, 150000, null, 336)`)

const shareToken = (doc: string) =>
  one<{ t: string | null }>(`select terms_live_share_token('${doc}') as t`).then((r) => r.t)

const listed = () =>
  q<{ share_token: string | null; last_email_status: string | null; last_email_error: string | null; emailed_to: string | null }>(
    `select share_token, last_email_status, last_email_error, emailed_to from list_project_terms('${PROJECT}')`,
  )

const state = (raw: string) => one<{ state: string; company_name: string }>(`select * from terms_link_state('${raw}')`)

describe('sharing the same link again', () => {
  it('keeps the link it issued, and gives that same link back', async () => {
    const { document_id, token } = await issue()
    expect(await shareToken(document_id)).toBe(token)
    expect((await listed())[0]!.share_token).toBe(token)
  })

  it('a new link (for an expired one) replaces the kept link', async () => {
    const { document_id, token } = await issue()
    const { t } = await one<{ t: string }>(`select terms_document_new_link('${document_id}') as t`)
    expect(t).not.toBe(token)
    expect(await shareToken(document_id)).toBe(t)
  })

  it('gives nothing once the link is cancelled, agreed or past its date', async () => {
    const a = await issue()
    await db.query(`select cancel_terms_document('${a.document_id}')`)
    expect(await shareToken(a.document_id)).toBeNull()

    const b = await issue('Second')
    await db.query(`select acknowledge_terms('${b.token}', 'Pulkit')`)
    expect(await shareToken(b.document_id)).toBeNull()

    const c = await issue('Third')
    await db.exec(`update access_tokens set expires_at = now() - interval '1 hour' where subject_id = '${c.document_id}'`)
    expect(await shareToken(c.document_id)).toBeNull()
  })

  it('never hands another studio the link', async () => {
    const { document_id } = await issue()
    await db.exec(`set request.jwt.claim.sub = '${OTHER_OWNER}';`)
    expect(await shareToken(document_id)).toBeNull()
  })

  it('keeps the links out of plain reads', async () => {
    await issue()
    await db.exec(`set role authenticated;`)
    await expect(db.query(`select token from terms_share_links`)).rejects.toThrow(/permission denied/)
    await db.exec(`reset role;`)
  })
})

describe('the last email', () => {
  it('lists what the email service answered, failures included', async () => {
    const { document_id } = await issue()
    await db.exec(`insert into project_terms_email_logs (company_id, document_id, to_email, status, error, subject, provider_message_id)
      values ('${COMPANY}', '${document_id}', 'pulkit@example.com', 'failed', 'Resend 403: domain not verified', 'Terms', null)`)
    let [v] = await listed()
    expect(v).toMatchObject({ last_email_status: 'failed', last_email_error: 'Resend 403: domain not verified', emailed_to: null })

    await db.exec(`insert into project_terms_email_logs (company_id, document_id, to_email, status, provider_message_id, created_at)
      values ('${COMPANY}', '${document_id}', 'pulkit@example.com', 'sent', 're_123', now() + interval '1 second')`)
    ;[v] = await listed()
    expect(v).toMatchObject({ last_email_status: 'sent', last_email_error: null, emailed_to: 'pulkit@example.com' })
  })
})

describe('why a link does not open', () => {
  it('says ok, agreed, cancelled, expired or nothing at all', async () => {
    const a = await issue()
    expect(await state(a.token)).toMatchObject({ state: 'ok', company_name: 'Mulberry' })

    await db.query(`select acknowledge_terms('${a.token}', 'Pulkit')`)
    expect((await state(a.token)).state).toBe('agreed')

    const b = await issue('Replaced')
    await issue('Newer')
    expect((await state(b.token)).state).toBe('cancelled')

    const c = await issue('Late')
    await db.exec(`update project_terms_documents set expires_at = now() - interval '1 day' where id = '${c.document_id}'`)
    expect((await state(c.token)).state).toBe('expired')

    expect(await q(`select * from terms_link_state('not-a-real-token')`)).toEqual([])
  })

  it('tells the studio owner who agreed', async () => {
    const a = await issue()
    await db.query(`select acknowledge_terms('${a.token}', 'Pulkit Sharma')`)
    const n = await one<{ owner_email: string; project_name: string; agreed_by: string }>(`select * from terms_agreed_notice('${a.token}')`)
    expect(n).toMatchObject({ owner_email: 'o@s.test', project_name: 'Pulkit Wedding', agreed_by: 'Pulkit Sharma' })
  })
})
