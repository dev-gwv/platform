import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0227: the studio's own quotation terms presets with one default, one
 * deliverable from several shoots, and email copies of a person's alerts.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'b2270000-0000-4000-8000-000000000001'
const RAVI = 'b2270000-0000-4000-8000-000000000002'
const FAKE = 'b2270000-0000-4000-8000-000000000003'
const OTHER = 'b2270000-0000-4000-8000-000000000004'
const STUDIO = 'b2270000-0000-4000-8000-0000000000aa'
const ELSEWHERE = 'b2270000-0000-4000-8000-0000000000bb'
const CLIENT = 'b2270000-0000-4000-8000-0000000000c1'
const PROJECT = 'b2270000-0000-4000-8000-0000000000d1'
const PROJECT2 = 'b2270000-0000-4000-8000-0000000000d2'
const HALDI = 'b2270000-0000-4000-8000-0000000000e1'
const WEDDING = 'b2270000-0000-4000-8000-0000000000e2'
const RECEPTION = 'b2270000-0000-4000-8000-0000000000e3'
const ELSE_SHOOT = 'b2270000-0000-4000-8000-0000000000e4'
const DELIV = 'b2270000-0000-4000-8000-0000000000f1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = async <T>(user: string, sql: string) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await q<T>(sql)
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
  }
}
const fails = (user: string, sql: string) =>
  as(user, sql).then(
    () => null,
    (e: Error) => e.message,
  )

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'asha@ashastudio.in'), ('${RAVI}', 'ravi@gmail.com'), ('${FAKE}', 'nitin@studio.test'), ('${OTHER}', 'x@other.in');
    insert into companies (id, name, owner_user_id) values
      ('${STUDIO}', 'Asha Studio', '${OWNER}'), ('${ELSEWHERE}', 'Other Studio', '${OTHER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Asha', 'asha@ashastudio.in', 'active'),
      ('${RAVI}', '${STUDIO}', 'employee', 'Ravi', 'ravi@gmail.com', 'active'),
      ('${FAKE}', '${STUDIO}', 'employee', 'Nitin', 'nitin@studio.test', 'active'),
      ('${OTHER}', '${ELSEWHERE}', 'super_admin', 'Other', 'x@other.in', 'active');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${STUDIO}', 'Mehta');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${STUDIO}', '${CLIENT}', 'Mehta Wedding', 200000, '${OWNER}'),
      ('${PROJECT2}', '${STUDIO}', '${CLIENT}', 'Mehta Anniversary', 50000, '${OWNER}');
    insert into shoots (id, company_id, project_id, name, shoot_date) values
      ('${HALDI}', '${STUDIO}', '${PROJECT}', 'Haldi', '2026-11-10'),
      ('${WEDDING}', '${STUDIO}', '${PROJECT}', 'Wedding', '2026-11-12'),
      ('${RECEPTION}', '${STUDIO}', '${PROJECT}', 'Reception', '2026-11-13'),
      ('${ELSE_SHOOT}', '${STUDIO}', '${PROJECT2}', 'Anniversary', '2026-12-01');
    insert into deliverables (id, company_id, project_id, title) values
      ('${DELIV}', '${STUDIO}', '${PROJECT}', 'Highlights film');
    grant usage on schema auth to authenticated;
  `)
})

describe('quotation terms presets', () => {
  it('belong to the studio: the owner writes, the team reads, another studio sees nothing', async () => {
    await as(OWNER, `insert into quotation_terms_presets (title, body) values ('Wedding', '50% advance'), ('Corporate', 'Full payment upfront')`)
    expect((await as<{ title: string }>(RAVI, `select title from quotation_terms_presets order by title`)).map((r) => r.title)).toEqual([
      'Corporate',
      'Wedding',
    ])
    expect(await fails(RAVI, `insert into quotation_terms_presets (title, body) values ('Mine', 'x')`)).toMatch(/row-level security/)
    expect(await as(OTHER, `select 1 from quotation_terms_presets`)).toEqual([])
    expect(await fails(OWNER, `insert into quotation_terms_presets (title, body) values ('wedding ', 'again')`)).toMatch(/duplicate key/)
  })

  it('keep one default, moved by set_default_quotation_terms', async () => {
    const [w] = await q<{ id: string }>(`select id from quotation_terms_presets where title = 'Wedding'`)
    const [c] = await q<{ id: string }>(`select id from quotation_terms_presets where title = 'Corporate'`)
    await as(OWNER, `select set_default_quotation_terms('${w!.id}')`)
    await as(OWNER, `select set_default_quotation_terms('${c!.id}')`)
    expect(await q(`select title from quotation_terms_presets where is_default`)).toEqual([{ title: 'Corporate' }])
    expect(await fails(RAVI, `select set_default_quotation_terms('${w!.id}')`)).toMatch(/owner or manager/)
    await as(OWNER, `select set_default_quotation_terms(null)`)
    expect(await q(`select 1 from quotation_terms_presets where is_default`)).toEqual([])
  })
})

describe('one deliverable from several shoots', () => {
  const links = () => q<{ shoot_id: string }>(`select shoot_id from deliverable_shoot_links where deliverable_id = '${DELIV}' order by shoot_id`)
  const row = () => q<{ shoot_id: string | null; start_rule: string }>(`select shoot_id, start_rule from deliverables where id = '${DELIV}'`).then((r) => r[0])

  it('keeps the list, with shoot_id on the last of them', async () => {
    await as(OWNER, `select set_deliverable_shoots('${DELIV}', array['${HALDI}', '${WEDDING}']::uuid[])`)
    expect(await row()).toEqual({ shoot_id: WEDDING, start_rule: 'specific_shoots' })
    expect((await links()).map((l) => l.shoot_id).sort()).toEqual([HALDI, WEDDING].sort())
  })

  it('refuses a shoot from another project', async () => {
    expect(await fails(OWNER, `select set_deliverable_shoots('${DELIV}', array['${HALDI}', '${ELSE_SHOOT}']::uuid[])`)).toMatch(/shoots from this project/)
  })

  it('a deleted shoot hands over to the next one; down to one, the list goes', async () => {
    await as(OWNER, `select set_deliverable_shoots('${DELIV}', array['${HALDI}', '${WEDDING}', '${RECEPTION}']::uuid[])`)
    expect((await row())!.shoot_id).toBe(RECEPTION)
    await db.exec(`delete from shoots where id = '${RECEPTION}'`)
    expect(await row()).toEqual({ shoot_id: WEDDING, start_rule: 'specific_shoots' })
    expect(await links()).toHaveLength(2)
    await db.exec(`delete from shoots where id = '${WEDDING}'`)
    expect(await row()).toEqual({ shoot_id: HALDI, start_rule: 'whole_project' })
    expect(await links()).toEqual([])
  })

  it('a shoot set the old way means one shoot again', async () => {
    await db.exec(`insert into shoots (id, company_id, project_id, name, shoot_date) values ('${WEDDING}', '${STUDIO}', '${PROJECT}', 'Wedding', '2026-11-12')`)
    await as(OWNER, `select set_deliverable_shoots('${DELIV}', array['${HALDI}', '${WEDDING}']::uuid[])`)
    await as(OWNER, `update deliverables set shoot_id = '${HALDI}' where id = '${DELIV}'`)
    expect(await row()).toEqual({ shoot_id: HALDI, start_rule: 'whole_project' })
    expect(await links()).toEqual([])
    await as(OWNER, `select set_deliverable_shoots('${DELIV}', '{}'::uuid[])`)
    expect((await row())!.shoot_id).toBeNull()
  })
})

describe('email copies of alerts', () => {
  it('lists an unread alert after fifteen minutes, to a real address, once', async () => {
    await db.exec(`
      insert into notifications (company_id, recipient_uid, type, title, dedupe_key, created_at) values
        ('${STUDIO}', '${RAVI}', 'shoot_assigned', 'You''re booked: Wedding', 'a1', now() - interval '20 minutes'),
        ('${STUDIO}', '${RAVI}', 'task.overdue', 'Task overdue', 'a2', now() - interval '2 minutes'),
        ('${STUDIO}', '${RAVI}', 'invoice.overdue', 'Payment overdue', 'a3', now() - interval '20 minutes'),
        ('${STUDIO}', '${FAKE}', 'shoot_assigned', 'You''re booked: Haldi', 'a4', now() - interval '20 minutes'),
        ('${STUDIO}', '${OWNER}', 'task.assigned', 'New task', 'a5', now() - interval '30 minutes');
      update notifications set read_at = now() where dedupe_key = 'a5';
    `)
    const due = await q<{ notification_id: string; email: string; title: string }>(`select notification_id, email, title from alert_email_due()`)
    expect(due.map((d) => [d.email, d.title])).toEqual([['ravi@gmail.com', "You're booked: Wedding"]])

    const claimed = await q<{ id: string }>(`select alert_email_mark(array['${due[0]!.notification_id}']::uuid[]) as id`)
    expect(claimed).toHaveLength(1)
    expect(await q(`select alert_email_mark(array['${due[0]!.notification_id}']::uuid[]) as id`)).toEqual([])
    await db.exec(`select alert_email_result(array['${due[0]!.notification_id}']::uuid[], 'sent')`)
    expect(await q(`select status from notification_deliveries where channel = 'email'`)).toEqual([{ status: 'sent' }])
    expect(await q(`select 1 from alert_email_due()`)).toEqual([])
  })

  it('stops when the person turns the copies off', async () => {
    await db.exec(`insert into notifications (company_id, recipient_uid, type, title, dedupe_key, created_at)
                   values ('${STUDIO}', '${RAVI}', 'data.pending', 'Data copy pending', 'b1', now() - interval '20 minutes')`)
    expect(await q(`select 1 from alert_email_due()`)).toHaveLength(1)
    expect(await as(RAVI, `select set_my_alert_emails(false) as on`)).toEqual([{ on: false }])
    expect(await q(`select 1 from alert_email_due()`)).toEqual([])
    expect(await fails(RAVI, `select * from alert_email_due()`)).toMatch(/permission denied/)
  })
})
