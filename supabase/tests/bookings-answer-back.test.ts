import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0207: the person booked confirms or declines (with a reason, which tells
 * whoever booked them), says "I've reached" on the day, and a booking moved
 * to someone else asks them afresh. Tasks keep their own start and finish.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a7000000-0000-4000-8000-000000000001'
const PRIYA = 'a7000000-0000-4000-8000-000000000002'
const AMAN = 'a7000000-0000-4000-8000-000000000003'
const COMPANY = 'a7000000-0000-4000-8000-0000000000aa'
const CLIENT = 'a7000000-0000-4000-8000-0000000000c1'
const PROJECT = 'a7000000-0000-4000-8000-0000000000b1'
const SHOOT = 'a7000000-0000-4000-8000-0000000000d1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)
const fails = (sql: string) => db.query(sql).then(() => null, (e: Error) => e.message)
const slot = async (id: string) =>
  (await q<{ response: string; decline_reason: string | null; arrived: boolean; user_id: string }>(
    `select response, decline_reason, arrived_at is not null as arrived, user_id from team_assignment_slots where id = '${id}'`,
  ))[0]!
let n = 0
const book = async (user: string, startsIn: string, hours = 6) => {
  n += 1
  await as(OWNER)
  const [{ id }] = await q<{ id: string }>(
    `select book_team_slot('${user}', '${SHOOT}', 'Candid Photographer', now() + interval '${startsIn}' + interval '${n} minutes',
                           now() + interval '${startsIn}' + interval '${n} minutes' + interval '${hours} hours') as id`,
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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test'), ('${AMAN}', 'a@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test', 'active'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test', 'active'),
      ('${AMAN}', '${COMPANY}', 'employee', 'Aman', 'a@s.test', 'active');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
    insert into shoots (id, company_id, project_id, name, shoot_date, location) values
      ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Haldi', current_date + 3, 'Jaipur');
  `)
})

beforeEach(async () => {
  await db.exec(`delete from notifications; delete from team_assignment_slots;`)
})

describe('answering a booking', () => {
  it('starts pending, and the person booked confirms it', async () => {
    const id = await book(PRIYA, '3 days')
    expect((await slot(id)).response).toBe('pending')
    await as(PRIYA)
    await q(`select respond_to_slot('${id}', 'confirmed')`)
    expect((await slot(id)).response).toBe('confirmed')
  })

  it('a decline needs a reason, and tells whoever booked them', async () => {
    const id = await book(PRIYA, '3 days')
    await as(PRIYA)
    expect(await fails(`select respond_to_slot('${id}', 'declined', '')`)).toMatch(/reason_required/)
    await q(`select respond_to_slot('${id}', 'declined', 'Family wedding that day')`)
    expect(await slot(id)).toMatchObject({ response: 'declined', decline_reason: 'Family wedding that day' })
    const [note] = await q<{ recipient_uid: string; title: string; body: string }>(
      `select recipient_uid, title, body from notifications where type = 'shoot_declined'`,
    )
    expect(note).toMatchObject({ recipient_uid: OWNER, title: "Priya can't make Haldi" })
    expect(note!.body).toContain('"Family wedding that day"')
  })

  it('is theirs alone to answer', async () => {
    const id = await book(PRIYA, '3 days')
    await as(AMAN)
    expect(await fails(`select respond_to_slot('${id}', 'confirmed')`)).toMatch(/slot not found/)
  })

  it('asks afresh when the booking is moved to someone else', async () => {
    const id = await book(PRIYA, '3 days')
    await as(PRIYA)
    await q(`select respond_to_slot('${id}', 'confirmed')`)
    await db.exec(`update team_assignment_slots set user_id = '${AMAN}' where id = '${id}'`)
    expect(await slot(id)).toMatchObject({ response: 'pending', user_id: AMAN })
  })

  it('cannot be answered once released', async () => {
    const id = await book(PRIYA, '3 days')
    await q(`select set_team_slot_status('${id}', 'released')`)
    await as(PRIYA)
    expect(await fails(`select respond_to_slot('${id}', 'confirmed')`)).toMatch(/not_booked/)
  })
})

describe("I've reached", () => {
  it('works from three hours before the start, counts once, and confirms', async () => {
    const id = await book(PRIYA, '1 hour')
    await as(PRIYA)
    await q(`select mark_arrived('${id}', 26.9, 75.8)`)
    const first = (await q<{ t: string }>(`select arrived_at::text as t from team_assignment_slots where id = '${id}'`))[0]!.t
    await q(`select mark_arrived('${id}', 1, 1)`)
    expect((await q<{ t: string; lat: number }>(`select arrived_at::text as t, arrived_lat as lat from team_assignment_slots where id = '${id}'`))[0]).toEqual({ t: first, lat: 26.9 })
    expect((await slot(id)).response).toBe('confirmed')
  })

  it('is refused days ahead', async () => {
    const id = await book(PRIYA, '3 days')
    await as(PRIYA)
    expect(await fails(`select mark_arrived('${id}')`)).toMatch(/not_now/)
  })
})

describe('the evening before', () => {
  it('asks the unconfirmed to confirm and skips the declined', async () => {
    const pending = await book(PRIYA, '1 day')
    const declined = await book(AMAN, '1 day', 2)
    await as(AMAN)
    await q(`select respond_to_slot('${declined}', 'declined', 'Unwell')`)
    // 20:00 India time today: tomorrow's shoots get their reminder.
    await q(`select run_shoot_reminder_cron(false, ((now() at time zone 'Asia/Kolkata')::date + time '20:00') at time zone 'Asia/Kolkata')`)
    const rows = await q<{ recipient_uid: string; title: string }>(`select recipient_uid, title from notifications where type = 'shoot_tomorrow'`)
    expect(rows).toEqual([{ recipient_uid: PRIYA, title: 'Tomorrow: Haldi · please confirm' }])
    expect(pending).toBeTruthy()
  })
})

describe('tasks keep time', () => {
  it('stamp a start and a finish, and a reopened task loses its finish', async () => {
    await as(OWNER)
    const [{ id }] = await q<{ id: string }>(
      `insert into tasks (company_id, project_id, title, status, created_by) values ('${COMPANY}', '${PROJECT}', 'Cull photos', 'to_do', '${OWNER}') returning id`,
    )
    const times = async () =>
      (await q<{ started: boolean; completed: boolean }>(`select started_at is not null as started, completed_at is not null as completed from tasks where id = '${id}'`))[0]
    expect(await times()).toEqual({ started: false, completed: false })
    await db.exec(`update tasks set status = 'in_progress' where id = '${id}'`)
    expect(await times()).toEqual({ started: true, completed: false })
    await db.exec(`update tasks set status = 'completed' where id = '${id}'`)
    expect(await times()).toEqual({ started: true, completed: true })
    await db.exec(`update tasks set status = 'in_progress' where id = '${id}'`)
    expect(await times()).toEqual({ started: true, completed: false })
  })
})
