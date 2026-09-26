import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Client terms (0163): one call issues a project's terms and withdraws the
 * older version; a link can be sent again or cancelled, and a cancelled one
 * really stops working; agreeing tells the studio.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'c0000000-0000-4000-8000-000000000001'
const OTHER_OWNER = 'c0000000-0000-4000-8000-000000000002'
const COMPANY = 'c0000000-0000-4000-8000-0000000000aa'
const OTHER = 'c0000000-0000-4000-8000-0000000000ab'
const CLIENT = 'c0000000-0000-4000-8000-0000000000c1'
const OTHER_CLIENT = 'c0000000-0000-4000-8000-0000000000c2'
const PROJECT = 'c0000000-0000-4000-8000-0000000000b1'
const OTHER_PROJECT = 'c0000000-0000-4000-8000-0000000000b2'

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
      ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@t.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma'), ('${OTHER_CLIENT}', '${OTHER}', 'Them');
    insert into projects (id, company_id, client_id, name, package_cost) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000),
      ('${OTHER_PROJECT}', '${OTHER}', '${OTHER_CLIENT}', 'Their wedding', 1);
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

beforeEach(async () => {
  await db.exec(`delete from project_terms_documents; delete from access_tokens where purpose = 'terms_ack'; delete from notifications;`)
})

const issue = async (body = 'Clause one') =>
  one<{ document_id: string; token: string }>(`
    select * from issue_client_terms('${PROJECT}', '${body}', 'Wedding terms',
      '[{"label":"Advance","mode":"percent","value":50,"due_trigger":"On signing"}]'::jsonb,
      200000, 'Governed by Indian law', 336)`)

const doc = (id: string) =>
  one<{ revoked_at: string | null; acknowledged_at: string | null; title: string; expires_at: string | null }>(
    `select revoked_at, acknowledged_at, title, expires_at from project_terms_documents where id = '${id}'`,
  )

const readAsClient = (token: string) => q<{ title: string }>(`select * from get_terms_payload_for_token('${token}')`)
const agree = async (token: string, name = 'Priya Sharma') =>
  (await one<{ ok: boolean }>(`select acknowledge_terms('${token}', '${name}') as ok`)).ok

describe('issuing', () => {
  it('stores every part and gives a working link', async () => {
    const { document_id, token } = await issue()
    expect((await doc(document_id)).title).toBe('Wedding terms')
    expect((await doc(document_id)).expires_at).not.toBeNull()
    const [payload] = await readAsClient(token)
    expect(payload).toMatchObject({ title: 'Wedding terms', legal_note: 'Governed by Indian law' })
  })

  it('withdraws the older unagreed version and its link', async () => {
    const first = await issue('Old')
    const second = await issue('New')
    expect((await doc(first.document_id)).revoked_at).not.toBeNull()
    expect(await readAsClient(first.token)).toEqual([])
    expect(await agree(first.token)).toBe(false)
    expect(await readAsClient(second.token)).toHaveLength(1)
  })

  it('refuses another studio’s project', async () => {
    await expect(db.query(`select * from issue_client_terms('${OTHER_PROJECT}', 'x')`)).rejects.toThrow(/not in this studio/)
  })
})

describe('sending again and cancelling', () => {
  it('a new link replaces the old one for the same document', async () => {
    const { document_id, token } = await issue()
    const { t } = await one<{ t: string }>(`select terms_document_new_link('${document_id}', 48) as t`)
    expect(await readAsClient(token)).toEqual([])
    expect(await readAsClient(t)).toHaveLength(1)
    const [v] = await q<{ link_live: boolean }>(`select link_live from list_project_terms('${PROJECT}')`)
    expect(v!.link_live).toBe(true)
  })

  it('a cancelled link neither opens nor accepts agreement, on either reader', async () => {
    const { document_id, token } = await issue()
    expect((await one<{ ok: boolean }>(`select cancel_terms_document('${document_id}') as ok`)).ok).toBe(true)
    expect(await readAsClient(token)).toEqual([])
    expect((await one<{ b: string | null }>(`select get_terms_for_token('${token}') as b`)).b).toBeNull()
    expect(await agree(token)).toBe(false)
    const [v] = await q<{ link_live: boolean; revoked_at: string | null }>(`select link_live, revoked_at from list_project_terms('${PROJECT}')`)
    expect(v).toMatchObject({ link_live: false })
    expect(v!.revoked_at).not.toBeNull()
  })

  it('cannot send a new link for a cancelled or agreed document', async () => {
    const a = await issue()
    await agree(a.token)
    await expect(db.query(`select terms_document_new_link('${a.document_id}')`)).rejects.toThrow(/already agreed/)
  })
})

describe('agreeing', () => {
  it('records it once, tells the owner, and the client can still re-read it', async () => {
    const { document_id, token } = await issue()
    expect(await agree(token)).toBe(true)
    expect(await agree(token, 'Someone else')).toBe(false)
    expect((await doc(document_id)).acknowledged_at).not.toBeNull()
    const notes = await q<{ recipient_uid: string; title: string; deep_link: string }>(
      `select recipient_uid, title, deep_link from notifications where type = 'terms_agreed'`,
    )
    expect(notes).toEqual([{ recipient_uid: OWNER, title: 'Priya Sharma agreed to the terms', deep_link: `/projects/${PROJECT}?tab=terms` }])
    // Their copy stays readable after agreeing, even once the date has passed.
    await db.exec(`update project_terms_documents set expires_at = now() - interval '1 day' where id = '${document_id}'`)
    await db.exec(`update access_tokens set expires_at = now() - interval '1 day' where subject_id = '${document_id}'`)
    expect(await readAsClient(token)).toHaveLength(1)
  })

  it('an agreed version is not withdrawn by a new one', async () => {
    const first = await issue()
    await agree(first.token)
    await issue('Addendum')
    expect((await doc(first.document_id)).revoked_at).toBeNull()
  })

  it('an expired, unagreed link does not accept agreement', async () => {
    const { document_id, token } = await issue()
    await db.exec(`update access_tokens set expires_at = now() - interval '1 hour' where subject_id = '${document_id}'`)
    expect(await agree(token)).toBe(false)
  })
})

describe('the studio’s view', () => {
  it('reads the payment table and legal note by document id', async () => {
    const { document_id } = await issue()
    const p = await one<{ payment_terms: unknown[]; legal_note: string; total_cost: string }>(
      `select payment_terms, legal_note, total_cost from get_terms_payload_for_document('${document_id}')`,
    )
    expect(p.payment_terms).toHaveLength(1)
    expect(p.legal_note).toBe('Governed by Indian law')
    expect(Number(p.total_cost)).toBe(200000)
  })

  it('lists every version, newest first', async () => {
    const one_ = await issue('One')
    // Two issues in the same millisecond tie on created_at and come back in
    // either order; a real studio never sends twice that fast.
    await db.exec(`update project_terms_documents set created_at = created_at - interval '1 minute' where id = '${one_.document_id}'`)
    await issue('Two')
    const rows = await q<{ revoked_at: string | null }>(`select revoked_at from list_project_terms('${PROJECT}')`)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.revoked_at).toBeNull()
    expect(rows[1]!.revoked_at).not.toBeNull()
  })
})

describe('emailing a link already made', () => {
  it('only accepts the live link of that document', async () => {
    const a = await issue()
    const live = (raw: string) =>
      one<{ ok: boolean }>(`select terms_link_is_live('${a.document_id}', '${raw}') as ok`).then((r) => r.ok)
    expect(await live(a.token)).toBe(true)
    expect(await live('not-the-token-at-all')).toBe(false)
    await db.query(`select cancel_terms_document('${a.document_id}')`)
    expect(await live(a.token)).toBe(false)
  })
})

describe('terms with no payment plan', () => {
  it('issue with the plan left out', async () => {
    const { document_id } = await one<{ document_id: string }>(`select * from issue_client_terms('${PROJECT}', 'Just text')`)
    const { payment_terms } = await one<{ payment_terms: unknown[] }>(`select payment_terms from project_terms_documents where id = '${document_id}'`)
    expect(payment_terms).toEqual([])
  })
})
