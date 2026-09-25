import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Deliverable types (0179): the studio's own list of what it delivers and how
 * many days the work needs. The start date counts back from the studio's
 * number when it has one -- after the deliverable's own lead, before the
 * built-in guess -- and only admins and managers change the list.
 *
 * Runs as `authenticated` with the bootstrap grants for the RLS checks, like
 * direct-write-policies.test.ts; everything else runs as the owner of the
 * schema, like start-reminders.test.ts.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'b0000000-0000-4000-8000-000000000001'
const MANAGER = 'b0000000-0000-4000-8000-000000000002'
const EDITOR = 'b0000000-0000-4000-8000-000000000003'
const OTHER_OWNER = 'b0000000-0000-4000-8000-000000000004'
const COMPANY = 'b0000000-0000-4000-8000-0000000000aa'
const OTHER = 'b0000000-0000-4000-8000-0000000000bb'
const CLIENT = 'b0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'b0000000-0000-4000-8000-0000000000d1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

async function asUser<T>(uid: string, sql: string) {
  await db.exec(`set role authenticated;`)
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
  try {
    return (await db.query<T>(sql)).rows
  } finally {
    await db.exec(`reset role;`)
  }
}

const addType = (company: string, title: string, work: number | null, archived = false) =>
  db.exec(`insert into deliverable_templates (company_id, title, work_days, is_archived)
           values ('${company}', '${title}', ${work ?? 'null'}, ${archived});`)

/** The built-in guess for a name (0174), which the studio's list sits in front of. */
const guess = async (title: string) =>
  (await one<{ n: number }>(`select deliverable_work_days('${title}', null) as n`)).n

const workDays = async (company: string, title: string, lead: number | null = null) =>
  (await one<{ n: number }>(`select company_work_days('${company}', '${title}', ${lead ?? 'null'}) as n`)).n

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  // Production's bootstrap grants (00_bootstrap.sql): without them RLS never
  // gets a say, and a refusal reads as "permission denied for table".
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'o@s.test'), ('${MANAGER}', 'm@s.test'), ('${EDITOR}', 'e@s.test'), ('${OTHER_OWNER}', 'x@s.test');
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other Studio', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}',       '${COMPANY}', 'super_admin', 'Owner',   'o@s.test'),
      ('${MANAGER}',     '${COMPANY}', 'manager',     'Manager', 'm@s.test'),
      ('${EDITOR}',      '${COMPANY}', 'employee',    'Editor',  'e@s.test'),
      ('${OTHER_OWNER}', '${OTHER}',   'super_admin', 'Other',   'x@s.test');
  `)
})

describe('how many days the work needs', () => {
  it('asks the deliverable first, then the studio’s list, then the built-in guess', async () => {
    await addType(COMPANY, 'Album Design', 12)
    // Its own lead was set for this one project, so it wins.
    expect(await workDays(COMPANY, 'Album design', 3)).toBe(3)
    // Otherwise the studio's number, the name matched ignoring case and outer spaces.
    expect(await workDays(COMPANY, '  album DESIGN ', null)).toBe(12)
    // A lead of 0 is "not set", the same as in deliverable_work_days().
    expect(await workDays(COMPANY, 'Album design', 0)).toBe(12)
    // A name the studio has not listed is the built-in guess.
    expect(await workDays(COMPANY, 'Cinematic Film')).toBe(await guess('Cinematic Film'))
    expect(await guess('Cinematic Film')).toBe(30)
  })

  it('never reads another studio’s list', async () => {
    await addType(OTHER, 'Teaser Cut', 40)
    expect(await workDays(COMPANY, 'Teaser Cut')).toBe(await guess('Teaser Cut'))
    expect(await workDays(OTHER, 'Teaser Cut')).toBe(40)
  })

  it('leaves the guess in charge for a type with no work days, or an archived one', async () => {
    await addType(COMPANY, 'Highlight Film', null)
    expect(await workDays(COMPANY, 'Highlight Film')).toBe(await guess('Highlight Film'))
    await addType(COMPANY, 'Save The Date', 9, true)
    expect(await workDays(COMPANY, 'Save the date')).toBe(await guess('Save the date'))
  })

  it('takes zero work days at their word', async () => {
    await addType(COMPANY, 'Raw Handover', 0)
    expect(await workDays(COMPANY, 'Raw Handover')).toBe(0)
  })
})

describe('the day to start', () => {
  it('is due, minus the studio’s work days, minus a day for review', async () => {
    await addType(COMPANY, 'Photo Album', 20)
    const [r] = await q<{ own: string; lead: string; none: string; builtin: string; undated: string | null }>(`
      select company_start_by('${COMPANY}', '2026-10-20', 'Photo Album', null)::text as own,
             company_start_by('${COMPANY}', '2026-10-20', 'Photo Album', 3)::text as lead,
             company_start_by('${OTHER}', '2026-10-20', 'Photo Album', null)::text as none,
             deliverable_start_by('2026-10-20', 'Photo Album', null)::text as builtin,
             company_start_by('${COMPANY}', null, 'Photo Album', null)::text as undated`)
    expect(r).toMatchObject({ own: '2026-09-29', lead: '2026-10-16', undated: null })
    // A studio with no type of that name gets exactly what 0174 gave it.
    expect(r!.none).toBe(r!.builtin)
  })

  it('reads the studio’s list for an editor too, not only for an owner', async () => {
    // "My deliverables" asks as the editor; the list is readable to everyone in the studio.
    const [r] = await asUser<{ n: number; d: string }>(
      EDITOR,
      `select company_work_days('${COMPANY}', 'Photo Album', null) as n,
              company_start_by('${COMPANY}', '2026-10-20', 'Photo Album', null)::text as d`,
    )
    expect(r).toEqual({ n: 20, d: '2026-09-29' })
  })
})

describe('the morning start reminder', () => {
  it('fires on the studio’s date when a new project stored its work days on the deliverable', async () => {
    // The wizard copies a type's work days onto the deliverable as its own
    // lead (delivery_days_after_start): Photo Album, 20 days, due 20 Oct.
    await db.exec(`
      insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
      insert into projects (id, company_id, client_id, name, package_cost, created_by) values
        ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
      insert into deliverables (company_id, project_id, title, estimated_date, assignee_id, delivery_days_after_start)
        values ('${COMPANY}', '${PROJECT}', 'Photo Album', '2026-10-20', '${EDITOR}', 20);`)
    // Start by 29 Sep, so two days before is the 27th -- the built-in guess
    // (a week) would not speak until 10 Oct.
    await q(`select run_start_reminder_cron(false, '2026-09-27T04:00:00Z')`)
    const titles = await q<{ title: string }>(
      `select title from notifications where recipient_uid = '${EDITOR}' and type = 'deliverable_start'`,
    )
    expect(titles.map((t) => t.title)).toEqual(['Start Photo Album by Tue 29 Sep'])
  })
})

describe('the list itself', () => {
  it('holds one live type per name in a studio, ignoring case', async () => {
    await addType(COMPANY, 'Reels Pack', 5)
    await expect(addType(COMPANY, ' reels PACK ', 6)).rejects.toThrow(/duplicate key|unique/i)
    // Archived ones may repeat, and another studio has its own.
    await addType(COMPANY, 'REELS PACK', 6, true)
    await addType(OTHER, 'Reels Pack', 7)
  })

  it('keeps work days within a year', async () => {
    await expect(addType(COMPANY, 'Too Long', 366)).rejects.toThrow(/check/i)
    await expect(addType(COMPANY, 'Negative', -1)).rejects.toThrow(/check/i)
    await addType(COMPANY, 'A Year', 365)
  })
})

describe('who can change the list', () => {
  it('everyone in the studio reads it, and only their own studio’s', async () => {
    const rows = await asUser<{ company_id: string }>(EDITOR, `select company_id from deliverable_templates`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.company_id === COMPANY)).toBe(true)
  })

  it('an employee cannot add, change or archive a type', async () => {
    await expect(
      asUser(EDITOR, `insert into deliverable_templates (company_id, title) values ('${COMPANY}', 'Sneaky')`),
    ).rejects.toThrow(/row-level security/i)
    // RLS filters an update rather than refusing it: nothing changes.
    const changed = await asUser<{ id: string }>(
      EDITOR,
      `update deliverable_templates set work_days = 1 where title = 'Photo Album' returning id`,
    )
    expect(changed).toHaveLength(0)
    expect(await workDays(COMPANY, 'Photo Album')).toBe(20)
  })

  it('a manager and the owner can', async () => {
    const added = await asUser<{ id: string }>(
      MANAGER,
      `insert into deliverable_templates (company_id, title, work_days) values ('${COMPANY}', 'Pre-wedding Film', 15) returning id`,
    )
    expect(added).toHaveLength(1)
    const changed = await asUser<{ id: string }>(
      OWNER,
      `update deliverable_templates set work_days = 18 where title = 'Pre-wedding Film' returning id`,
    )
    expect(changed).toHaveLength(1)
    expect(await workDays(COMPANY, 'Pre-wedding Film')).toBe(18)
  })

  it('not even a manager can write into another studio’s list', async () => {
    await expect(
      asUser(MANAGER, `insert into deliverable_templates (company_id, title) values ('${OTHER}', 'Planted')`),
    ).rejects.toThrow(/row-level security/i)
  })
})
