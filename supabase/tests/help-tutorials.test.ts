import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Help & Tutorials (0236): support contacts on platform_settings, the
 * questions Help answers, and per-page video links. Seeded once; the
 * checks keep a bad number, email, link or page key out.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

let db: PGlite
const fails = async (sql: string) => {
  await expect(db.exec(sql)).rejects.toThrow()
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
})

describe('help & tutorials (0236)', () => {
  it('seeds the first questions, including who can see a studio’s data', async () => {
    const r = await db.query<{ question: string }>(`select question from help_faqs order by sort_order`)
    expect(r.rows.length).toBe(7)
    expect(r.rows[0]!.question).toMatch(/see my clients and prices/)
  })

  it('does not seed again over an edited list', async () => {
    await db.exec(`delete from help_faqs where sort_order > 10`)
    const sql = readFileSync(join(migDir, '0236_help_tutorials.sql'), 'utf8')
    await db.exec(sql)
    const r = await db.query<{ n: number }>(`select count(*)::int as n from help_faqs`)
    expect(r.rows[0]!.n).toBe(1)
  })

  it('keeps support contacts in shape', async () => {
    await db.exec(`update platform_settings set support_whatsapp = '919876543210', support_email = 'help@studioautopilot.in'`)
    await fails(`update platform_settings set support_whatsapp = '+91 98765'`)
    await fails(`update platform_settings set support_email = 'not an email'`)
  })

  it('takes only https video links and plain page keys', async () => {
    await db.exec(`insert into help_videos (page_key, title, url) values ('invoices', 'Send an invoice', 'https://cdn.example.com/a.mp4')`)
    await fails(`insert into help_videos (page_key, title, url) values ('quotes', 'Quote', 'http://cdn.example.com/a.mp4')`)
    await fails(`insert into help_videos (page_key, title, url) values ('Bad Key', 'Quote', 'https://cdn.example.com/a.mp4')`)
  })

  it('is closed to studios: only the service reads or writes it', async () => {
    await db.exec(`set role authenticated`)
    await fails(`select * from help_faqs`)
    await fails(`select * from help_videos`)
    await db.exec(`reset role`)
  })
})
