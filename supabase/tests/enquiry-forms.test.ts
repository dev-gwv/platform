import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Enquiry forms (0195): one QR per vendor. A submission becomes a lead
 * credited to that QR, a repeat number is not a second lead, and the vendor's
 * page shows what their QR brought in with the phone masked.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e0000000-0000-4000-8000-000000000001'
const OTHER = 'e0000000-0000-4000-8000-000000000002'
const COMPANY = 'e0000000-0000-4000-8000-0000000000aa'
const COMPANY_B = 'e0000000-0000-4000-8000-0000000000bb'

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

type Form = { id: string; code: string; source_id: string }
let form: Form

const submit = (code: string, name: string, phone: string, extra: Partial<Record<string, string>> = {}) =>
  q<{ lead_id: string; created: boolean }>(
    `select * from enquiry_form_submit($1, $2, $3, null, $4, $5::date, $6, $7)`,
    [code, name, phone, extra.event_type ?? null, extra.event_date ?? null, extra.city ?? null, extra.message ?? null],
  )

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
    insert into auth.users (id, email) values ('${OWNER}', 'asha@studio.test'), ('${OTHER}', 'ravi@other.test');
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Asha Studio', '${OWNER}'), ('${COMPANY_B}', 'Ravi Films', '${OTHER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha Rao', 'asha@studio.test'),
      ('${OTHER}', '${COMPANY_B}', 'super_admin', 'Ravi', 'ravi@other.test');
    -- The live database grants these to every signed-in user (0000, not run here).
    grant select on crm_webhook_sources, crm_leads to authenticated;
  `)
  form = await asUser(OWNER, async () => {
    const [row] = await q<Form>(`select * from create_enquiry_form('Riya Boutique', 'Boutique', '9876500000')`)
    return row!
  })
})

describe('making a form', () => {
  it('gets a short code and its own lead source', async () => {
    expect(form.code).toMatch(/^[a-hj-km-np-z2-9]{7}$/)
    const [src] = await q<{ label: string; source_type: string; default_source: string; is_active: boolean }>(
      `select label, source_type, default_source, is_active from crm_webhook_sources where id = $1`,
      [form.source_id],
    )
    expect(src).toEqual({ label: 'Riya Boutique', source_type: 'enquiry_form', default_source: 'enquiry', is_active: true })
  })

  it('a name is required', async () => {
    await asUser(OWNER, () => expect(q(`select create_enquiry_form('  ')`)).rejects.toThrow(/name/))
  })
})

describe('the public form', () => {
  it('opening it counts a scan and names the studio', async () => {
    const [row] = await q<{ studio: string; form_name: string; is_open: boolean }>(
      `select * from enquiry_form_public($1)`,
      [form.code.toUpperCase()],
    )
    expect(row).toEqual({ studio: 'Asha Studio', form_name: 'Riya Boutique', is_open: true })
    expect((await q<{ scans: number }>(`select scans from enquiry_forms where id = $1`, [form.id]))[0]!.scans).toBe(1)
  })

  it('a submission is a lead credited to the QR, due today, with the event details', async () => {
    const [r] = await submit(form.code, 'Neha Sharma', '+91 98765 43210', {
      event_type: 'Wedding',
      event_date: '2027-02-14',
      city: 'Jaipur',
      message: 'Two-day wedding',
    })
    expect(r!.created).toBe(true)
    const [lead] = await q<Record<string, unknown>>(
      `select l.source, l.source_key = s.source_key as credited, l.event_type, l.event_date::text as event_date,
              l.city, l.notes, l.follow_up_at is not null as due, l.source_meta->>'form_name' as form_name
         from crm_leads l, crm_webhook_sources s where l.id = $1 and s.id = $2`,
      [r!.lead_id, form.source_id],
    )
    expect(lead).toEqual({
      source: 'enquiry',
      credited: true,
      event_type: 'Wedding',
      event_date: '2027-02-14',
      city: 'Jaipur',
      notes: 'Two-day wedding',
      due: true,
      form_name: 'Riya Boutique',
    })
  })

  it('the same number again is not a second lead, and the first is left alone', async () => {
    const [r] = await submit(form.code, 'Neha S', '9876543210', { city: 'Delhi' })
    expect(r!.created).toBe(false)
    const rows = await q<{ city: string }>(`select city from crm_leads where phone_norm = crm_normalize_phone('9876543210')`)
    expect(rows).toEqual([{ city: 'Jaipur' }])
  })

  it('a switched-off form takes no enquiries and counts no scans', async () => {
    await db.exec(`update enquiry_forms set is_active = false where id = '${form.id}'`)
    try {
      await expect(submit(form.code, 'Late', '9000000001')).rejects.toThrow(/not taking/)
      const [row] = await q<{ is_open: boolean }>(`select is_open from enquiry_form_public($1)`, [form.code])
      expect(row!.is_open).toBe(false)
      const [src] = await q<{ is_active: boolean }>(`select is_active from crm_webhook_sources where id = $1`, [
        form.source_id,
      ])
      expect(src!.is_active).toBe(false)
    } finally {
      await db.exec(`update enquiry_forms set is_active = true where id = '${form.id}'`)
    }
  })
})

describe("the vendor's page", () => {
  const raw = 'vendor-page-token-for-riya'
  const hash = createHash('sha256').update(raw).digest('hex')

  it('is off until the studio makes a link', async () => {
    expect((await q<{ p: unknown }>(`select enquiry_form_page($1) as p`, [raw]))[0]!.p).toBeNull()
  })

  it('lists the leads with the phone masked and plain statuses', async () => {
    await asUser(OWNER, () => q(`select enquiry_form_set_page($1, $2)`, [form.id, hash]))
    const [{ p }] = (await q<{ p: Record<string, unknown> }>(`select enquiry_form_page($1) as p`, [raw])) as [
      { p: Record<string, unknown> },
    ]
    expect(p).toMatchObject({ studio: 'Asha Studio', form_name: 'Riya Boutique', enquiries: 1, booked: 0 })
    expect(p.leads).toEqual([
      expect.objectContaining({ name: 'Neha Sharma', phone: '98xxxxx210', status: 'New', event_type: 'Wedding' }),
    ])
  })

  it('shows the full number when the studio allows it', async () => {
    await db.exec(`update enquiry_forms set show_phone = true where id = '${form.id}'`)
    const [{ p }] = (await q<{ p: { leads: { phone: string }[] } }>(`select enquiry_form_page($1) as p`, [raw])) as [
      { p: { leads: { phone: string }[] } },
    ]
    expect(p.leads[0]!.phone).toBe('+91 98765 43210')
  })

  it('stops working when the link is turned off', async () => {
    await asUser(OWNER, () => q(`select enquiry_form_set_page($1, null)`, [form.id]))
    expect((await q<{ p: unknown }>(`select enquiry_form_page($1) as p`, [raw]))[0]!.p).toBeNull()
  })
})

describe('who may see what', () => {
  it('the studio sees its numbers; another studio sees nothing and cannot touch it', async () => {
    const mine = await asUser(OWNER, () =>
      q<{ enquiries: number }>(`select enquiries from enquiry_form_stats where form_id = $1`, [form.id]),
    )
    expect(mine).toEqual([{ enquiries: 1 }])
    await asUser(OTHER, async () => {
      expect(await q(`select * from enquiry_forms`)).toEqual([])
      expect(await q(`select * from enquiry_form_stats`)).toEqual([])
      expect((await q<{ ok: boolean }>(`select enquiry_form_set_page($1, null) as ok`, [form.id]))[0]!.ok).toBe(false)
    })
  })

  it('a signed-in user cannot call the public functions directly or repoint the source', async () => {
    await asUser(OWNER, async () => {
      await expect(q(`select * from enquiry_form_public($1)`, [form.code])).rejects.toThrow(/permission denied/)
      await expect(submit(form.code, 'X', '9000000002')).rejects.toThrow(/permission denied/)
      await expect(q(`update enquiry_forms set source_id = gen_random_uuid()`)).rejects.toThrow(/permission denied/)
    })
  })
})
