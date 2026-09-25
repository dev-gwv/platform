import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The client-facing token readers, called the way a client calls them.
 *
 * These five functions are the entire public surface of the product: the
 * quotation, receipt, terms sheet, team terms and delivery note a studio sends
 * on a link. Three of them were throwing on every call and nothing noticed,
 * because:
 *
 *   - PL/pgSQL does not resolve a function body until it runs, so a wrong
 *     column name or an ambiguous reference survives `create function` and
 *     every migration gate that only applies the file;
 *   - passing a bad token makes each one `return` before its main SELECT, so
 *     even calling the function proves nothing.
 *
 * So this seeds a real studio and calls each reader with a real token, which
 * is the only shape of test that can see those faults.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const CLIENT = '33333333-3333-3333-3333-333333333333'
const PROJECT = '44444444-4444-4444-4444-444444444444'
const QUOTE = '55555555-5555-5555-5555-555555555555'
const PAYMENT = '66666666-6666-6666-6666-666666666666'
const TERMS = '77777777-7777-7777-7777-777777777777'
const LEAD = '88888888-8888-8888-8888-888888888888'
const CRM_QUOTE = '99999999-9999-9999-9999-999999999999'
const SUBMISSION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SEND = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const CAMPAIGN = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

let db: PGlite

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

  // Every migration, in the order migrate.sh applies them — not a hand-kept
  // list, so a new file cannot be missed by omission.
  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
    .sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id, display_name, legal_name, website,
                           invoice_logo_url, invoice_phone, invoice_email, invoice_address,
                           invoice_gst_number, document_footer_note, quote_number_prefix)
    values ('${COMPANY}', 'Studio', '${OWNER}', 'Studio Ltd', 'Studio Private Ltd', 'studio.in',
            'https://example.test/logo.png', '9999999999', 'hi@studio.in', 'Somewhere',
            '27AAAAA0000A1Z5', 'Thanks for your business', 'Q-');
    insert into users (user_id, company_id, role, name, email)
    values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'owner@studio.test');
    insert into clients (id, company_id, name, email, phone, address)
    values ('${CLIENT}', '${COMPANY}', 'A Client', 'c@example.test', '8888888888', '12 Road');
    insert into projects (id, company_id, client_id, name, package_cost)
    values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Wedding', 100000);
    insert into deliverables (company_id, project_id, list_key, title, estimated_date,
                              is_additional_charge, additional_charge_amount)
    values ('${COMPANY}', '${PROJECT}', 'primary', 'Album', '2026-10-01', false, 0),
           ('${COMPANY}', '${PROJECT}', 'extra', 'Drone reel', null, true, 15000);
    insert into project_quotations (id, company_id, project_id, snapshot)
    values ('${QUOTE}', '${COMPANY}', '${PROJECT}',
            '{"items":[],"package_cost":100000,"add_ons":0,"total":100000,"project_name":"Wedding"}'::jsonb);
    insert into received_payments (id, company_id, project_id, amount, paid_on, mode, reference, notes)
    values ('${PAYMENT}', '${COMPANY}', '${PROJECT}', 25000, current_date, 'upi', 'REF1', 'Advance');
    insert into project_terms_documents (id, company_id, project_id, rendered_body, title)
    values ('${TERMS}', '${COMPANY}', '${PROJECT}', 'Body text', 'Terms');
    insert into crm_leads (id, company_id, name) values ('${LEAD}', '${COMPANY}', 'A Lead');
    insert into crm_quotes (id, company_id, lead_id, quote_number, status)
    values ('${CRM_QUOTE}', '${COMPANY}', '${LEAD}', 'Q-1', 'sent');
    insert into team_work_submissions (id, company_id, project_id, status, title,
                                       submission_link, delivery_type, delivery_label, ready_at)
    -- 'approved', not 'sent': the status check allows only submitted/approved/
    -- rejected, so get_delivery_for_token's 'sent' branch can never match.
    values ('${SUBMISSION}', '${COMPANY}', '${PROJECT}', 'approved', 'Final films',
            'https://example.test/gallery', 'link', 'Open your gallery', now());
    insert into crm_webhook_sources (company_id, source_key, label, kind)
    values ('${COMPANY}', 'src-key', 'Website', 'webform');
    insert into referral_campaigns (id, company_id, name, slug)
    values ('${CAMPAIGN}', '${COMPANY}', 'Refer', 'refer-x');
    insert into team_terms_sends (id, company_id, user_id, rendered_body, recipient_name)
    values ('${SEND}', '${COMPANY}', '${OWNER}', 'Crew terms', 'Crew Member');
  `)

  const mint = (purpose: string, subject: string, raw: string) =>
    db.exec(`insert into access_tokens (company_id, purpose, subject_id, token_hash)
             values ('${COMPANY}', '${purpose}', '${subject}',
                     encode(sha256(convert_to('${raw}', 'UTF8')), 'hex'));`)
  await mint('quotation', QUOTE, 'qtok')
  await mint('receipt', PAYMENT, 'rtok')
  await mint('terms_ack', TERMS, 'ttok')
  await mint('quote_accept', CRM_QUOTE, 'qatok')
  await mint('work_delivery', SUBMISSION, 'dtok')
  await mint('team_terms', SEND, 'tttok')
}, 120_000)

const one = async (sql: string): Promise<Record<string, unknown>> => {
  const r = await db.query<Record<string, unknown>>(sql)
  expect(r.rows.length, `expected a row from: ${sql}`).toBe(1)
  return r.rows[0]!
}

describe('client-facing document readers', () => {
  it('the quotation reader returns the document, not an error', async () => {
    const row = await one(`select * from get_quotation_for_token('qtok')`)
    // Letterhead: a document a client keeps has to say who issued it.
    expect(row['company_name']).toBe('Studio Ltd')
    expect(row['company_legal_name']).toBe('Studio Private Ltd')
    expect(row['company_website']).toBe('studio.in')
    expect(row['document_footer_note']).toBe('Thanks for your business')
    expect(row['gstin']).toBe('27AAAAA0000A1Z5')
    // Bill-to.
    expect(row['client_name']).toBe('A Client')
    expect(row['client_phone']).toBe('8888888888')
    expect(row['client_address']).toBe('12 Road')
    // Identity.
    expect(String(row['quotation_number'])).toMatch(/^Q-[0-9A-F]{8}$/)
    expect(row['issued_at']).toBeTruthy()
  })

  it('the quotation carries both deliverable lists and the money', async () => {
    const row = await one(`select * from get_quotation_for_token('qtok')`)
    // These four were in the contract and rendered by the page, but the
    // function never returned them, so the sections could not appear.
    const primary = row['deliverables'] as Array<Record<string, unknown>>
    const extra = row['deliverables_2'] as Array<Record<string, unknown>>
    expect(primary.map((d) => d['title'])).toEqual(['Album'])
    expect(extra.map((d) => d['title'])).toEqual(['Drone reel'])
    expect(extra[0]!['is_additional_charge']).toBe(true)
    expect(Number(extra[0]!['additional_charge_amount'])).toBe(15000)
    expect(Number(row['total_received'])).toBe(25000)
    // package 100000 + the 15000 add-on, less the 25000 already paid.
    expect(Number(row['balance_due'])).toBe(90000)
    expect(row['quotation_id']).toBe(QUOTE)
  })

  it('the receipt reader returns the document, not an error', async () => {
    const row = await one(`select * from get_receipt_for_token('rtok')`)
    expect(Number(row['amount'])).toBe(25000)
    expect(row['company_legal_name']).toBe('Studio Private Ltd')
    expect(row['client_phone']).toBe('8888888888')
    // 0170: a receipt number in the financial year's series, not the row's id.
    expect(String(row['receipt_number'])).toMatch(/^RCP-\d{4}-\d{2}-\d{4}$/)
    expect(Number(row['received_total'])).toBe(25000)
  })

  it('the terms reader returns the document, not an error', async () => {
    const row = await one(`select * from get_terms_payload_for_token('ttok')`)
    expect(row['body']).toBe('Body text')
    expect(row['company_legal_name']).toBe('Studio Private Ltd')
    expect(row['client_email']).toBe('c@example.test')
    expect(String(row['document_number'])).toMatch(/^T-[0-9A-F]{8}$/)
  })

  it('counts a view, which is why these cannot be declared stable', async () => {
    // The readers bump access_count. Postgres refuses "UPDATE is not allowed in
    // a non-volatile function", so being STABLE made every call throw.
    const before = await one(`select access_count from project_quotations where id = '${QUOTE}'`)
    await db.query(`select * from get_quotation_for_token('qtok')`)
    const after = await one(`select access_count from project_quotations where id = '${QUOTE}'`)
    expect(Number(after['access_count'])).toBe(Number(before['access_count']) + 1)
  })

  it('the delivery reader returns the handover note, not an error', async () => {
    const row = await one(`select * from get_delivery_for_token('dtok')`)
    expect(row['submission_link']).toBe('https://example.test/gallery')
    expect(row['delivery_label']).toBe('Open your gallery')
    expect(row['company_name']).toBe('Studio Ltd')
    expect(row['company_legal_name']).toBe('Studio Private Ltd')
    expect(row['client_name']).toBe('A Client')
  })

  it('the quote checkout reader returns the quote', async () => {
    // Client-facing and money-carrying, so it is covered here even though it
    // reads through a different helper than the four document readers.
    const row = await one(`select get_quote_for_token('qatok') as q`)
    const q = row['q'] as Record<string, unknown>
    expect(q['quote_number']).toBe('Q-1')
    expect(q['studio']).toBe('Studio')
    expect(q['client_name']).toBe('A Lead')
  })

  /**
   * The other half of the public surface. A document that renders but an action
   * that throws means the client can read the quote and not accept it — or a
   * website form posts leads into a void.
   */
  describe('sessionless actions', () => {
    it('a client can accept and decline', async () => {
      await db.query(`select respond_to_quotation('qtok', true, 'Client Name', '1.2.3.4', 'UA')`)
      await db.query(`select accept_quote('qatok', 'Client Name', 'c@example.test', '1.2.3.4', 'UA')`)
      await db.query(`select decline_quote('qatok', 'changed mind')`)
      const row = await one(`select accepted_by_name from project_quotations where id = '${QUOTE}'`)
      expect(row['accepted_by_name']).toBe('Client Name')
    })

    it('a client can agree to terms', async () => {
      await db.query(`select acknowledge_terms('ttok', 'Client Name', 'c@example.test', '1.2.3.4', 'UA')`)
      const row = await one(`select acknowledged_by_name from project_terms_documents where id = '${TERMS}'`)
      expect(row['acknowledged_by_name']).toBe('Client Name')
    })

    it('a website form can post a lead', async () => {
      // Every web form and Meta lead ad arrives through capture_lead.
      await db.query(`select capture_lead('src-key', 'Web Lead', '9876543210', 'w@example.test', '{}'::jsonb)`)
      const row = await one(`select count(*)::int as n from crm_leads where name = 'Web Lead'`)
      expect(Number(row['n'])).toBe(1)
    })

    it('a referral page loads and accepts a submission', async () => {
      const camp = await one(`select get_public_referral_campaign('refer-x') as c`)
      expect(camp['c']).toBeTruthy()
      await db.query(
        `select submit_referral('${CAMPAIGN}', 'Referrer', '9999999999', 'Friend', '8888888888',
                                'f@example.test', 'notes', 'wedding', current_date, 2)`,
      )
    })

    it('crew can acknowledge team terms by either arity', async () => {
      // 0097 added a defaulted 5th parameter without dropping the 4-arg
      // version, so both existed and the short form raised "is not unique".
      await db.query(`select acknowledge_team_terms('tttok', 'Crew Member', '1.2.3.4', 'UA')`)
      const row = await one(`select acknowledged_by_name from team_terms_sends where id = '${SEND}'`)
      expect(row['acknowledged_by_name']).toBe('Crew Member')
    })
  })

  it('refuses an unknown token without raising', async () => {
    for (const fn of [
      'get_quotation_for_token',
      'get_receipt_for_token',
      'get_delivery_for_token',
      'get_terms_payload_for_token',
    ]) {
      const r = await db.query(`select * from ${fn}('no-such-token')`)
      expect(r.rows.length, `${fn} should return no rows for a bad token`).toBe(0)
    }
  })
})
