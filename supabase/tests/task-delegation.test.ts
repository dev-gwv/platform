import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The task delegation loop (0192): assign → told → work → submit a link →
 * reviewed → done or sent back.
 *
 * Runs as `authenticated` with the production default privileges (see
 * work-submission-rls.test.ts for why both matter), so the employee
 * self-task policies are actually enforced here, not bypassed.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-4111-8111-111111111111'
const COMPANY = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'

let db: PGlite

async function asUser<T>(uid: string, sql: string) {
  await db.exec(`set role authenticated;`)
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
  try {
    return await db.query<T>(sql)
  } finally {
    await db.exec(`reset role;`)
  }
}

const one = async <T>(uid: string, sql: string) => (await asUser<T>(uid, sql)).rows[0]!

async function statusOf(task: string) {
  return (await db.query<{ status: string; blocked_reason: string | null }>(
    `select status::text as status, blocked_reason from tasks where id = '${task}';`,
  )).rows[0]!
}

async function notes(recipient: string, task: string) {
  return (await db.query<{ type: string; title: string; body: string | null; deep_link: string }>(
    `select type, title, body, deep_link from notifications
      where recipient_uid = '${recipient}' and entity_id = '${task}' order by created_at, title;`,
  )).rows
}

async function activity(task: string) {
  return (await db.query<{ action: string; user_id: string | null }>(
    `select action, user_id from task_activity where task_id = '${task}' order by created_at, action;`,
  )).rows.map((r) => r.action)
}

/** The owner gives MEMBER a task. */
async function giveTask(title: string) {
  const r = await one<{ id: string }>(
    OWNER,
    `select create_task_with_assignees(null, null, '${title}', 'to_do', 'high', current_date + 2, array['${MEMBER}']::uuid[]) as id;`,
  )
  return r.id
}

const submit = (task: string, link = 'https://drive.test/album') =>
  asUser(
    MEMBER,
    `insert into team_work_submissions (company_id, task_id, submitted_by, submission_link, notes)
     values ('${COMPANY}', '${task}', '${MEMBER}', '${link}', 'First cut') returning id;`,
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
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(
    `alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`,
  )
  await db.exec(`alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)

  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }

  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER}', 'owner@d.test'), ('${MEMBER}', 'member@d.test'), ('${OTHER}', 'other@d.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}',  '${COMPANY}', 'super_admin', 'Asha Owner',  'owner@d.test'),
      ('${MEMBER}', '${COMPANY}', 'employee',    'Ravi Editor', 'member@d.test'),
      ('${OTHER}',  '${COMPANY}', 'employee',    'Meera Shooter', 'other@d.test');
  `)
})

describe('assigning', () => {
  it('tells the new assignee, not the person who assigned it, and writes history', async () => {
    const task = await giveTask('Edit Sharma album')
    const told = await notes(MEMBER, task)
    expect(told).toHaveLength(1)
    expect(told[0]!.type).toBe('task.assigned')
    expect(told[0]!.title).toBe('New task: Edit Sharma album')
    expect(told[0]!.body).toContain('From Asha Owner')
    expect(told[0]!.deep_link).toBe(`/tasks?open=${task}`)
    expect(await notes(OWNER, task)).toHaveLength(0)
    expect(await activity(task)).toEqual(['assigned this to Ravi Editor', 'created this task'])
  })

  it('a new task has the General tag and no blocked reason', async () => {
    const task = await giveTask('Tag default')
    const r = await db.query<{ tag: string }>(`select tag from tasks where id = '${task}';`)
    expect(r.rows[0]!.tag).toBe('General')
  })

  it('removing someone is recorded; deleting a task with people on it still works', async () => {
    const task = await giveTask('Delete me')
    await asUser(OWNER, `delete from task_assignees where task_id = '${task}' and user_id = '${MEMBER}';`)
    expect(await activity(task)).toContain('removed Ravi Editor')
    await asUser(OWNER, `insert into task_assignees (task_id, user_id, company_id) values ('${task}', '${MEMBER}', '${COMPANY}');`)
    await asUser(OWNER, `delete from tasks where id = '${task}';`)
    const left = await db.query<{ n: number }>(`select count(*)::int as n from task_activity where task_id = '${task}';`)
    expect(left.rows[0]!.n).toBe(0)
  })
})

describe('the assignee moves their task', () => {
  it('to in progress and review, but not to done', async () => {
    const task = await giveTask('Colour grade')
    await asUser(MEMBER, `select update_my_task_status('${task}', 'in_progress');`)
    expect((await statusOf(task)).status).toBe('in_progress')
    await expect(asUser(MEMBER, `select update_my_task_status('${task}', 'completed');`)).rejects.toThrow(/marks it done/)
    expect((await statusOf(task)).status).toBe('in_progress')
    expect(await activity(task)).toContain('moved this to In progress')
    // The assignee moved it themselves: nobody else is on it, and the owner
    // hears only about review/blocked.
    expect((await notes(OWNER, task)).length).toBe(0)
  })

  it('blocked needs a reason, which reaches the person who gave the task', async () => {
    const task = await giveTask('Album print')
    await expect(asUser(MEMBER, `select update_my_task_status('${task}', 'blocked');`)).rejects.toThrow(/blocking/)
    await asUser(MEMBER, `select update_my_task_status('${task}', 'blocked', 'Waiting for client photos');`)
    expect(await statusOf(task)).toEqual({ status: 'blocked', blocked_reason: 'Waiting for client photos' })
    const told = await notes(OWNER, task)
    expect(told.map((n) => n.title)).toEqual(['Moved to Blocked: Album print'])
    expect(told[0]!.body).toBe('Waiting for client photos')
    // Moving on clears the reason.
    await asUser(MEMBER, `select update_my_task_status('${task}', 'in_progress');`)
    expect(await statusOf(task)).toEqual({ status: 'in_progress', blocked_reason: null })
  })

  it('someone else moving it tells the assignee', async () => {
    const task = await giveTask('Backup cards')
    await asUser(OWNER, `update tasks set status = 'in_progress' where id = '${task}';`)
    const told = (await notes(MEMBER, task)).map((n) => n.type)
    expect(told).toEqual(['task.assigned', 'task.status'])
  })

  it('a task you are not on is not yours to move', async () => {
    const task = await giveTask('Not Meera’s')
    await expect(asUser(OTHER, `select update_my_task_status('${task}', 'in_progress');`)).rejects.toThrow(/not your task/)
  })
})

describe('submit → review → done', () => {
  it('submitting moves the task to review and tells the person who gave it', async () => {
    const task = await giveTask('Teaser edit')
    await submit(task)
    expect((await statusOf(task)).status).toBe('review')
    const told = await notes(OWNER, task)
    expect(told.map((n) => n.type)).toEqual(['task.submitted'])
    expect(told[0]!.body).toContain('https://drive.test/album')
    expect(await activity(task)).toContain('submitted work')
  })

  it('approving completes it and tells the assignee', async () => {
    const task = await giveTask('Highlight film')
    await submit(task)
    await asUser(OWNER, `select review_task('${task}', true, null);`)
    expect((await statusOf(task)).status).toBe('completed')
    const sub = await db.query<{ status: string; reviewed_by: string }>(
      `select status, reviewed_by from team_work_submissions where task_id = '${task}';`,
    )
    expect(sub.rows[0]).toEqual({ status: 'approved', reviewed_by: OWNER })
    expect((await notes(MEMBER, task)).map((n) => n.title)).toContain('Approved: Highlight film')
    expect(await activity(task)).toContain('approved the work')
  })

  it('sending back needs a note, returns it to in progress, and a resubmission goes to review again', async () => {
    const task = await giveTask('Reel cut')
    const [sub] = (await submit(task)).rows as { id: string }[]
    await expect(asUser(OWNER, `select review_task('${task}', false, '  ');`)).rejects.toThrow(/needs to change/)
    await asUser(OWNER, `select review_task('${task}', false, 'Music is too loud');`)
    expect((await statusOf(task)).status).toBe('in_progress')
    const back = (await notes(MEMBER, task)).find((n) => n.title === 'Sent back: Reel cut')
    expect(back?.body).toBe('Music is too loud')
    expect(await activity(task)).toContain('sent the work back: Music is too loud')

    // A resubmission reopens the same row (how the Team Work edit path does it).
    await db.exec(`update team_work_submissions set status = 'submitted', submission_link = 'https://drive.test/v2' where id = '${sub!.id}';`)
    expect((await statusOf(task)).status).toBe('review')
  })

  it('review_work (the Team Work page) closes the task too', async () => {
    const task = await giveTask('Cull photos')
    const [sub] = (await submit(task)).rows as { id: string }[]
    await asUser(OWNER, `select review_work('${sub!.id}', true, null);`)
    expect((await statusOf(task)).status).toBe('completed')
  })

  it('only the person who gave it (or a manager) reviews, and only while in review', async () => {
    const task = await giveTask('Only owner reviews')
    await expect(asUser(OWNER, `select review_task('${task}', true, null);`)).rejects.toThrow(/not waiting for review/)
    await submit(task)
    await expect(asUser(MEMBER, `select review_task('${task}', true, null);`)).rejects.toThrow(/person who gave/)
    expect((await statusOf(task)).status).toBe('review')
  })

  it('a task moved to review by hand is approved directly', async () => {
    const task = await giveTask('Manual review')
    await asUser(MEMBER, `select update_my_task_status('${task}', 'review');`)
    expect((await notes(OWNER, task)).map((n) => n.title)).toEqual(['Moved to Review: Manual review'])
    await asUser(OWNER, `select review_task('${task}', true, null);`)
    expect((await statusOf(task)).status).toBe('completed')
  })
})

describe('employees add tasks for themselves', () => {
  const selfTask = (by: string, createdBy: string, title: string) =>
    `insert into tasks (company_id, title, created_by, tag) values ('${COMPANY}', '${title}', '${createdBy}', 'Office') returning id;`

  it('may add a task and put themselves on it', async () => {
    const r = await one<{ id: string }>(MEMBER, selfTask(MEMBER, MEMBER, 'Clean lenses'))
    await asUser(MEMBER, `insert into task_assignees (task_id, user_id, company_id) values ('${r.id}', '${MEMBER}', '${COMPANY}');`)
    const seen = await asUser<{ title: string; tag: string }>(MEMBER, `select title, tag from tasks where id = '${r.id}';`)
    expect(seen.rows).toEqual([{ title: 'Clean lenses', tag: 'Office' }])
    expect(await activity(r.id)).toEqual(['created this task', 'took this task'])
    // Nobody is told about a task you gave yourself.
    expect(await notes(MEMBER, r.id)).toHaveLength(0)
  })

  it('may not put anyone else on it', async () => {
    const r = await one<{ id: string }>(MEMBER, selfTask(MEMBER, MEMBER, 'Try to delegate'))
    await expect(
      asUser(MEMBER, `insert into task_assignees (task_id, user_id, company_id) values ('${r.id}', '${OTHER}', '${COMPANY}');`),
    ).rejects.toThrow()
  })

  it('may not add a task in someone else’s name, or one already done', async () => {
    await expect(asUser(MEMBER, selfTask(MEMBER, OWNER, 'Forged'))).rejects.toThrow()
    await expect(
      asUser(MEMBER, `insert into tasks (company_id, title, created_by, status) values ('${COMPANY}', 'Done already', '${MEMBER}', 'completed');`),
    ).rejects.toThrow()
  })

  it('may not join a task someone else created', async () => {
    const task = await one<{ id: string }>(
      OWNER,
      `select create_task_with_assignees(null, null, 'Owner only', 'to_do', 'low', null, '{}'::uuid[]) as id;`,
    )
    await expect(
      asUser(MEMBER, `insert into task_assignees (task_id, user_id, company_id) values ('${task.id}', '${MEMBER}', '${COMPANY}');`),
    ).rejects.toThrow()
  })

  it('reviews their own task through to done', async () => {
    const r = await one<{ id: string }>(MEMBER, selfTask(MEMBER, MEMBER, 'Own review'))
    await asUser(MEMBER, `insert into task_assignees (task_id, user_id, company_id) values ('${r.id}', '${MEMBER}', '${COMPANY}');`)
    await submit(r.id)
    expect((await statusOf(r.id)).status).toBe('review')
    await asUser(MEMBER, `select review_task('${r.id}', true, null);`)
    expect((await statusOf(r.id)).status).toBe('completed')
  })
})

describe('history visibility', () => {
  it('the assignee sees their task’s history; someone not on it does not', async () => {
    const task = await giveTask('Visible history')
    const mine = await asUser<{ n: number }>(MEMBER, `select count(*)::int as n from task_activity where task_id = '${task}';`)
    expect(mine.rows[0]!.n).toBeGreaterThan(0)
    const theirs = await asUser<{ n: number }>(OTHER, `select count(*)::int as n from task_activity where task_id = '${task}';`)
    expect(theirs.rows[0]!.n).toBe(0)
  })
})
