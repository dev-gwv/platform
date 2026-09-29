import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Several functions on one lead (0212): Haldi, Mehendi, Wedding, Reception.
 *
 * The list lives in crm_lead_functions; the lead's old event_type /
 * event_date / event_location stay equal to its first function so everything
 * that already reads them keeps working. These check both directions of that
 * sync, the backfill of leads that already had an event, and that a direct
 * write to the lead never wipes out a real list.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

type LeadEvent = { event_type: string | null; event_date: string | null; event_location: string | null }
const leadEvent = (name: string) =>
  one<LeadEvent>(
    `select event_type, event_date::text as event_date, event_location from crm_leads where name = '${name}'`,
  )
const functionsOf = (name: string) =>
  q<{ event_type: string | null; event_date: string | null }>(`
    select f.event_type, f.event_date::text as event_date
      from crm_lead_functions f join crm_leads l on l.id = f.lead_id
     where l.name = '${name}'
     order by f.event_date nulls last, f.sort, f.created_at`)
const leadId = async (name: string) => (await one<{ id: string }>(`select id from crm_leads where name = '${name}'`)).id

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

  // Leads that already carry an event must exist before 0212, or the
  // backfill has nothing to find.
  const files = readdirSync(migDir)
    .filter((x) => x.endsWith('.sql') && !x.startsWith('0000_'))
    .sort()
  const cut = files.findIndex((f) => f.startsWith('0212_'))
  expect(cut).toBeGreaterThan(0)
  for (const f of files.slice(0, cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email)
      values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
    insert into crm_leads (company_id, name, phone, source, event_type, event_date, event_location) values
      ('${COMPANY}', 'Old wedding', '9800000001', 'manual', 'Wedding', '2026-12-14', 'Jaipur'),
      ('${COMPANY}', 'Only a date', '9800000002', 'manual', null, '2026-11-02', null),
      ('${COMPANY}', 'Nothing yet', '9800000003', 'manual', null, null, null);
  `)

  for (const f of files.slice(cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))
})

describe('the backfill', () => {
  it('gives a lead that had an event that event as its first function', async () => {
    expect(await functionsOf('Old wedding')).toEqual([{ event_type: 'Wedding', event_date: '2026-12-14' }])
  })
  it('keeps a date with no type as a date with no type -- nothing is invented', async () => {
    expect(await functionsOf('Only a date')).toEqual([{ event_type: null, event_date: '2026-11-02' }])
    expect((await leadEvent('Only a date')).event_type).toBeNull()
  })
  it('leaves a lead with no event without functions', async () => {
    expect(await functionsOf('Nothing yet')).toEqual([])
  })
})

describe('the list drives the lead', () => {
  it('follows the earliest function when more are added', async () => {
    const id = await leadId('Old wedding')
    await db.exec(`
      insert into crm_lead_functions (company_id, lead_id, event_type, event_date, location, sort) values
        ('${COMPANY}', '${id}', 'Haldi', '2026-12-12', 'Jaipur', 1),
        ('${COMPANY}', '${id}', 'Reception', '2026-12-15', 'Delhi', 2);
    `)
    expect(await leadEvent('Old wedding')).toEqual({
      event_type: 'Haldi',
      event_date: '2026-12-12',
      event_location: 'Jaipur',
    })
    expect((await functionsOf('Old wedding')).map((f) => f.event_type)).toEqual(['Haldi', 'Wedding', 'Reception'])
  })

  it('falls back to the next function when the first is removed', async () => {
    await db.exec(`delete from crm_lead_functions where event_type = 'Haldi'`)
    expect((await leadEvent('Old wedding')).event_type).toBe('Wedding')
    expect((await leadEvent('Old wedding')).event_date).toBe('2026-12-14')
  })

  it('clears the lead when every function is removed', async () => {
    const id = await leadId('Old wedding')
    await db.exec(`delete from crm_lead_functions where lead_id = '${id}'`)
    expect(await leadEvent('Old wedding')).toEqual({ event_type: null, event_date: null, event_location: null })
  })
})

describe('a direct write to the lead', () => {
  it('becomes the function of a new lead (a web form, a Meta lead, an import)', async () => {
    await db.exec(`
      insert into crm_leads (company_id, name, phone, source, event_type, event_date)
      values ('${COMPANY}', 'From a form', '9800000009', 'website', 'Engagement', '2027-01-20')`)
    expect(await functionsOf('From a form')).toEqual([{ event_type: 'Engagement', event_date: '2027-01-20' }])
  })

  it('updates the single function of a lead that has one', async () => {
    await db.exec(`update crm_leads set event_date = '2027-02-01' where name = 'From a form'`)
    expect(await functionsOf('From a form')).toEqual([{ event_type: 'Engagement', event_date: '2027-02-01' }])
  })

  it('never overwrites a real list of several functions', async () => {
    const id = await leadId('Nothing yet')
    await db.exec(`
      insert into crm_lead_functions (company_id, lead_id, event_type, event_date, sort) values
        ('${COMPANY}', '${id}', 'Mehendi', '2027-03-01', 0),
        ('${COMPANY}', '${id}', 'Wedding', '2027-03-03', 1);
    `)
    await db.exec(`update crm_leads set event_type = 'Birthday' where id = '${id}'`)
    expect((await functionsOf('Nothing yet')).map((f) => f.event_type)).toEqual(['Mehendi', 'Wedding'])
  })

  it('is removed when the lead is deleted', async () => {
    const id = await leadId('From a form')
    await db.exec(`delete from crm_leads where id = '${id}'`)
    const n = await one<{ n: number }>(`select count(*)::int as n from crm_lead_functions where lead_id = '${id}'`)
    expect(n.n).toBe(0)
  })
})
