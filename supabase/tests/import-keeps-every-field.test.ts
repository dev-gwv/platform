import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * An import keeps the shoot date and the budget.
 *
 * crm_import_leads has accepted city, event type, event date, venue, deal
 * value, alternate phone and quality since 0107. The import screen sent five
 * columns and always `mode: 'skip'`, so a studio importing its enquiry
 * spreadsheet watched those columns appear in the preview's column list and
 * lost every one of them on commit — the worst kind of bug, because it looks
 * like it worked.
 *
 * These run against the function the API calls, so they fail if the write path
 * ever narrows again.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]

const rows = (v: unknown) => JSON.stringify(v).replace(/'/g, "''")

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
  for (const f of readdirSync(migDir)
    .filter((x) => x.endsWith('.sql') && !x.startsWith('0000_'))
    .sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

beforeEach(async () => {
  await db.exec(`delete from crm_leads where company_id = '${COMPANY}';`)
})

describe('crm_import_leads writes the whole row', () => {
  it('keeps the event, the venue, the city, the budget and the quality', async () => {
    const payload = [
      {
        name: 'Priya Sharma',
        phone: '9876543210',
        email: 'priya@example.in',
        event_type: 'Wedding',
        event_date: '2027-03-12',
        event_location: 'Taj Lands End',
        city: 'Mumbai',
        deal_value: 150000,
        alternate_phone: '9812345678',
        quality: 'hot',
        notes: 'Wants candid + album',
      },
    ]
    const out = await one<{ r: { created: number } }>(
      `select crm_import_leads('${rows(payload)}'::jsonb, true, 'create') as r`,
    )
    expect(out.r.created).toBe(1)

    const lead = await one<{
      event_type: string
      event_date: string
      event_location: string
      city: string
      deal_value: string
      alternate_phone: string
      quality: string
      notes: string
    }>(`select event_type, event_date::text as event_date, event_location, city, deal_value, alternate_phone, quality, notes
          from crm_leads where company_id = '${COMPANY}'`)

    expect(lead.event_type).toBe('Wedding')
    // Not 3 December. The date the studio wrote.
    expect(lead.event_date).toBe('2027-03-12')
    expect(lead.event_location).toBe('Taj Lands End')
    expect(lead.city).toBe('Mumbai')
    expect(Number(lead.deal_value)).toBe(150000)
    expect(lead.alternate_phone).toBe('9812345678')
    expect(lead.quality).toBe('hot')
    expect(lead.notes).toBe('Wants candid + album')
  })

  it('stamps the import so these leads can be told apart later', async () => {
    await db.exec(
      `select crm_import_leads('${rows([{ name: 'A', phone: '9800000001' }])}'::jsonb, true, 'create')`,
    )
    const lead = await one<{ source_key: string; source: string }>(
      `select source_key, source from crm_leads where company_id = '${COMPANY}'`,
    )
    expect(lead.source_key).toBe('csv_import')
  })

  it('update mode fills in what a known lead was missing', async () => {
    await db.exec(`
      insert into crm_leads (company_id, name, phone, phone_norm, source)
      values ('${COMPANY}', 'Priya', '9876543210', crm_normalize_phone('9876543210'), 'manual');`)

    const payload = [
      {
        name: 'Priya Sharma',
        phone: '9876543210',
        event_type: 'Wedding',
        event_date: '2027-03-12',
        deal_value: 150000,
      },
    ]
    const out = await one<{ r: { updated: number; created: number } }>(
      `select crm_import_leads('${rows(payload)}'::jsonb, true, 'update') as r`,
    )
    expect(out.r.updated).toBe(1)
    expect(out.r.created).toBe(0)

    const lead = await one<{ event_type: string; deal_value: string; n: number }>(`
      select event_type, deal_value, (select count(*)::int from crm_leads where company_id = '${COMPANY}') as n
        from crm_leads where company_id = '${COMPANY}'`)
    // One lead, now carrying the detail from the file.
    expect(lead.n).toBe(1)
    expect(lead.event_type).toBe('Wedding')
    expect(Number(lead.deal_value)).toBe(150000)
  })

  it('skip mode leaves a known lead exactly as it was', async () => {
    await db.exec(`
      insert into crm_leads (company_id, name, phone, phone_norm, source, event_type)
      values ('${COMPANY}', 'Priya', '9876543210', crm_normalize_phone('9876543210'), 'manual', 'Engagement');`)

    const out = await one<{ r: { skipped: number } }>(
      `select crm_import_leads('${rows([{ name: 'Priya Sharma', phone: '9876543210', event_type: 'Wedding' }])}'::jsonb, true, 'skip') as r`,
    )
    expect(out.r.skipped).toBe(1)
    const lead = await one<{ event_type: string }>(
      `select event_type from crm_leads where company_id = '${COMPANY}'`,
    )
    expect(lead.event_type).toBe('Engagement')
  })

  it('rejects one bad row and imports the rest', async () => {
    const payload = [
      { name: 'Good', phone: '9800000001', deal_value: 50000 },
      { name: 'No phone', phone: '' },
      { name: 'Also good', phone: '9800000002' },
    ]
    const out = await one<{ r: { created: number; invalid: number } }>(
      `select crm_import_leads('${rows(payload)}'::jsonb, true, 'create') as r`,
    )
    expect(out.r.created).toBe(2)
    expect(out.r.invalid).toBe(1)
  })
})
