import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Start reminders (0174): the person on a deliverable hears when to start it --
 * due, minus the days it needs, minus a day for review -- and every day after
 * until they start; a task a day before it is due.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a0000000-0000-4000-8000-000000000001'
const PRIYA = 'a0000000-0000-4000-8000-000000000002'
const AMAN = 'a0000000-0000-4000-8000-000000000003'
const COMPANY = 'a0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'a0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'a0000000-0000-4000-8000-0000000000b1'
const SHOOT = 'a0000000-0000-4000-8000-0000000000d1'
const DISK = 'a0000000-0000-4000-8000-0000000000e1'
const CLOUD = 'a0000000-0000-4000-8000-0000000000e2'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)
const fails = async (sql: string) => {
  try {
    await db.query(sql)
  } catch (e) {
    return (e as Error).message
  }
  return null
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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
  `)
  await as(OWNER)
})

const deliverable = async (title: string, due: string, lead: number | null = null) =>
  (
    await q<{ id: string }>(
      `insert into deliverables (company_id, project_id, title, estimated_date, assignee_id, delivery_days_after_start)
       values ('${COMPANY}', '${PROJECT}', '${title}', '${due}', '${PRIYA}', ${lead ?? 'null'}) returning id`,
    )
  )[0]!.id
const run = (at: string) => q<{ s: Record<string, number> }>(`select run_start_reminder_cron(false, '${at}') as s`)
const titles = () => q<{ title: string }>(`select title from notifications where recipient_uid = '${PRIYA}' and type = 'deliverable_start' order by created_at`)

describe('start reminders', () => {
  it('works out the start date from the work the deliverable needs', async () => {
    const [r] = await q<{ film: string; album: string; lead: string }>(`
      select deliverable_start_by('2026-11-30', 'Cinematic Film', null)::text as film,
             deliverable_start_by('2026-10-20', 'Album design', null)::text as album,
             deliverable_start_by('2026-10-20', 'Album design', 3)::text as lead`)
    expect(r).toEqual({ film: '2026-10-30', album: '2026-10-12', lead: '2026-10-16' })
  })

  it('reminds two days before, on the day, and every day after -- in the morning, once a day -- until started', async () => {
    const id = await deliverable('Album design', '2026-10-20')
    // Start by 12 Oct. Before 9 am India: nothing.
    expect((await run('2026-10-10T02:00:00Z'))[0]!.s.notifications_created).toBe(0)
    await run('2026-10-10T04:00:00Z')
    await run('2026-10-10T08:00:00Z') // same day again: deduped
    await run('2026-10-11T04:00:00Z') // a day the reminder skips
    await run('2026-10-12T04:00:00Z')
    await run('2026-10-14T04:00:00Z')
    const t = (await titles()).map((x) => x.title)
    expect(t).toEqual(['Start Album design by Mon 12 Oct', 'Start Album design today', 'Album design: should have started 2 days ago'])
    // Started: no more.
    await as(PRIYA)
    await q(`select start_deliverable('${id}')`)
    await as(OWNER)
    await run('2026-10-15T04:00:00Z')
    expect(await titles()).toHaveLength(3)
  })

  it('counts handing work in as starting', async () => {
    const id = await deliverable('Teaser', '2026-11-10')
    await q(`insert into team_work_submissions (company_id, project_id, deliverable_id, submitted_by, submission_link)
             values ('${COMPANY}', '${PROJECT}', '${id}', '${PRIYA}', 'https://x.test/v1')`)
    const [r] = await q<{ started: boolean }>(`select started_at is not null as started from deliverables where id = '${id}'`)
    expect(r!.started).toBe(true)
  })
})
