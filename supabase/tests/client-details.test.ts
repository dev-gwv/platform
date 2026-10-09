import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The details form a client fills (0244): a project's link fills the client,
 * the dates and the shoot days; a project that already has days keeps them
 * and the client's events wait; the studio's own form makes a client and a
 * project, and at the plan's limit still saves the client and the dates.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'f6000000-0000-4000-8000-000000000001'
const A = 'f6000000-0000-4000-8000-0000000000aa'
const B_OWNER = 'f6000000-0000-4000-8000-000000000002'
const B = 'f6000000-0000-4000-8000-0000000000bb'
const PRIYA = 'f6000000-0000-4000-8000-0000000000c1'
const WEDDING = 'f6000000-0000-4000-8000-0000000000d1'
const RAW = 'raw-token-for-priya-0000000000000000'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const asUser = async <T>(uid: string, fn: () => Promise<T>) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
const submit = async (raw: string, payload: object) =>
  (await q<{ r: Record<string, unknown> }>(`select client_details_submit($1, $2::jsonb) as r`, [raw, JSON.stringify(payload)]))[0]!.r

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
  await db.exec(`grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant execute on all functions in schema public, auth to authenticated;`)
  await db.exec(`
    insert into plans (key, name, price, billing_interval, duration_days, is_active, audience, tier, limits)
      values ('two_projects', 'Two', 100, 'yearly', 365, false, 'outsider', 'starter', '{"projects":2}');
    insert into auth.users (id, email) values ('${OWNER}', 'a@s.test'), ('${B_OWNER}', 'b@s.test');
    insert into companies (id, name, owner_user_id, plan, plan_expiry, plan_period_start) values
      ('${A}', 'Asha Studio', '${OWNER}', 'two_projects', now() + interval '200 days', now() - interval '165 days');
    insert into companies (id, name, owner_user_id) values ('${B}', 'Other Studio', '${B_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${A}', 'super_admin', 'Asha', 'a@s.test'), ('${B_OWNER}', '${B}', 'super_admin', 'Bina', 'b@s.test');
    insert into clients (id, company_id, name, email) values ('${PRIYA}', '${A}', 'Priya', 'studio@typed.test');
    insert into projects (id, company_id, client_id, name) values ('${WEDDING}', '${A}', '${PRIYA}', 'Priya Wedding');
  `)
})

describe('the client details form (0244)', () => {
  it('a project link fills blanks, the dates and the shoot days, and rings the bell', async () => {
    await asUser(OWNER, () => q(`select issue_client_details_link($1, $2)`, [WEDDING, hash(RAW)]))
    const form = (await q<{ d: { kind: string; project_name: string; prefill: { email: string } } }>(
      `select client_details_for_token($1) as d`, [RAW]))[0]!.d
    expect(form).toMatchObject({ kind: 'project', project_name: 'Priya Wedding', prefill: { email: 'studio@typed.test' } })

    const r = await submit(RAW, {
      name: 'Priya Sharma', partner_name: 'Rahul Verma', phone: '+91 98765 43210', email: 'priya@mail.test',
      city: 'Jaipur', birthday: { day: 14, month: 3 }, partner_birthday: { day: 2, month: 8, year: 1994 },
      wedding: { day: 12, month: 12, year: 2026 },
      events: [
        { name: 'Haldi', date: '2026-12-11', start_time: '10:00', hours: 4, venue: 'Home' },
        { name: 'Wedding', date: '2026-12-12', start_time: '19:00', hours: 5, guests: 400 },
      ],
    })
    expect(r).toMatchObject({ project_id: WEDDING, project_made: false, days_added: 2, events_waiting: 0 })
    // Guests ride onto the day (0251).
    expect(await q(`select name, guests from shoots where project_id = $1 order by shoot_date`, [WEDDING]))
      .toEqual([{ name: 'Haldi', guests: null }, { name: 'Wedding', guests: 400 }])

    const [c] = await q<Record<string, string>>(`select name, phone, email, city, alternate_phone, notes from clients where id = $1`, [PRIYA])
    expect(c).toMatchObject({ name: 'Priya', phone: '+91 98765 43210', email: 'studio@typed.test', city: 'Jaipur' })
    expect(c!.notes).toContain('Partner: Rahul Verma')

    const dates = await q(`select kind, person_name, day, month, year, source from client_occasions where client_id = $1 order by kind, person_name`, [PRIYA])
    expect(dates).toEqual([
      { kind: 'anniversary', person_name: '', day: 12, month: 12, year: 2026, source: 'client_form' },
      { kind: 'birthday', person_name: 'Priya', day: 14, month: 3, year: null, source: 'client_form' },
      { kind: 'birthday', person_name: 'Rahul', day: 2, month: 8, year: 1994, source: 'client_form' },
    ])
    const days = await q<{ name: string; hours: string }>(
      `select name, to_char(start_at at time zone 'Asia/Kolkata', 'HH24:MI') as at, extract(epoch from end_at - start_at) / 3600 as hours from shoots where project_id = $1 order by shoot_date`,
      [WEDDING],
    )
    expect(days).toMatchObject([{ name: 'Haldi', at: '10:00' }, { name: 'Wedding', at: '19:00' }])
    expect(Number(days[1]!.hours)).toBe(5)
    const bell = await q(`select title, deep_link from notifications where company_id = $1 and type = 'client_details'`, [A])
    expect(bell).toEqual([{ title: 'Priya Sharma sent their details', deep_link: `/projects/${WEDDING}?tab=shoots` }])
  })

  it('a second send keeps the studio’s plan: new events wait, dates the studio typed stay', async () => {
    await q(`update client_occasions set source = 'studio', day = 15 where client_id = $1 and person_name = 'Priya'`, [PRIYA])
    const r = await submit(RAW, {
      name: 'Priya Sharma', birthday: { day: 20, month: 3 },
      events: [
        { name: 'Haldi', date: '2026-12-11' },
        { name: 'Reception', date: '2026-12-13' },
      ],
    })
    expect(r).toMatchObject({ days_added: 0, events_waiting: 1 })
    expect(await q(`select count(*)::int as n from shoots where project_id = $1`, [WEDDING])).toEqual([{ n: 2 }])
    expect(await q(`select day, source from client_occasions where client_id = $1 and person_name = 'Priya'`, [PRIYA])).toEqual([
      { day: 15, source: 'studio' },
    ])
    expect(await q(`select count(*)::int as n from client_detail_submissions where project_id = $1`, [WEDDING])).toEqual([{ n: 2 }])
  })

  it('the studio form makes a client and a project, finds the same phone, and at the limit keeps the client', async () => {
    const code = await asUser(OWNER, async () => (await q<{ c: string }>(`select client_details_studio_code() as c`))[0]!.c)
    expect(await asUser(OWNER, async () => (await q<{ c: string }>(`select client_details_studio_code() as c`))[0]!.c)).toBe(code)
    await expect(submit(code, { name: 'Meera' })).rejects.toThrow(/phone/)

    const first = await submit(code, { name: 'Meera Rao', partner_name: 'Arjun', phone: '99887 76655', events: [{ name: 'Sangeet', date: '2027-01-05' }] })
    expect(first).toMatchObject({ project_made: true, days_added: 1, held: false })
    expect(await q(`select name from projects where id = $1`, [first.project_id])).toEqual([{ name: "Meera & Arjun's Wedding" }])

    // Two projects are now used: the next form saves the client, makes no project.
    const second = await submit(code, { name: 'Meera Rao', phone: '+91 9988776655', wedding: { day: 6, month: 1 } })
    expect(second).toMatchObject({ client_id: first.client_id, project_id: null, project_made: false, held: true })
    expect(await q(`select kind from client_occasions where client_id = $1`, [first.client_id])).toEqual([{ kind: 'anniversary' }])
    const [bell] = await q<{ body: string; severity: string }>(
      `select body, severity from notifications where type = 'client_details' and entity_id = $1`, [first.client_id])
    expect(bell).toMatchObject({ severity: 'warning' })
    expect(bell!.body).toMatch(/^Saved as a client\. No project was made/)
  })

  it('refuses a stopped link and keeps studios apart', async () => {
    const old = await asUser(OWNER, async () => (await q<{ c: string }>(`select client_details_studio_code() as c`))[0]!.c)
    const fresh = await asUser(OWNER, async () => (await q<{ c: string }>(`select client_details_studio_code(true) as c`))[0]!.c)
    expect(fresh).not.toBe(old)
    await expect(submit(old, { name: 'X', phone: '9000000000' })).rejects.toThrow(/not working/)
    expect(await q(`select client_details_for_token('nope') as d`)).toEqual([{ d: null }])
    await expect(asUser(B_OWNER, () => q(`select issue_client_details_link($1, $2)`, [WEDDING, hash('x')]))).rejects.toThrow(/not in this studio/)
    expect(await asUser(B_OWNER, () => q(`select id from client_detail_submissions`))).toEqual([])
    expect(await asUser(B_OWNER, () => q(`select id from client_detail_links`))).toEqual([])
  })
})
