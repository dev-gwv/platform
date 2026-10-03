import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The enquiry form builder (0240): a form's own fields are the rule, on
 * the server too, and a field the form does not ask is never written.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e2000000-0000-4000-8000-000000000001'
const OTHER = 'e2000000-0000-4000-8000-000000000002'
const COMPANY = 'e2000000-0000-4000-8000-0000000000aa'
const COMPANY_B = 'e2000000-0000-4000-8000-0000000000bb'

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
    const [row] = await q<Form>(`select * from create_enquiry_form('Website')`)
    return row!
  })
})

describe('enquiry form builder (0240)', () => {
  it('lets the studio set its own fields, and only the known ones', async () => {
    await asUser(OWNER, () =>
      q(`update enquiry_forms set purpose = 'website', fields = fields || '{"budget":"required","city":"off"}', accent = 'rose' where id = $1`, [form.id]),
    )
    await asUser(OWNER, () => expect(q(`update enquiry_forms set fields = '{"shoe_size":"required"}' where id = $1`, [form.id])).rejects.toThrow())
    await asUser(OWNER, () => expect(q(`update enquiry_forms set fields = '{"city":"maybe"}' where id = $1`, [form.id])).rejects.toThrow())
    await asUser(OWNER, () => expect(q(`update enquiry_forms set accent = 'neon' where id = $1`, [form.id])).rejects.toThrow())
  })

  it('shows the words and fields on the public form', async () => {
    const [row] = await q<{ purpose: string; accent: string; fields: Record<string, string> }>(`select * from enquiry_form_public($1)`, [form.code])
    expect(row!.purpose).toBe('website')
    expect(row!.accent).toBe('rose')
    expect(row!.fields.budget).toBe('required')
  })

  it('refuses a send without a required field, and drops a field the form does not ask', async () => {
    await expect(
      q(`select * from enquiry_form_submit($1, 'Asha', '9811100000', null, null, null, 'Pune', null, null)`, [form.code]),
    ).rejects.toThrow(/budget/)
    const [sent] = await q<{ lead_id: string }>(
      `select * from enquiry_form_submit($1, 'Asha', '9811100000', null, 'Wedding', null, 'Pune', null, 250000)`,
      [form.code],
    )
    const [lead] = await q<{ city: string | null; deal_value: string; event_type: string }>(
      `select city, deal_value, event_type from crm_leads where id = $1`,
      [sent!.lead_id],
    )
    expect(lead!.city).toBeNull()
    expect(Number(lead!.deal_value)).toBe(250000)
    expect(lead!.event_type).toBe('Wedding')
  })
})
