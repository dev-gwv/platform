import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { cleanLead, type RawLead } from '../../services/api/src/lib/lead-fields'

/**
 * No lead is lost to how its phone was typed.
 *
 * A captured lead also becomes a CRM contact (crm_link_contact, 0045), and
 * crm_contacts caps phone at 30 characters (crm_contacts_phone_check). Meta's
 * Lead Ads Testing Tool fills the phone with "<test lead: dummy data for
 * phone_number>" -- 40 characters -- so every test lead failed with 23514 and
 * was dropped, while Meta reported the delivery a success. The API now cleans
 * the phone first (lib/lead-fields.ts); this runs each case through the real
 * capture_lead and the contact trigger the way the webhook does.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'd1000000-0000-4000-8000-000000000001'
const COMPANY = 'd1000000-0000-4000-8000-0000000000c1'
const KEY = 'meta_phone_test'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows

/** What captureLead() in the webhook router does: clean, then capture_lead. */
const capture = async (raw: RawLead) => {
  const l = cleanLead(raw)
  const [r] = await q<{ id: string }>(`select capture_lead($1, $2, $3, $4, $5::jsonb) as id`, [KEY, l.name, l.phone, l.email, JSON.stringify(l.meta)])
  return { id: r!.id, clean: l }
}

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
    insert into crm_webhook_sources (company_id, source_key, kind, label) values ('${COMPANY}', '${KEY}', 'meta', 'Facebook lead ads');
  `)
})

describe('a lead is never dropped because of its phone', () => {
  it('reproduces the bug: the raw Meta placeholder fails the contact check', async () => {
    await expect(
      q(`select capture_lead($1, $2, $3, $4) as id`, [KEY, 'Raw', '<test lead: dummy data for phone_number>', null]),
    ).rejects.toThrow(/crm_contacts_phone_check/)
  })

  it('saves an Indian mobile typed every which way, as one lead', async () => {
    const first = await capture({ name: 'Asha Rao', phone: '+91 98765-43210', email: 'asha@example.com' })
    for (const phone of ['9876543210', '09876543210', '919876543210', '(98765) 43210']) {
      const again = await capture({ name: 'Asha Rao', phone })
      expect(again.id, phone).toBe(first.id) // one number, one lead
    }
    const [row] = await q<{ phone: string; phone_norm: string; contact_id: string | null }>(`select phone, phone_norm, contact_id from crm_leads where id = $1`, [first.id])
    expect(row).toMatchObject({ phone: '+919876543210', phone_norm: '919876543210' })
    expect(row!.contact_id).not.toBeNull()
  })

  it('saves a Meta test lead with a placeholder phone, keeping the raw text', async () => {
    const { id } = await capture({
      name: '<test lead: dummy data for full_name>',
      phone: '<test lead: dummy data for phone_number>',
      email: 'test@fb.com',
      meta: { leadgen_id: '123', page_id: '456' },
    })
    const [row] = await q<{ phone: string | null; email: string; meta: Record<string, unknown> }>(`select phone, email, source_meta as meta from crm_leads where id = $1`, [id])
    expect(row!.phone).toBeNull()
    expect(row!.email).toBe('test@fb.com')
    expect(row!.meta).toMatchObject({ leadgen_id: '123', raw_phone: '<test lead: dummy data for phone_number>' })
  })

  it('saves a lead with an email and no phone', async () => {
    const { id } = await capture({ name: 'Email Only', phone: '', email: 'only@example.com' })
    const [row] = await q<{ phone: string | null; email: string }>(`select phone, email from crm_leads where id = $1`, [id])
    expect(row).toMatchObject({ phone: null, email: 'only@example.com' })
  })

  it('saves a lead whose phone is junk, and two junk leads stay two leads', async () => {
    const a = await capture({ name: 'Junk A', phone: 'call after 6pm' })
    const b = await capture({ name: 'Junk B', phone: '12' })
    expect(a.id).not.toBe(b.id)
    const rows = await q<{ n: number }>(`select count(*)::int as n from crm_leads where id in ($1, $2) and phone is null`, [a.id, b.id])
    expect(rows[0]!.n).toBe(2)
  })

  it('fits an over-long name and a broken email into the contact', async () => {
    const { id } = await capture({ name: 'N'.repeat(300), phone: '+44 20 7946 0958', email: 'not-an-email' })
    const [row] = await q<{ name: string; email: string | null; phone: string }>(`select name, email, phone from crm_leads where id = $1`, [id])
    expect(row!.name.length).toBe(160)
    expect(row!.email).toBeNull()
    expect(row!.phone).toBe('+442079460958')
  })
})
