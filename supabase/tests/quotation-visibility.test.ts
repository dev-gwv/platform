import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Quotation links (0190): the studio's "Show to client" switch reaches links
 * already sent, a hidden link gives away nothing but the fact it is hidden,
 * and a link issued without terms or display choices shows the project's own.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'd0000000-0000-4000-8000-000000000001'
const COMPANY = 'd0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'd0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'd0000000-0000-4000-8000-0000000000b1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');
    insert into companies (id, name, owner_user_id, quote_number_prefix) values ('${COMPANY}', 'Studio', '${OWNER}', 'QT-');
    insert into users (user_id, company_id, role, name, email)
      values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, quotation_terms, quotation_display_prefs)
      values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000,
              'Project clause one' || chr(10) || 'Project clause two', '{"showTerms":true,"showBillTo":false}');
    insert into company_theme_settings (company_id, preset_key, is_custom_theme, primary_color)
      values ('${COMPANY}', 'ipc_classic', true, '#123456')
      on conflict (company_id) do update set is_custom_theme = true, primary_color = '#123456';
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

beforeEach(async () => {
  await db.exec(`update projects set show_quotation = true where id = '${PROJECT}';`)
})

const issue = async () =>
  one<{ quotation_id: string; token: string }>(`select * from issue_project_quotation('${PROJECT}')`)
const read = (token: string) => q<Record<string, unknown>>(`select * from get_quotation_for_token('${token}')`)

describe('the Show to client switch', () => {
  it('shows the quotation while it is on', async () => {
    const { token } = await issue()
    const [row] = await read(token)
    expect(row!['show_quotation']).toBe(true)
    expect(row!['client_name']).toBe('Sharma')
    expect(Number((row!['snapshot'] as { total: number }).total)).toBe(200000)
  })

  it('hides a link that was already sent, and gives nothing else away', async () => {
    const { token } = await issue()
    await db.exec(`update projects set show_quotation = false where id = '${PROJECT}';`)
    const rows = await read(token)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row['show_quotation']).toBe(false)
    expect(row['company_name']).toBe('Studio')
    expect(row['client_name']).toBeNull()
    expect(row['terms_text']).toBeNull()
    expect(row['deliverables']).toEqual([])
    expect(Number((row['snapshot'] as { total: number }).total)).toBe(0)
  })

  it('refuses an answer through a hidden link', async () => {
    const { token, quotation_id } = await issue()
    await db.exec(`update projects set show_quotation = false where id = '${PROJECT}';`)
    const { ok } = await one<{ ok: boolean }>(`select respond_to_quotation('${token}', true, 'Priya') as ok`)
    expect(ok).toBe(false)
    const { accepted_at } = await one<{ accepted_at: string | null }>(
      `select accepted_at from project_quotations where id = '${quotation_id}'`,
    )
    expect(accepted_at).toBeNull()
  })

  it('shows it again when switched back on', async () => {
    const { token } = await issue()
    await db.exec(`update projects set show_quotation = false where id = '${PROJECT}';`)
    await db.exec(`update projects set show_quotation = true where id = '${PROJECT}';`)
    const [row] = await read(token)
    expect(row!['show_quotation']).toBe(true)
    expect(row!['client_name']).toBe('Sharma')
  })
})

describe('what the link carries', () => {
  it('falls back to the project terms and display choices', async () => {
    const { token } = await issue()
    const [row] = await read(token)
    expect(row!['terms_text']).toBe('Project clause one\nProject clause two')
    expect(row!['display_prefs']).toEqual({ showTerms: true, showBillTo: false })
  })

  it('keeps what was sent with the link', async () => {
    const { token, quotation_id } = await issue()
    await db.exec(`update project_quotations
                      set terms_text = 'Sent clause', display_prefs = '{"showTerms":false}',
                          shoots_schedule = '[{"title":"Haldi","date":"2026-12-01","city":"Jaipur","services":[{"name":"Drone","quantity":2}]}]'
                    where id = '${quotation_id}';`)
    const [row] = await read(token)
    expect(row!['terms_text']).toBe('Sent clause')
    expect(row!['display_prefs']).toEqual({ showTerms: false })
    expect(row!['shoots_schedule']).toEqual([
      { title: 'Haldi', date: '2026-12-01', city: 'Jaipur', services: [{ name: 'Drone', quantity: 2 }] },
    ])
  })

  it('numbers the quotation by project and carries the brand colour', async () => {
    const { token } = await issue()
    const [row] = await read(token)
    expect(row!['quotation_number']).toBe(`QT-${PROJECT.slice(0, 8).toUpperCase()}`)
    expect(row!['brand_color']).toBe('#123456')
  })
})
