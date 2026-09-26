import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Client portal (0184): one private link per project. The token names one
 * project of one studio; the page leaves out internal work, notes, prices,
 * crew pay and everything of any other project; a revoked or expired link
 * opens nothing.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'd0000000-0000-4000-8000-000000000001'
const EDITOR = 'd0000000-0000-4000-8000-000000000002'
const OTHER = 'd0000000-0000-4000-8000-000000000003'
const STUDIO = 'd0000000-0000-4000-8000-0000000000aa'
const RIVAL = 'd0000000-0000-4000-8000-0000000000bb'
const CLIENT = 'd0000000-0000-4000-8000-0000000000c1'
const CLIENT2 = 'd0000000-0000-4000-8000-0000000000c2'
const P1 = 'd0000000-0000-4000-8000-0000000000d1'
const P2 = 'd0000000-0000-4000-8000-0000000000d2'
const SHOOT = 'd0000000-0000-4000-8000-0000000000e1'
const D_CLIENT = 'd0000000-0000-4000-8000-0000000000f1'
const D_INTERNAL = 'd0000000-0000-4000-8000-0000000000f2'
const D_HIDDEN = 'd0000000-0000-4000-8000-0000000000f3'
const D_CANCELLED = 'd0000000-0000-4000-8000-0000000000f4'
const D_OTHER = 'd0000000-0000-4000-8000-0000000000f5'
const INV_SENT = 'd0000000-0000-4000-8000-000000000101'
const INV_DRAFT = 'd0000000-0000-4000-8000-000000000102'
const INV_OTHER = 'd0000000-0000-4000-8000-000000000103'
const TERMS_SENT = 'd0000000-0000-4000-8000-000000000201'
const TERMS_DRAFT = 'd0000000-0000-4000-8000-000000000202'

const RAW = 'portal-raw-token-one'
const RAW2 = 'portal-raw-token-two'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)
const fails = async (sql: string) => {
  try {
    await db.query(sql)
  } catch (e) {
    return (e as Error).message
  }
  return null
}
const hash = (raw: string) => `encode(sha256(convert_to('${raw}', 'UTF8')), 'hex')`
type Portal = {
  project: { name: string; client_name: string }
  shoots: { id: string; team: { first_name: string; role: string | null }[] }[]
  deliverables: { id: string; status: string; delivery_link: string | null }[]
  money: { total: number; received: number; balance: number; invoices: { id: string }[] } | null
  terms: { id: string }[]
}
const portal = async (raw: string) =>
  ((await q<{ doc: Portal | null }>(`select get_client_portal('${raw}') as doc`))[0]!.doc)

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${EDITOR}', 'e@s.test'), ('${OTHER}', 'x@r.test');
    insert into companies (id, name, owner_user_id) values ('${STUDIO}', 'Studio', '${OWNER}'), ('${RIVAL}', 'Rival', '${OTHER}');
    insert into users (user_id, company_id, role, name, email, salary) values
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Owner', 'o@s.test', null),
      ('${EDITOR}', '${STUDIO}', 'employee', 'Priya Sharma', 'e@s.test', 55555),
      ('${OTHER}', '${RIVAL}', 'super_admin', 'Rival Owner', 'x@r.test', null);
    insert into clients (id, company_id, name, phone) values
      ('${CLIENT}', '${STUDIO}', 'Asha & Rohan', '9876543210'),
      ('${CLIENT2}', '${STUDIO}', 'Someone Else', '9876500000');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${P1}', '${STUDIO}', '${CLIENT}', 'Asha weds Rohan', 200000, '${OWNER}'),
      ('${P2}', '${STUDIO}', '${CLIENT2}', 'Other wedding', 90000, '${OWNER}');
    insert into shoots (id, company_id, project_id, name, shoot_date, location, notes) values
      ('${SHOOT}', '${STUDIO}', '${P1}', 'Sangeet', '2026-12-01', 'Udaipur', 'CREW-ONLY-NOTE');
    insert into team_assignment_slots (company_id, user_id, shoot_id, service_name, start_at, end_at, estimated_cost)
      values ('${STUDIO}', '${EDITOR}', '${SHOOT}', 'Candid photographer', '2026-12-01 10:00+05:30', '2026-12-01 20:00+05:30', 12345);
    insert into deliverables (id, company_id, project_id, title, visibility_scope, show_on_quotation, status, delivery_link,
                              internal_notes, is_additional_charge, additional_charge_amount, estimated_date) values
      ('${D_CLIENT}', '${STUDIO}', '${P1}', 'Wedding album', 'client', true, 'completed', 'https://drive.example/album',
       'SECRET-NOTE', true, 7777, '2027-01-15'),
      ('${D_INTERNAL}', '${STUDIO}', '${P1}', 'Culling', 'internal', false, 'in_progress', null, null, false, 0, null),
      ('${D_HIDDEN}', '${STUDIO}', '${P1}', 'Surprise teaser', 'client', false, 'pending', null, null, false, 0, null),
      ('${D_CANCELLED}', '${STUDIO}', '${P1}', 'Dropped reel', 'client', true, 'cancelled', null, null, false, 0, null),
      ('${D_OTHER}', '${STUDIO}', '${P2}', 'Other album', 'client', true, 'pending', null, null, false, 0, null);
    insert into received_payments (company_id, project_id, amount, status) values
      ('${STUDIO}', '${P1}', 50000, 'paid'), ('${STUDIO}', '${P1}', 30000, 'pending');
    insert into invoices (id, company_id, project_id, client_id, invoice_number, status, total, balance_due) values
      ('${INV_SENT}', '${STUDIO}', '${P1}', '${CLIENT}', 'INV-1', 'sent', 100000, 100000),
      ('${INV_DRAFT}', '${STUDIO}', '${P1}', '${CLIENT}', 'INV-2', 'draft', 5000, 5000),
      ('${INV_OTHER}', '${STUDIO}', '${P2}', '${CLIENT2}', 'INV-3', 'sent', 9000, 9000);
    insert into project_terms_documents (id, company_id, project_id, rendered_body, title, sent_at, is_draft) values
      ('${TERMS_SENT}', '${STUDIO}', '${P1}', 'You agree to smile.', 'Wedding terms', now(), false),
      ('${TERMS_DRAFT}', '${STUDIO}', '${P1}', 'Not yet.', 'Draft terms', null, true);
  `)
  await as(OWNER)
  await q(`select issue_client_portal_link('${P1}', ${hash(RAW)})`)
})

describe('the token opens one project', () => {
  it('shows this project and its couple, not any other', async () => {
    const doc = (await portal(RAW))!
    expect(doc.project).toMatchObject({ name: 'Asha weds Rohan', client_name: 'Asha & Rohan' })
    const text = JSON.stringify(doc)
    expect(text).not.toContain('Other wedding')
    expect(text).not.toContain('Other album')
    expect(text).not.toContain('Someone Else')
    expect(text).not.toContain(INV_OTHER)
  })

  it('leaves out internal, hidden and cancelled deliverables', async () => {
    const doc = (await portal(RAW))!
    expect(doc.deliverables.map((d) => d.id)).toEqual([D_CLIENT])
    expect(doc.deliverables[0]).toMatchObject({ status: 'ready', delivery_link: 'https://drive.example/album' })
  })

  it('carries no costs, notes or crew pay', async () => {
    const doc = (await portal(RAW))!
    const text = JSON.stringify(doc)
    // A deliverable's own price never shows; the package total below includes it.
    expect(JSON.stringify(doc.deliverables)).not.toContain('7777')
    for (const secret of ['SECRET-NOTE', 'CREW-ONLY-NOTE', '12345', '55555', 'additional_charge', 'internal_notes', 'estimated_cost', 'salary', 'e@s.test']) {
      expect(text).not.toContain(secret)
    }
  })

  it('counts only money that came in, and lists only sent invoices', async () => {
    const doc = (await portal(RAW))!
    // Package 2,00,000 plus the 7,777 add-on; the promised 30,000 is not received.
    expect(doc.money).toMatchObject({ total: 207777, received: 50000, balance: 157777 })
    expect(doc.money!.invoices.map((i) => i.id)).toEqual([INV_SENT])
  })

  it('lists the terms that were sent, not a draft', async () => {
    expect((await portal(RAW))!.terms.map((t) => t.id)).toEqual([TERMS_SENT])
    expect(await q(`select title from client_portal_terms('${RAW}', '${TERMS_DRAFT}')`)).toHaveLength(0)
    expect(await q(`select title from client_portal_terms('${RAW}', '${TERMS_SENT}')`)).toEqual([{ title: 'Wedding terms' }])
  })

  it('opens only its own sent invoices', async () => {
    const one = async (id: string) => (await q<{ doc: unknown }>(`select client_portal_invoice('${RAW}', '${id}') as doc`))[0]!.doc
    expect(await one(INV_SENT)).not.toBeNull()
    expect(await one(INV_DRAFT)).toBeNull()
    expect(await one(INV_OTHER)).toBeNull()
  })

  it('counts each open', async () => {
    const before = (await q<{ view_count: number }>(`select view_count from client_portal_links where project_id = '${P1}' and revoked_at is null`))[0]!.view_count
    await portal(RAW)
    const [after] = await q<{ view_count: number; seen: boolean }>(
      `select view_count, last_viewed_at is not null as seen from client_portal_links where project_id = '${P1}' and revoked_at is null`)
    expect(after).toEqual({ view_count: before + 1, seen: true })
  })
})

describe('what the studio switches', () => {
  it('names the crew by first name and role only when asked', async () => {
    expect((await portal(RAW))!.shoots[0]!.team).toEqual([])
    await q(`select set_client_portal_options('${P1}', p_show_team => true)`)
    expect((await portal(RAW))!.shoots[0]!.team).toEqual([{ first_name: 'Priya', role: 'Candid photographer' }])
    expect(JSON.stringify(await portal(RAW))).not.toContain('Sharma')
  })

  it('hides money, and the invoices, when payments are off', async () => {
    await q(`select set_client_portal_options('${P1}', p_show_payments => false)`)
    expect((await portal(RAW))!.money).toBeNull()
    expect((await q<{ doc: unknown }>(`select client_portal_invoice('${RAW}', '${INV_SENT}') as doc`))[0]!.doc).toBeNull()
    await q(`select set_client_portal_options('${P1}', p_show_payments => true)`)
  })
})

describe('feedback', () => {
  it('tells the project owner; an internal item or an empty change request takes nothing', async () => {
    expect((await q<{ ok: boolean }>(`select client_portal_leave_feedback('${RAW}', '${D_CLIENT}', 'change_requested', 'Brighter please') as ok`))[0]!.ok).toBe(true)
    expect((await q<{ ok: boolean }>(`select client_portal_leave_feedback('${RAW}', '${D_INTERNAL}', 'approved', null) as ok`))[0]!.ok).toBe(false)
    expect((await q<{ ok: boolean }>(`select client_portal_leave_feedback('${RAW}', '${D_OTHER}', 'approved', null) as ok`))[0]!.ok).toBe(false)
    expect((await q<{ ok: boolean }>(`select client_portal_leave_feedback('${RAW}', '${D_CLIENT}', 'change_requested', '  ') as ok`))[0]!.ok).toBe(false)
    const told = await q<{ title: string; body: string }>(`select title, body from notifications where recipient_uid = '${OWNER}' and type = 'client_portal.feedback'`)
    expect(told).toEqual([{ title: 'Asha & Rohan asked for a change to Wedding album', body: 'Brighter please' }])
    expect((await portal(RAW))!.deliverables[0]).toMatchObject({ feedback: { kind: 'change_requested', message: 'Brighter please' } })
  })
})

describe('the link can be stopped', () => {
  it('another studio can neither make nor stop this project link', async () => {
    await as(OTHER)
    expect(await fails(`select issue_client_portal_link('${P1}', ${hash('rival')})`)).toMatch(/not in this studio/)
    expect((await q<{ ok: boolean }>(`select revoke_client_portal_link('${P1}') as ok`))[0]!.ok).toBe(false)
    expect(await portal(RAW)).not.toBeNull()
    await as(OWNER)
  })

  it('a new link retires the old; a revoked one opens nothing', async () => {
    await q(`select issue_client_portal_link('${P1}', ${hash(RAW2)})`)
    expect(await portal(RAW)).toBeNull()
    expect(await portal(RAW2)).not.toBeNull()
    expect((await q<{ ok: boolean }>(`select revoke_client_portal_link('${P1}') as ok`))[0]!.ok).toBe(true)
    expect(await portal(RAW2)).toBeNull()
    expect((await q<{ doc: unknown }>(`select client_portal_invoice('${RAW2}', '${INV_SENT}') as doc`))[0]!.doc).toBeNull()
    expect(await q(`select 1 from client_portal_terms('${RAW2}', '${TERMS_SENT}')`)).toHaveLength(0)
    expect((await q<{ ok: boolean }>(`select client_portal_leave_feedback('${RAW2}', '${D_CLIENT}', 'approved', null) as ok`))[0]!.ok).toBe(false)
  })

  it('an expired link opens nothing', async () => {
    await q(`select issue_client_portal_link('${P1}', ${hash('expiring')}, p_expires_at => now() + interval '1 day')`)
    expect(await portal('expiring')).not.toBeNull()
    await q(`update client_portal_links set expires_at = now() - interval '1 minute' where project_id = '${P1}' and revoked_at is null`)
    expect(await portal('expiring')).toBeNull()
    expect(await fails(`select issue_client_portal_link('${P1}', ${hash('past')}, p_expires_at => now() - interval '1 day')`)).toMatch(/future/)
  })

  it('never holds the raw token', async () => {
    expect(await q(`select 1 from client_portal_links where token_hash in ('${RAW}', '${RAW2}', 'expiring')`)).toHaveLength(0)
  })
})
