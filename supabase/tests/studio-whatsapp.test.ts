import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0203: the studio's own WhatsApp number. Replies land on the right lead (or
 * make one), sequences send by themselves only when WhatsApp allows it,
 * receipts land on the message, and nobody signed in can read the token.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e3000000-0000-4000-8000-000000000001'
const REP = 'e3000000-0000-4000-8000-000000000002'
const COMPANY = 'e3000000-0000-4000-8000-0000000000aa'
const PHONE_ID = '109876543210'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0] as T
let n = 0
const lead = async (phone: string, over: Record<string, string> = {}) => {
  n += 1
  const id = `f3000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const cols = { id: `'${id}'`, company_id: `'${COMPANY}'`, name: `'Lead ${n}'`, phone: `'${phone}'`, assigned_to: `'${REP}'`, ...over }
  await db.exec(`insert into crm_leads (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`)
  return id
}
const inbound = (from: string, body: string, wamid: string, name = 'Riya') =>
  one<{ r: { matched: boolean; lead_id?: string; created?: boolean; duplicate?: boolean } }>(
    `select crm_whatsapp_inbound('${PHONE_ID}', '${from}', '${name}', '${body}', '${wamid}') as r`,
  ).then((x) => x.r)
const canSend = (leadId: string, template: boolean) =>
  one<{ ok: boolean }>(`select crm_whatsapp_can_send('${COMPANY}', '${leadId}', ${template}) as ok`).then((x) => x.ok)
const connect = () =>
  db.exec(`insert into company_whatsapp (company_id, phone_number_id, waba_id, access_token_enc, webhook_key, verify_token)
           values ('${COMPANY}', '${PHONE_ID}', '2233445566', 'v1:secret', 'k'||repeat('x', 30), 'verify-token-123456')
           on conflict (company_id) do nothing`)

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${REP}', 'r@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'o@s.test', 'active'),
      ('${REP}', '${COMPANY}', 'employee', 'Ravi', 'r@s.test', 'active');
    grant usage on schema auth to authenticated;
  `)
})

beforeEach(async () => {
  await db.exec(`
    delete from crm_sequence_sends; delete from crm_lead_cadences; delete from crm_activities; delete from crm_leads;
    delete from crm_cadences; delete from company_entitlements; delete from company_whatsapp; delete from notifications;
    insert into company_entitlements (company_id, key) values ('${COMPANY}', 'whatsapp_api');
  `)
  await connect()
})

describe('a message to the studio’s number', () => {
  it('lands on the lead with that number, stops its sequence and tells the owner; a retry is ignored', async () => {
    const id = await lead('98765 43210')
    const { id: seq } = await one<{ id: string }>(`insert into crm_cadences (company_id, name) values ('${COMPANY}', 'Chase') returning id`)
    await db.exec(`insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, channel, body) values ('${seq}', '${COMPANY}', 1, 0, 'whatsapp', 'Hi')`)
    await db.exec(`select crm_sequence_begin('${id}', '${seq}', null, 'test')`)

    expect(await inbound('919876543210', 'Yes, call me', 'wamid.1')).toMatchObject({ matched: true, lead_id: id, created: false })
    const act = await q<{ body: string; direction: string }>(`select body, direction from crm_activities where lead_id = '${id}' and type = 'whatsapp'`)
    expect(act).toEqual([{ body: 'Yes, call me', direction: 'in' }])
    expect((await one<{ r: string }>(`select stopped_reason as r from crm_lead_cadences where lead_id = '${id}'`)).r).toBe('replied')
    const titles = (await q<{ title: string }>(`select title from notifications where type = 'crm_whatsapp_in'`)).map((r) => r.title)
    expect(titles).toEqual([`Lead ${n} replied on WhatsApp`])

    expect(await inbound('919876543210', 'Yes, call me', 'wamid.1')).toMatchObject({ duplicate: true })
    expect(await q(`select 1 from crm_activities where lead_id = '${id}' and type = 'whatsapp'`)).toHaveLength(1)
  })

  it('from a new number, becomes a new WhatsApp enquiry', async () => {
    const r = await inbound('919812345678', 'Hi, are you free on 12 Dec?', 'wamid.2', 'Karan')
    expect(r).toMatchObject({ matched: true, created: true })
    const l = await one<{ name: string; source: string; phone_norm: string }>(`select name, source, phone_norm from crm_leads where id = '${r.lead_id}'`)
    expect(l).toEqual({ name: 'Karan', source: 'whatsapp', phone_norm: '919812345678' })
  })

  it('to a number no studio has connected, is ignored', async () => {
    const r = await one<{ r: { matched: boolean } }>(`select crm_whatsapp_inbound('555', '919800000000', 'X', 'hi', 'wamid.3') as r`)
    expect(r.r.matched).toBe(false)
  })
})

describe('sending by itself', () => {
  it('needs the switch, the connection, and a template or an open 24 hours', async () => {
    const id = await lead('9876500001')
    expect(await canSend(id, false)).toBe(false)
    expect(await canSend(id, true)).toBe(true)
    await inbound('919876500001', 'hello', 'wamid.4')
    expect(await canSend(id, false)).toBe(true)
    await db.exec(`delete from company_entitlements`)
    expect(await canSend(id, true)).toBe(false)
  })

  it('the sweep queues a templated step with its template, and leaves an untemplated one for a tap', async () => {
    const { id: seq } = await one<{ id: string }>(`insert into crm_cadences (company_id, name) values ('${COMPANY}', 'Templated') returning id`)
    await db.exec(`insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, channel, body, wa_template_name, wa_template_lang, wa_params)
                   values ('${seq}', '${COMPANY}', 1, 0, 'whatsapp', 'Hi {{first_name}}', 'enquiry_hello', 'en', '["first_name"]'),
                          ('${seq}', '${COMPANY}', 2, 1, 'whatsapp', 'Still deciding?', null, null, null)`)
    const id = await lead('9876500002')
    await db.exec(`select crm_sequence_begin('${id}', '${seq}', null, 'test')`)
    for (let i = 0; i < 2; i++) {
      await db.exec(`update crm_lead_cadences set next_at = now() - interval '1 minute' where lead_id = '${id}'`)
      await db.exec(`select crm_advance_cadences(false)`)
    }
    const rows = await q<{ step_no: number; status: string; wa_template_name: string | null; wa_params: string[] | null }>(
      `select step_no, status, wa_template_name, wa_params from crm_sequence_sends where lead_id = '${id}' order by step_no`,
    )
    expect(rows).toEqual([
      { step_no: 1, status: 'queued', wa_template_name: 'enquiry_hello', wa_params: ['first_name'] },
      { step_no: 2, status: 'manual', wa_template_name: null, wa_params: null },
    ])

    // The sequence has finished, but a reply still drops what was waiting.
    await inbound('919876500002', 'Thanks, we booked', 'wamid.5')
    const after = await q<{ status: string; error: string | null }>(`select status, error from crm_sequence_sends where lead_id = '${id}' and step_no = 2`)
    expect(after).toEqual([{ status: 'skipped', error: 'They replied' }])
  })
})

describe('receipts', () => {
  it('move forward only, and a failure says so', async () => {
    const { id: seq } = await one<{ id: string }>(`insert into crm_cadences (company_id, name) values ('${COMPANY}', 'Receipts') returning id`)
    const id = await lead('9876500003')
    await db.exec(`insert into crm_sequence_sends (company_id, lead_id, cadence_id, step_no, enrolled_at, channel, body, status, provider_id)
                   values ('${COMPANY}', '${id}', '${seq}', 1, now(), 'whatsapp', 'Hi', 'sent', 'wamid.X'),
                          ('${COMPANY}', '${id}', '${seq}', 2, now(), 'whatsapp', 'Hi', 'sent', 'wamid.Y')`)
    const receipt = (w: string, s: string) => one<{ ok: boolean }>(`select crm_whatsapp_receipt('${w}', '${s}', ${s === 'failed' ? `'Number not on WhatsApp'` : 'null'}) as ok`)
    expect((await receipt('wamid.X', 'delivered')).ok).toBe(true)
    expect((await receipt('wamid.X', 'read')).ok).toBe(true)
    expect((await receipt('wamid.X', 'delivered')).ok).toBe(false)
    await receipt('wamid.Y', 'failed')
    const rows = await q<{ delivery: string; status: string; error: string | null }>(`select delivery, status, error from crm_sequence_sends order by step_no`)
    expect(rows).toEqual([
      { delivery: 'read', status: 'sent', error: null },
      { delivery: 'failed', status: 'failed', error: 'Number not on WhatsApp' },
    ])
  })
})

describe('the token', () => {
  it('cannot be read by a signed-in user; the status can', async () => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${OWNER}';`)
    try {
      await expect(db.query(`select access_token_enc from company_whatsapp`)).rejects.toThrow(/permission denied/)
      const s = await one<{ connected: boolean; phone_number_id: string }>(`select connected, phone_number_id from company_whatsapp_status()`)
      expect(s).toEqual({ connected: true, phone_number_id: PHONE_ID })
    } finally {
      await db.exec(`reset role; reset request.jwt.claim.sub;`)
    }
  })
})
