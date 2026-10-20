import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0274: the main form with WhatsApp after sending, services and guests,
 * partner QR codes (0195's vendor forms moved over), and the same number
 * twice making one lead with a note.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e7000000-0000-4000-8000-000000000001'
const STAFF = 'e7000000-0000-4000-8000-000000000002'
const COMPANY = 'e7000000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const asUser = async <T>(user: string, fn: () => Promise<T>): Promise<T> => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role;`)
  }
}

type Form = { id: string; code: string; slug: string; is_main: boolean }
type Sent = { errors?: Record<string, string>; lead_id?: string; created?: boolean; wa_phone?: string; wa_text?: string; redirect_url?: string }
const send = async (key: string, data: Record<string, unknown>, partner: string | null = null) => {
  const [r] = await q<{ doc: Sent }>(`select enquiry_submit($1, $2, $3::jsonb) as doc`, [key, partner, JSON.stringify(data)])
  return r!.doc
}

let vendorCode = ''
let main: Form

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
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  const at = files.findIndex((f) => f.startsWith('0274_'))
  for (const f of files.slice(0, at)) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'asha@studio.test'), ('${STAFF}', 'ravi@studio.test');
    insert into companies (id, name, owner_user_id, city) values ('${COMPANY}', 'Asha Studio', '${OWNER}', 'Jaipur');
    insert into users (user_id, company_id, role, name, email, phone) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha Rao', 'asha@studio.test', '98769 21126'),
      ('${STAFF}', '${COMPANY}', 'employee', 'Ravi', 'ravi@studio.test', null);
    grant select on crm_webhook_sources, crm_leads to authenticated;
  `)
  // A vendor QR made before 0274, with a lead and a page link.
  vendorCode = await asUser(OWNER, async () => {
    const [f] = await q<{ id: string; code: string }>(`select id, code from create_enquiry_form('Riya Boutique', 'Boutique', '9812345670')`)
    await q(`select enquiry_form_set_page($1, 'oldpagetoken_abcdefghijkl')`, [f!.id])
    return f!.code
  })
  await q(`select * from enquiry_form_submit($1, 'Meera Joshi', '9810000001', null, 'Wedding', null, null, null, null)`, [vendorCode])

  for (const f of files.slice(at)) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  main = (await q<Form>(`select id, code, slug, is_main from enquiry_forms where company_id = $1 and is_main`, [COMPANY]))[0]!
})

describe('vendor forms become partners (0274)', () => {
  it('keeps the code, the page link and the lead credit', async () => {
    const [p] = await q<{ id: string; name: string; label: string; view_token: string }>(
      `select id, name, label, view_token from enquiry_partners where code = $1`,
      [vendorCode],
    )
    expect(p!.name).toBe('Riya Boutique')
    expect(p!.label).toBe('Boutique')
    expect(p!.view_token).toBe('oldpagetoken_abcdefghijkl')
    const [lead] = await q<{ partner_id: string }>(`select partner_id from crm_leads where name = 'Meera Joshi'`)
    expect(lead!.partner_id).toBe(p!.id)
    const [old] = await q<{ archived_at: string | null }>(`select archived_at from enquiry_forms where code = $1`, [vendorCode])
    expect(old!.archived_at).not.toBeNull()
  })

  it('makes one main form with a readable link', async () => {
    expect(main.is_main).toBe(true)
    expect(main.slug).toMatch(/^asha-studio-[0-9a-f]{6}$/)
  })

  it('opens the old printed QR as the main form, sent via the partner, and counts the scan', async () => {
    const [r] = await q<{ doc: { partner: string; studio: string; goes_to: string } }>(`select enquiry_public($1) as doc`, [vendorCode])
    expect(r!.doc.partner).toBe('Riya Boutique')
    expect(r!.doc.studio).toBe('Asha Studio')
    expect(r!.doc.goes_to).toBe('whatsapp')
    const [p] = await q<{ scans: number }>(`select scans from enquiry_partners where code = $1`, [vendorCode])
    expect(p!.scans).toBeGreaterThanOrEqual(1)
  })
})

describe('the main form (0274)', () => {
  it('asks email, event, date and anything else by default', async () => {
    const [f] = await q<{ fields: Record<string, string> }>(`select fields from enquiry_forms where id = $1`, [main.id])
    // This studio had only a vendor form, so its main form is new and takes the spec's questions.
    expect(f!.fields.email).toBe('optional')
    expect(f!.fields.city).toBe('off')
    expect(f!.fields.services).toBe('off')
  })

  it('refuses a link that is not https', async () => {
    await expect(q(`update enquiry_forms set after_submit = 'link', redirect_url = 'http://x.test' where id = $1`, [main.id])).rejects.toThrow()
    await expect(q(`update enquiry_forms set after_submit = 'link', redirect_url = 'javascript:alert(1)' where id = $1`, [main.id])).rejects.toThrow()
    await expect(q(`update enquiry_forms set after_submit = 'link', redirect_url = null where id = $1`, [main.id])).rejects.toThrow()
  })

  it('says what to fix, field by field', async () => {
    await q(`update enquiry_forms set fields = fields || '{"email":"required","services":"optional","city":"optional"}' where id = $1`, [main.id])
    const r = await send(main.slug, { name: 'A', phone: '12345' })
    expect(r.errors).toEqual({ name: 'Enter your name', phone: 'Enter a valid 10-digit mobile number', email: 'Please fill this in' })
  })

  it('makes a lead due now, keeps only the studio\'s services, and writes the WhatsApp message', async () => {
    const r = await send(main.code, {
      name: 'Priya Sharma',
      phone: '+91 98111 22233',
      email: 'priya@test.in',
      event_type: 'Wedding',
      event_date: '2027-02-14',
      city: 'Jaipur',
      services: ['drone', 'Photography', 'Made up thing', 'DRONE'],
      budget: 500000,
      guests: 300,
      message: 'Two days',
    })
    expect(r.errors).toBeUndefined()
    expect(r.created).toBe(true)
    expect(r.wa_phone).toBe('919876921126')
    expect(r.wa_text).toBe(
      'Hi Asha Studio! I just sent you an enquiry.\n\nName: Priya Sharma\nEvent: Wedding, 14 Feb 2027\nCity: Jaipur\nLooking for: Photography, Drone',
    )
    const [lead] = await q<{ phone: string; notes: string; deal_value: string | null; follow_up_at: string; email: string; partner_id: string | null }>(
      `select phone, notes, deal_value, follow_up_at, email, partner_id from crm_leads where id = $1`,
      [r.lead_id],
    )
    expect(lead!.phone).toBe('+919811122233')
    expect(lead!.notes).toBe('Looking for: Photography, Drone\nTwo days')
    expect(lead!.deal_value).toBeNull() // budget is off on this form
    expect(lead!.email).toBe('priya@test.in')
    expect(lead!.partner_id).toBeNull()
    const [n] = await q<{ title: string; body: string }>(`select title, body from notifications where entity_id = $1 and type = 'enquiry_new'`, [r.lead_id])
    expect(n!.title).toBe('New enquiry: Priya Sharma')
    expect(n!.body).toBe('Wedding · 14 Feb 2027 · Jaipur')
  })

  it('makes no second lead for the same number while it is open, and tells whoever has it', async () => {
    const r = await send(main.slug, { name: 'Priya S', phone: '09811122233', email: 'p@test.in', message: 'Also a reception' })
    expect(r.created).toBe(false)
    const [{ n }] = (await q<{ n: number }>(`select count(*)::int as n from crm_leads where right(phone_norm, 10) = '9811122233'`)) as [{ n: number }]
    expect(n).toBe(1)
    const [note] = await q<{ subject: string; body: string }>(`select subject, body from crm_activities where lead_id = $1 and type = 'note'`, [r.lead_id])
    expect(note!.subject).toBe('Enquired again')
    expect(note!.body).toContain('Also a reception')
    const alerts = await q<{ title: string }>(`select title from notifications where type = 'enquiry_again'`)
    expect(alerts[0]!.title).toBe('Enquired again: Priya Sharma')
  })

  it('credits a live partner, not an archived one', async () => {
    const partner = await asUser(OWNER, async () => {
      const [p] = await q<{ id: string; code: string; view_token: string | null }>(
        `select id, code, view_token from create_enquiry_partner('Kiran Florist', 'Decorator, Florist', '9812300000', null, null, 'kirantoken_abcdefghijklmnop')`,
      )
      return p!
    })
    await expect(asUser(OWNER, () => q(`select create_enquiry_partner('kiran florist')`))).rejects.toThrow(/already have a partner/)
    const r = await send(main.slug, { name: 'Neha Gupta', phone: '9822200011', email: 'n@test.in' }, partner.code)
    const [lead] = await q<{ partner_id: string }>(`select partner_id from crm_leads where id = $1`, [r.lead_id])
    expect(lead!.partner_id).toBe(partner.id)

    const page = (await q<{ doc: { leads: { phone: string; email: string | null; status: string }[]; enquiries: number } }>(`select enquiry_partner_page('kirantoken_abcdefghijklmnop') as doc`))[0]!.doc
    expect(page.enquiries).toBe(1)
    // 0276: partners see each lead's real number and email unless the studio hides them.
    expect(page.leads[0]!.phone).toBe('+919822200011')
    expect(page.leads[0]!.email).toBe('n@test.in')
    expect(page.leads[0]!.status).toBe('New')

    await q(`update enquiry_partners set archived_at = now() where id = $1`, [partner.id])
    const r2 = await send(main.slug, { name: 'Tara', phone: '9822200099', email: 't@test.in' }, partner.code)
    const [lead2] = await q<{ partner_id: string | null }>(`select partner_id from crm_leads where id = $1`, [r2.lead_id])
    expect(lead2!.partner_id).toBeNull()
    const [gone] = await q<{ doc: unknown }>(`select enquiry_partner_page('kirantoken_abcdefghijklmnop') as doc`)
    expect(gone!.doc).toBeNull()
  })

  it('shows nothing when the form is switched off', async () => {
    await q(`update enquiry_forms set is_active = false where id = $1`, [main.id])
    const [r] = await q<{ doc: unknown }>(`select enquiry_public($1) as doc`, [main.slug])
    expect(r!.doc).toBeNull()
    await expect(send(main.slug, { name: 'Late', phone: '9833300000' })).rejects.toThrow(/not taking/)
    await q(`update enquiry_forms set is_active = true where id = $1`, [main.id])
  })
})
