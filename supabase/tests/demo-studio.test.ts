import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The reviewer's demo studio (deploy/demo/demo-studio.sql).
 *
 * The seed is plain SQL run by hand on the server, so nothing else would
 * notice a later migration breaking it -- the owner would find out with Meta's
 * reviewers waiting. This runs it against every migration, twice, and checks
 * what a reviewer is promised: a working studio on a 14-day trial, sample leads
 * that are plainly sample and cannot ring, and no pretend Facebook connection.
 *
 * psql's \set and \gset are the wrapper's job; here the two values are put in
 * as text.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migDir = join(here, '..', 'migrations')
const seedSql = readFileSync(join(here, '..', '..', 'deploy', 'demo', 'demo-studio.sql'), 'utf8')

const EMAIL = 'reviewer@example.com'
const HASH_1 = '$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$hash-one-hash-one-hash-one'
const HASH_2 = '$argon2id$v=19$m=65536,t=2,p=1$c2FsdA$hash-two-hash-two-hash-two'
const asRun = (hash: string) =>
  seedSql
    .replaceAll(":'demo_email'", `'${EMAIL}'`)
    .replaceAll(":'pwhash'", `'${hash}'`)
    .replace(/\s\\gset/, ';')

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!
const company = async () =>
  (await one<{ company_id: string }>(`select company_id from users where email = '${EMAIL}'`)).company_id

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
})

describe('the demo studio', () => {
  it('is made by the seed', async () => {
    await db.exec(asRun(HASH_1))
    const co = await one<{ name: string; owner_user_id: string }>(
      `select name, owner_user_id from companies where id = '${await company()}'`,
    )
    expect(co.name).toBe('Demo Studio (sample data)')
  })

  it('gives the owner a verified login and a 14-day trial with nothing else in the way', async () => {
    const u = await one<{ encrypted_password: string; email_verified: boolean }>(
      `select encrypted_password, email_verified from auth.users where email = '${EMAIL}'`,
    )
    expect(u.encrypted_password).toBe(HASH_1)
    expect(u.email_verified).toBe(true)

    const c = await one<{ days: number; plan_expiry: string | null; skipped: boolean; emails_off: boolean }>(
      `select round(extract(epoch from (grandfathered_until - now())) / 86400)::int as days,
              plan_expiry, setup_skipped_at is not null as skipped, onboarding_emails_off as emails_off
         from companies where id = '${await company()}'`,
    )
    expect(c.days).toBe(14)
    expect(c.plan_expiry).toBeNull()
    expect(c.skipped).toBe(true)
    expect(c.emails_off).toBe(true)
  })

  it('holds 14 sample leads in every step, each labelled Sample, none a real person or a ringing number', async () => {
    const co = await company()
    const leads = await q<{ name: string; phone: string; status: string; tags: string[] }>(
      `select l.name, l.phone, l.status,
              array(select t.name from crm_lead_tags lt join crm_tags t on t.id = lt.tag_id where lt.lead_id = l.id) as tags
         from crm_leads l where l.company_id = '${co}'`,
    )
    expect(leads).toHaveLength(14)
    expect(new Set(leads.map((l) => l.status))).toEqual(
      new Set(['new', 'contacted', 'qualified', 'proposal_sent', 'converted', 'lost']),
    )
    for (const l of leads) {
      expect(l.name).toMatch(/\(sample\)$/)
      expect(l.phone).toMatch(/^\+91 00000 /)
      expect(l.tags).toContain('Sample')
    }
  })

  it('has several events on some leads and an import log with every kind of row', async () => {
    const co = await company()
    const multi = await one<{ n: number }>(
      `select count(*)::int as n from (select lead_id from crm_lead_functions where company_id = '${co}' group by lead_id having count(*) > 1) t`,
    )
    expect(multi.n).toBeGreaterThanOrEqual(4)
    const kinds = await q<{ status: string }>(`select distinct status from fb_lead_imports where company_id = '${co}'`)
    expect(kinds.map((k) => k.status).sort()).toEqual(['duplicate', 'failed', 'imported'])
  })

  it('does not pretend a Facebook page is connected', async () => {
    const co = await company()
    expect(await one<{ n: number }>(`select count(*)::int as n from fb_pages where company_id = '${co}'`)).toEqual({ n: 0 })
    expect(await one<{ n: number }>(`select count(*)::int as n from fb_page_tokens where company_id = '${co}'`)).toEqual({ n: 0 })
  })

  it('has teammates who cannot sign in', async () => {
    const co = await company()
    const team = await q<{ login_enabled: boolean; email: string }>(
      `select login_enabled, email from users where company_id = '${co}' and role = 'employee'`,
    )
    expect(team).toHaveLength(2)
    for (const m of team) {
      expect(m.login_enabled).toBe(false)
      expect(m.email).toMatch(/@sample\.invalid$/)
    }
  })
})

describe('running it again', () => {
  it('changes the password, leaves the studio and its leads as they were', async () => {
    const co = await company()
    await db.exec(asRun(HASH_2))
    expect(await company()).toBe(co)
    expect((await one<{ encrypted_password: string }>(`select encrypted_password from auth.users where email = '${EMAIL}'`)).encrypted_password).toBe(HASH_2)
    expect((await one<{ n: number }>(`select count(*)::int as n from crm_leads where company_id = '${co}'`)).n).toBe(14)
    expect((await one<{ n: number }>(`select count(*)::int as n from companies where name = 'Demo Studio (sample data)'`)).n).toBe(1)
  })

  it('refuses something that is not a hash', async () => {
    await expect(db.exec(asRun('plain-password'))).rejects.toThrow(/not hashed/)
  })
})
