import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0208: the scorecard. Every counter from the records the app keeps, the
 * score from stated weights, parts with nothing to measure left out, an
 * empty period null, and a member's card readable by them and their owner.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a8000000-0000-4000-8000-000000000001'
const EDIT = 'a8000000-0000-4000-8000-000000000002'
const FREE = 'a8000000-0000-4000-8000-000000000003'
const OTHER = 'a8000000-0000-4000-8000-000000000004'
const COMPANY = 'a8000000-0000-4000-8000-0000000000aa'
const CLIENT = 'a8000000-0000-4000-8000-0000000000c1'
const PROJECT = 'a8000000-0000-4000-8000-0000000000b1'

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
type Card = {
  score: number | null
  work: { with_due: number; on_time: number; pct: number | null; deliverables: number; tasks: number }
  quality: { approved: number; sent_back: number; pct: number | null }
  shoots: { shoots: number; measured: number; on_time: number; pct: number | null }
  attendance: { present: number; late: number; absent: number; pct: number | null } | null
  late_now: Array<{ title: string; days_late: number }>
}
const card = async (user: string, from = "current_date - 30", to = 'current_date') =>
  (await q<{ c: Card }>(`select member_scorecard_raw('${COMPANY}', '${user}', ${from}, ${to}) as c`))[0]!.c
let n = 0
const deliverable = async (user: string, due: string, doneAt: string | null, title = `Album ${++n}`) => {
  const [{ id }] = await q<{ id: string }>(
    `insert into deliverables (company_id, project_id, title, status, estimated_date, assignee_id, delivered_at)
     values ('${COMPANY}', '${PROJECT}', '${title}', ${doneAt ? "'completed'" : "'in_progress'"}, ${due}, '${user}', ${doneAt ?? 'null'}) returning id`,
  )
  return id!
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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${EDIT}', 'e@s.test'), ('${FREE}', 'f@s.test'), ('${OTHER}', 'x@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, status, engagement_type) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test', 'active', 'in_house'),
      ('${EDIT}', '${COMPANY}', 'employee', 'Meera', 'e@s.test', 'active', 'in_house'),
      ('${FREE}', '${COMPANY}', 'employee', 'Kabir', 'f@s.test', 'active', 'freelancer'),
      ('${OTHER}', '${COMPANY}', 'employee', 'Ravi', 'x@s.test', 'active', 'in_house');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
    grant usage on schema auth to authenticated;
  `)
})

beforeEach(async () => {
  await db.exec(`delete from team_work_submissions; delete from deliverables; delete from task_assignees; delete from tasks; delete from attendance; delete from team_assignment_slots; delete from shoots;`)
})

describe('an empty period', () => {
  it('is null, not zero', async () => {
    const c = await card(EDIT)
    expect(c.score).toBeNull()
    expect(c.work.pct).toBeNull()
  })
})

describe('work on time', () => {
  it('counts deliverables and tasks finished by their due date, and names what is late now', async () => {
    await deliverable(EDIT, 'current_date - 5', "now() - interval '6 days'") // early
    await deliverable(EDIT, 'current_date - 5', "now() - interval '2 days'") // 3 days late
    await deliverable(EDIT, 'current_date - 4', null, 'Teaser') // still open, 4 days late
    const [{ id }] = await q<{ id: string }>(`insert into tasks (company_id, project_id, title, status, due_date, created_by) values ('${COMPANY}', '${PROJECT}', 'Cull', 'to_do', current_date + 1, '${OWNER}') returning id`)
    await db.exec(`insert into task_assignees (task_id, user_id, company_id) values ('${id}', '${EDIT}', '${COMPANY}')`)
    await db.exec(`update tasks set status = 'completed' where id = '${id}'`)
    const c = await card(EDIT)
    expect(c.work).toMatchObject({ deliverables: 2, tasks: 1, with_due: 3, on_time: 2, pct: 67 })
    expect(c.late_now).toEqual([{ title: 'Teaser', project: 'Sharma Wedding', days_late: 4 }])
  })
})

describe('right first time', () => {
  it('counts work approved in the period, and what was sent back first', async () => {
    const a = await deliverable(EDIT, 'current_date', "now() - interval '1 day'")
    const b = await deliverable(EDIT, 'current_date', "now() - interval '1 day'")
    await db.exec(`
      insert into team_work_submissions (company_id, project_id, deliverable_id, submitted_by, submission_link, status, reviewed_at) values
        ('${COMPANY}', '${PROJECT}', '${a}', '${EDIT}', 'https://x/1', 'approved', now() - interval '1 day'),
        ('${COMPANY}', '${PROJECT}', '${b}', '${EDIT}', 'https://x/2', 'rejected', now() - interval '3 days'),
        ('${COMPANY}', '${PROJECT}', '${b}', '${EDIT}', 'https://x/3', 'approved', now() - interval '1 day')`)
    expect((await card(EDIT)).quality).toEqual({ approved: 2, sent_back: 1, pct: 50 })
  })
})

describe('on time at shoots', () => {
  it('measures arrival within 15 minutes of the call time, only on shoots since this started', async () => {
    const [{ id: shoot }] = await q<{ id: string }>(`insert into shoots (company_id, project_id, name, shoot_date) values ('${COMPANY}', '${PROJECT}', 'Haldi', current_date) returning id`)
    // Measurement starts when 0208 ran. Pinned an hour back for the test: one
    // shoot before it, two after -- one reached 10 minutes after the call,
    // one never marked.
    const since = (await q<{ t: string }>(`select (now() - interval '1 hour')::text as t`))[0]!.t
    await db.exec(`create or replace function scorecard_since() returns timestamptz language sql immutable as $$ select '${since}'::timestamptz $$`)
    await db.exec(`
      insert into team_assignment_slots (company_id, user_id, shoot_id, service_name, start_at, end_at, status, response, arrived_at) values
        ('${COMPANY}', '${FREE}', '${shoot}', 'Candid', scorecard_since() - interval '1 day', scorecard_since() - interval '20 hours', 'booked', 'confirmed', null),
        ('${COMPANY}', '${FREE}', '${shoot}', 'Drone', scorecard_since() + interval '1 minute', scorecard_since() + interval '10 minutes', 'booked', 'confirmed', scorecard_since() + interval '11 minutes'),
        ('${COMPANY}', '${FREE}', '${shoot}', 'Video', scorecard_since() + interval '20 minutes', scorecard_since() + interval '30 minutes', 'booked', 'pending', null)`)
    expect((await card(FREE)).shoots).toEqual({ shoots: 3, measured: 2, on_time: 1, declined: 0, pct: 50 })
  })
})

describe('attendance and the score', () => {
  it('counts late as half a day, leaves attendance out for freelancers, and scales the weights', async () => {
    await db.exec(`insert into attendance (company_id, user_id, a_date, status) values
      ('${COMPANY}', '${EDIT}', current_date - 3, 'present'), ('${COMPANY}', '${EDIT}', current_date - 2, 'late'),
      ('${COMPANY}', '${EDIT}', current_date - 1, 'absent'), ('${COMPANY}', '${EDIT}', current_date, 'present')`)
    await deliverable(EDIT, 'current_date', "now() - interval '1 day'") // on time: work 100%
    const c = await card(EDIT)
    expect(c.attendance).toEqual({ present: 2, late: 1, absent: 1, pct: 63 })
    // Work 100 (weight 40) + attendance 62.5 (weight 20), scaled over 60.
    expect(c.score).toBe(88)

    await db.exec(`insert into attendance (company_id, user_id, a_date, status) values ('${COMPANY}', '${FREE}', current_date, 'absent')`)
    await deliverable(FREE, 'current_date', "now() - interval '1 day'")
    const f = await card(FREE)
    expect(f.attendance).toBeNull()
    expect(f.score).toBe(100)
  })
})

describe('who can read it', () => {
  it('the member themselves, or the studio’s owner and managers', async () => {
    expect((await as<{ c: Card }>(EDIT, `select member_scorecard('${EDIT}', current_date - 30, current_date) as c`))[0]!.c.score).toBeNull()
    await expect(as(OTHER, `select member_scorecard('${EDIT}', current_date - 30, current_date)`)).rejects.toThrow(/forbidden/)
    await expect(as(EDIT, `select * from member_scorecard_team(current_date - 30, current_date)`)).rejects.toThrow(/forbidden/)
    const rows = await as<{ name: string }>(OWNER, `select name from member_scorecard_team(current_date - 30, current_date) as t`)
    expect(rows.map((r) => r.name).sort()).toEqual(['Kabir', 'Meera', 'Ravi'])
  })
})
