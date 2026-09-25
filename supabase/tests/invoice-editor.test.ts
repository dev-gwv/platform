import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The invoice editor (0171): HSN/SAC on each line, files sent with the
 * invoice, and the client reading both through the invoice link -- and
 * nothing from another studio getting in.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e1000000-0000-4000-8000-000000000001'
const OTHER_OWNER = 'e1000000-0000-4000-8000-000000000002'
const COMPANY = 'e1000000-0000-4000-8000-0000000000aa'
const OTHER = 'e1000000-0000-4000-8000-0000000000ab'
const INV = 'e1000000-0000-4000-8000-0000000000c1'
const DRAFT = 'e1000000-0000-4000-8000-0000000000c2'
const FILE = 'e1000000-0000-4000-8000-0000000000f1'
const OTHER_FILE = 'e1000000-0000-4000-8000-0000000000f2'
const RAW = 'raw-invoice-token'
const RAW_DRAFT = 'raw-draft-token'

let db: PGlite
const one = async <T,>(q: string) => (await db.query<T>(q)).rows[0]!

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@e.test'), ('${OTHER_OWNER}', 'x@e.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@e.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@e.test');
    insert into invoices (id, company_id, invoice_number, status, total, balance_due, subject) values
      ('${INV}', '${COMPANY}', 'INV-1', 'sent', 1000, 1000, 'Wedding coverage'),
      ('${DRAFT}', '${COMPANY}', 'INV-2', 'draft', 500, 500, null);
    insert into invoice_items (invoice_id, company_id, description, quantity, rate, amount, sort_order, hsn_sac) values
      ('${INV}', '${COMPANY}', 'Second', 1, 400, 400, 1, '4911'),
      ('${INV}', '${COMPANY}', 'First', 1, 600, 600, 0, '998383');
    insert into files (id, company_id, name, mime, size_bytes, bytes) values
      ('${FILE}', '${COMPANY}', 'quotation.pdf', 'application/pdf', 4, '\\x25504446'),
      ('${OTHER_FILE}', '${OTHER}', 'theirs.pdf', 'application/pdf', 4, '\\x25504446');
    insert into access_tokens (company_id, purpose, subject_id, token_hash) values
      ('${COMPANY}', 'invoice', '${INV}', encode(sha256(convert_to('${RAW}', 'UTF8')), 'hex')),
      ('${COMPANY}', 'invoice', '${DRAFT}', encode(sha256(convert_to('${RAW_DRAFT}', 'UTF8')), 'hex'));
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('invoice attachments', () => {
  it('attaches one of the studio’s own files, filling in the studio', async () => {
    await db.exec(`insert into invoice_attachments (company_id, invoice_id, file_id) values ('${OTHER}', '${INV}', '${FILE}')`)
    const row = await one<{ company_id: string }>(`select company_id from invoice_attachments where invoice_id = '${INV}'`)
    expect(row.company_id).toBe(COMPANY)
  })

  it('refuses another studio’s file', async () => {
    await expect(db.exec(`insert into invoice_attachments (company_id, invoice_id, file_id) values ('${COMPANY}', '${INV}', '${OTHER_FILE}')`)).rejects.toThrow(/file not in this studio/)
  })

  it('refuses attaching to another studio’s invoice', async () => {
    await db.exec(`set request.jwt.claim.sub = '${OTHER_OWNER}';`)
    await expect(db.exec(`insert into invoice_attachments (company_id, invoice_id, file_id) values ('${OTHER}', '${INV}', '${OTHER_FILE}')`)).rejects.toThrow(/invoice not in this studio/)
    await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
  })
})

describe('the invoice link', () => {
  it('carries subject, lines in typed order with HSN/SAC, and the attached file', async () => {
    const doc = (await one<{ d: { invoice: { subject: string; items: { description: string; hsn_sac: string }[]; attachments: { name: string }[] } } }>(
      `select get_invoice_for_token('${RAW}') as d`,
    )).d
    expect(doc.invoice.subject).toBe('Wedding coverage')
    expect(doc.invoice.items.map((i) => `${i.description}:${i.hsn_sac}`)).toEqual(['First:998383', 'Second:4911'])
    expect(doc.invoice.attachments.map((a) => a.name)).toEqual(['quotation.pdf'])
  })

  it('downloads the attached file, and only that file, only through a live link to a sent invoice', async () => {
    expect((await db.query(`select * from invoice_attachment_for_token('${RAW}', '${FILE}')`)).rows).toHaveLength(1)
    expect((await db.query(`select * from invoice_attachment_for_token('${RAW}', '${OTHER_FILE}')`)).rows).toHaveLength(0)
    expect((await db.query(`select * from invoice_attachment_for_token('wrong', '${FILE}')`)).rows).toHaveLength(0)
    await db.exec(`insert into invoice_attachments (company_id, invoice_id, file_id) values ('${COMPANY}', '${DRAFT}', '${FILE}')`)
    expect((await db.query(`select * from invoice_attachment_for_token('${RAW_DRAFT}', '${FILE}')`)).rows).toHaveLength(0)
    await db.exec(`update access_tokens set revoked_at = now() where subject_id = '${INV}'`)
    expect((await db.query(`select * from invoice_attachment_for_token('${RAW}', '${FILE}')`)).rows).toHaveLength(0)
  })
})

describe('saved items', () => {
  it('keeps one name per studio, and only GST slabs', async () => {
    await db.exec(`insert into invoice_item_presets (company_id, name, rate, hsn_sac, gst_rate) values ('${COMPANY}', 'Drone', 15000, '998383', 18)`)
    await expect(db.exec(`insert into invoice_item_presets (company_id, name) values ('${COMPANY}', 'Drone')`)).rejects.toThrow()
    await db.exec(`insert into invoice_item_presets (company_id, name) values ('${OTHER}', 'Drone')`)
    await expect(db.exec(`insert into invoice_item_presets (company_id, name, gst_rate) values ('${COMPANY}', 'Odd', 7)`)).rejects.toThrow()
  })
})
