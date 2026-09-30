import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Permanent erasure of leads (0213).
 *
 * "Archive" hid a lead but kept the person: the lead, its contact copy, the
 * Facebook import log and every message stayed. These check that erasing
 * really removes every copy of the person, scrubs what has to stay for the
 * books, refuses anything live or anyone else's, and leaves other people alone.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const RIVAL_OWNER = '33333333-3333-3333-3333-333333333333'
const RIVAL = '44444444-4444-4444-4444-444444444444'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!
const count = async (sql: string) => (await one<{ n: number }>(`select count(*)::int as n from (${sql}) t`)).n
const idOf = async (name: string, company = COMPANY) =>
  (await one<{ id: string }>(`select id from crm_leads where name = '${name}' and company_id = '${company}'`)).id
const erase = async (...ids: string[]) =>
  (await one<{ n: number }>(`select crm_erase_leads(array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]) as n`)).n

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

  const files = readdirSync(migDir)
    .filter((x) => x.endsWith('.sql') && !x.startsWith('0000_'))
    .sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  for (const [id, email] of [
    [OWNER, 'o@s.test'],
    [RIVAL_OWNER, 'r@s.test'],
  ]) {
    await db.exec(`insert into auth.users (id, email) values ('${id}', '${email}');`)
  }
  await db.exec(`
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Studio', '${OWNER}'), ('${RIVAL}', 'Rival', '${RIVAL_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${RIVAL_OWNER}', '${RIVAL}', 'super_admin', 'Rival', 'r@s.test');
    insert into crm_leads (company_id, name, phone, email, source, is_archived) values
      ('${COMPANY}', 'Gone',     '9800000001', 'gone@x.test',  'facebook', true),
      ('${COMPANY}', 'Gone dup', '9800000001', null,           'manual',   true),
      ('${COMPANY}', 'Live',     '9800000002', 'live@x.test',  'manual',   false),
      ('${COMPANY}', 'Other',    '9800000003', 'other@x.test', 'manual',   true),
      ('${RIVAL}',   'Rival',    '9800000001', 'gone@x.test',  'manual',   true);
  `)
})

describe('what is on file before', () => {
  it('has a contact copy for every lead', async () => {
    expect(await count(`select 1 from crm_contacts where company_id = '${COMPANY}'`)).toBeGreaterThanOrEqual(3)
  })
})

describe('erasing a lead', () => {
  it('refuses to run for someone who is not signed in to a studio', async () => {
    const id = await idOf('Gone')
    await expect(erase(id)).rejects.toThrow(/not allowed/)
  })

  it('removes the lead, its contact copy and the Facebook import log', async () => {
    await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
    const gone = await idOf('Gone')
    await db.exec(`
      insert into fb_lead_imports (company_id, page_id, page_name, name, phone, email, status, lead_id) values
        ('${COMPANY}', 'p1', 'Page', 'Gone', '+919800000001', 'gone@x.test', 'imported', '${gone}'),
        ('${COMPANY}', 'p1', 'Page', 'Gone again', '+919800000001', null, 'duplicate', null),
        ('${COMPANY}', 'p1', 'Page', 'Other', '+919800000003', 'other@x.test', 'imported', null);
      insert into enquiries (company_id, name, phone, converted_lead_id)
        values ('${COMPANY}', 'Gone', '9800000001', '${gone}');
    `)
    const contact = (await one<{ contact_id: string }>(`select contact_id from crm_leads where id = '${gone}'`)).contact_id

    const n = await erase(gone)

    expect(n).toBe(1)
    expect(await count(`select 1 from crm_leads where id = '${gone}'`)).toBe(0)
    expect(await count(`select 1 from fb_lead_imports where company_id = '${COMPANY}' and phone like '%9800000001'`)).toBe(0)
    expect(await count(`select 1 from enquiries where converted_lead_id is null and name = 'Gone'`)).toBe(0)
    // The lead's contact stays while another lead ("Gone dup", same number) still uses it.
    const stillUsed = await count(`select 1 from crm_leads where contact_id = '${contact}'`)
    expect(await count(`select 1 from crm_contacts where id = '${contact}'`)).toBe(stillUsed > 0 ? 1 : 0)
  })

  it('takes the contact with the last lead that used it', async () => {
    const dup = await idOf('Gone dup')
    const contact = (await one<{ contact_id: string }>(`select contact_id from crm_leads where id = '${dup}'`)).contact_id
    await erase(dup)
    expect(await count(`select 1 from crm_contacts where id = '${contact}'`)).toBe(0)
  })

  it('leaves other people, and their import rows, alone', async () => {
    expect(await count(`select 1 from crm_leads where name in ('Live', 'Other') and company_id = '${COMPANY}'`)).toBe(2)
    expect(await count(`select 1 from fb_lead_imports where name = 'Other'`)).toBe(1)
  })
})

describe('what is refused', () => {
  it('never erases a live lead', async () => {
    const live = await idOf('Live')
    expect(await erase(live)).toBe(0)
    expect(await count(`select 1 from crm_leads where id = '${live}'`)).toBe(1)
  })

  it("never erases another studio's lead", async () => {
    const rival = await idOf('Rival', RIVAL)
    expect(await erase(rival)).toBe(0)
    expect(await count(`select 1 from crm_leads where id = '${rival}'`)).toBe(1)
  })

  it('refuses more than 200 at once', async () => {
    const many = Array.from({ length: 201 }, () => '00000000-0000-0000-0000-000000000000')
    await expect(erase(...many)).rejects.toThrow(/too many/)
  })
})

describe('what stays for the books, without the person', () => {
  it('scrubs the audit trail, the messages and the referral, and keeps the rows', async () => {
    const other = await idOf('Other')
    await db.exec(`
      insert into audit_logs (company_id, actor_user_id, action, entity_type, entity_id, after)
        values ('${COMPANY}', '${OWNER}', 'lead.create', 'crm_lead', '${other}',
                '{"phone":"9800000003","source":"manual","name":"Other"}'::jsonb);
      insert into message_outbox (company_id, channel, to_address, body, entity_type, entity_id, cost_paise)
        values ('${COMPANY}', 'whatsapp', '919800000003', 'Hi Other, your quote', 'crm_lead', '${other}', 80),
               ('${COMPANY}', 'email', 'other@x.test', 'Hello', null, null, 0);
      insert into referral_campaigns (id, company_id, name, slug)
        values ('55555555-5555-4555-8555-555555555555', '${COMPANY}', 'Friends', 'friends');
      insert into referral_submissions (company_id, campaign_id, client_name, client_phone, client_email, linked_lead_id, reward_granted)
        values ('${COMPANY}', '55555555-5555-4555-8555-555555555555', 'Other', '9800000003', 'other@x.test', '${other}', true);
    `)

    expect(await erase(other)).toBe(1)

    const audit = await one<{ after: Record<string, unknown> }>(
      `select after from audit_logs where entity_id = '${other}'`,
    )
    expect(audit.after).toEqual({ source: 'manual' })

    const msgs = await q<{ to_address: string; body: string | null; cost_paise: number }>(
      `select to_address, body, cost_paise from message_outbox where company_id = '${COMPANY}' order by cost_paise desc`,
    )
    expect(msgs.map((m) => m.to_address)).toEqual(['erased', 'erased'])
    expect(msgs.every((m) => m.body === null)).toBe(true)
    expect(msgs[0]!.cost_paise).toBe(80) // the charge stays

    const ref = await one<{ client_name: string; client_phone: string | null; reward_granted: boolean }>(
      `select client_name, client_phone, reward_granted from referral_submissions where company_id = '${COMPANY}'`,
    )
    expect(ref).toEqual({ client_name: 'Erased', client_phone: null, reward_granted: true })
  })
})

describe('a duplicate that was merged into the lead', () => {
  it('goes with it, since it is the same person', async () => {
    await db.exec(`
      insert into crm_leads (company_id, name, phone, source, is_archived) values
        ('${COMPANY}', 'Main',   '9800000010', 'manual', true),
        ('${COMPANY}', 'Merged', '9800000011', 'manual', false);
    `)
    const main = await idOf('Main')
    const merged = await idOf('Merged')
    await db.exec(`update crm_leads set merged_into = '${main}' where id = '${merged}'`)
    expect(await erase(main)).toBe(2)
    expect(await count(`select 1 from crm_leads where id in ('${main}', '${merged}')`)).toBe(0)
  })
})
