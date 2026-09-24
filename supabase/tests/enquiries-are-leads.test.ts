import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0168: an enquiry is a lead nobody has called yet.
 *
 * The migration runs against an empty database at boot, so the interesting
 * cases can only be exercised by seeding enquiries and running the file again
 * — which is also the idempotency check. Running it twice must add nothing,
 * because a studio that re-applies migrations must not wake up to every
 * enquiry duplicated in the list it works from.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const FOLD = readFileSync(join(migDir, '0168_enquiries_are_leads.sql'), 'utf8')

const OWNER = 'e0000000-0000-4000-8000-000000000001'
const OTHER_OWNER = 'e0000000-0000-4000-8000-000000000002'
const COMPANY = 'e0000000-0000-4000-8000-0000000000aa'
const OTHER = 'e0000000-0000-4000-8000-0000000000ab'

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${OTHER_OWNER}', 'x@t.test');
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@t.test');
  `)
})

beforeEach(async () => {
  await db.exec(`delete from crm_leads; delete from enquiries;`)
})

const leads = () =>
  q<{ name: string; phone: string | null; status: string; source: string; notes: string | null; enquiry_source: string | null }>(
    `select name, phone, status, source, notes, source_meta ->> 'enquiry_source' as enquiry_source
       from crm_leads order by name`,
  )

describe('0168: enquiries fold into leads', () => {
  it('brings an unworked enquiry across, with its message and its own source wording', async () => {
    await db.exec(`
      insert into enquiries (company_id, name, phone, email, message, source, enquiry_status)
      values ('${COMPANY}', 'Aanya Sharma', '9876543210', 'a@x.test',
              'Wants a December wedding, two days', 'wedding expo, Jaipur', 'new');
    `)
    await db.exec(FOLD)

    const rows = await leads()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Aanya Sharma')
    expect(rows[0]!.status).toBe('new')
    expect(rows[0]!.source).toBe('enquiry')
    expect(rows[0]!.notes).toBe('Wants a December wedding, two days')
    // The studio's own wording has no home in the lead source enum, so it is
    // kept whole rather than flattened to 'other'.
    expect(rows[0]!.enquiry_source).toBe('wedding expo, Jaipur')
  })

  it('maps the statuses a studio actually uses', async () => {
    await db.exec(`
      insert into enquiries (company_id, name, phone, enquiry_status) values
        ('${COMPANY}', 'New',       '9000000001', 'new'),
        ('${COMPANY}', 'Reviewed',  '9000000002', 'reviewed'),
        ('${COMPANY}', 'Contacted', '9000000003', 'contacted'),
        ('${COMPANY}', 'Closed',    '9000000004', 'closed');
    `)
    await db.exec(FOLD)

    const byName = Object.fromEntries((await leads()).map((r) => [r.name, r.status]))
    // Someone read it; nobody rang. That is still new work.
    expect(byName['Reviewed']).toBe('new')
    expect(byName['New']).toBe('new')
    expect(byName['Contacted']).toBe('contacted')
    expect(byName['Closed']).toBe('lost')
  })

  it('skips an enquiry that was already converted — converting is what made its lead', async () => {
    await db.exec(`
      insert into crm_leads (id, company_id, name, phone, source)
        values ('e0000000-0000-4000-8000-0000000000f1', '${COMPANY}', 'Already A Lead', '9111111111', 'enquiry');
      insert into enquiries (company_id, name, phone, enquiry_status, converted_lead_id)
        values ('${COMPANY}', 'Already A Lead', '9111111111', 'converted', 'e0000000-0000-4000-8000-0000000000f1');
    `)
    await db.exec(FOLD)

    expect(await leads()).toHaveLength(1)
  })

  it('skips an enquiry whose number is already on a lead — that is the same person', async () => {
    await db.exec(`
      insert into crm_leads (company_id, name, phone, phone_norm, source)
        values ('${COMPANY}', 'Rang Us First', '9222222222', crm_normalize_phone('9222222222'), 'manual');
      -- Same number, written the way a form would send it.
      insert into enquiries (company_id, name, phone, enquiry_status)
        values ('${COMPANY}', 'Rang Us First', '+91 92222 22222', 'new');
    `)
    await db.exec(FOLD)

    const rows = await leads()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.source).toBe('manual')
  })

  it('runs twice without duplicating anyone', async () => {
    await db.exec(`
      insert into enquiries (company_id, name, phone, enquiry_status) values
        ('${COMPANY}', 'Once', '9333333333', 'new'),
        ('${COMPANY}', 'Twice', '9444444444', 'contacted');
    `)
    await db.exec(FOLD)
    expect(await leads()).toHaveLength(2)

    await db.exec(FOLD)
    await db.exec(FOLD)
    expect(await leads()).toHaveLength(2)
  })

  it('keeps each studio to its own enquiries', async () => {
    await db.exec(`
      insert into enquiries (company_id, name, phone, enquiry_status) values
        ('${COMPANY}', 'Ours',   '9555555555', 'new'),
        ('${OTHER}',   'Theirs', '9666666666', 'new');
    `)
    await db.exec(FOLD)

    const rows = await q<{ name: string; company_id: string }>(
      `select name, company_id from crm_leads order by name`,
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.name === 'Ours')!.company_id).toBe(COMPANY)
    expect(rows.find((r) => r.name === 'Theirs')!.company_id).toBe(OTHER)
  })

  it('leaves the enquiries table untouched — nothing is deleted', async () => {
    await db.exec(`
      insert into enquiries (company_id, name, phone, enquiry_status)
        values ('${COMPANY}', 'Still Here', '9777777777', 'new');
    `)
    await db.exec(FOLD)

    const kept = await q<{ n: string }>(`select count(*)::text as n from enquiries`)
    expect(kept[0]!.n).toBe('1')
  })
})
