import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Team Booking notifications (0172): a person booked on a shoot hears about
 * it, hears again the evening before, and a release says when it happened.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e0000000-0000-4000-8000-000000000001'
const PRIYA = 'e0000000-0000-4000-8000-000000000002'
const AMAN = 'e0000000-0000-4000-8000-000000000003'
const COMPANY = 'e0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'e0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'e0000000-0000-4000-8000-0000000000b1'
const SHOOT = 'e0000000-0000-4000-8000-0000000000d1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)
const notes = (user: string, type: string) =>
  q<{ title: string; body: string }>(
    `select title, body from notifications where recipient_uid = '${user}' and type = '${type}' order by created_at`,
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
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test'), ('${AMAN}', 'a@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test'),
      ('${AMAN}', '${COMPANY}', 'employee', 'Aman', 'a@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
    insert into shoots (id, company_id, project_id, name, shoot_date, location) values
      ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Haldi', '2026-10-02', 'Jaipur');
  `)
  await as(OWNER)
})

const book = async (user: string, start: string, end: string, role = 'Candid Photographer') =>
  (
    await q<{ id: string }>(
      `select book_team_slot('${user}', '${SHOOT}', '${role}', '${start}', '${end}') as id`,
    )
  )[0]!.id

describe('booking notifications', () => {
  it('tells the person booked, and not the person who booked them', async () => {
    await book(PRIYA, '2026-10-02T04:30:00Z', '2026-10-02T10:30:00Z')
    const mine = await notes(PRIYA, 'shoot_assigned')
    expect(mine).toHaveLength(1)
    expect(mine[0]!.title).toBe("You're booked: Haldi")
    expect(mine[0]!.body).toContain('Candid Photographer')
    expect(mine[0]!.body).toContain('Jaipur')
    expect(mine[0]!.body).toContain('Sharma Wedding')
    expect(await notes(OWNER, 'shoot_assigned')).toHaveLength(0)
  })

  it('tells the new person when a booking is moved to them', async () => {
    const id = await book(PRIYA, '2026-10-02T11:00:00Z', '2026-10-02T12:00:00Z', 'Cinematographer')
    await db.exec(`update team_assignment_slots set user_id = '${AMAN}' where id = '${id}'`)
    expect(await notes(AMAN, 'shoot_assigned')).toHaveLength(1)
    // Changing only the hours is not news.
    await db.exec(`update team_assignment_slots set end_at = '2026-10-02T13:00:00Z' where id = '${id}'`)
    expect(await notes(AMAN, 'shoot_assigned')).toHaveLength(1)
  })

  it('stamps a release, clears it on rebooking, and refuses an unknown slot', async () => {
    const id = await book(AMAN, '2026-10-03T04:00:00Z', '2026-10-03T05:00:00Z')
    await db.exec(`select set_team_slot_status('${id}', 'released')`)
    const [r] = await q<{ released_at: string | null; updated_at: string }>(
      `select released_at, updated_at from team_assignment_slots where id = '${id}'`,
    )
    expect(r!.released_at).not.toBeNull()
    await db.exec(`select set_team_slot_status('${id}', 'booked')`)
    const [b] = await q<{ released_at: string | null }>(`select released_at from team_assignment_slots where id = '${id}'`)
    expect(b!.released_at).toBeNull()
    await expect(db.exec(`select set_team_slot_status(gen_random_uuid(), 'released')`)).rejects.toThrow(/slot not found/)
  })
})

describe('the evening before', () => {
  it('reminds each booking once, only after 6 pm India time on the day before', async () => {
    // Shoot on 2 Oct (India). 1 Oct 10:00 IST = 04:30 UTC: too early.
    const early = await q<{ s: { bookings_tomorrow: number } }>(
      `select run_shoot_reminder_cron(false, '2026-10-01T04:30:00Z') as s`,
    )
    expect(early[0]!.s.bookings_tomorrow).toBe(0)
    // 1 Oct 19:00 IST = 13:30 UTC.
    const evening = await q<{ s: { bookings_tomorrow: number; notifications_created: number } }>(
      `select run_shoot_reminder_cron(false, '2026-10-01T13:30:00Z') as s`,
    )
    expect(evening[0]!.s.bookings_tomorrow).toBe(2)
    expect(evening[0]!.s.notifications_created).toBe(2)
    // The next hour sends nothing new.
    const again = await q<{ s: { notifications_created: number } }>(
      `select run_shoot_reminder_cron(false, '2026-10-01T14:30:00Z') as s`,
    )
    expect(again[0]!.s.notifications_created).toBe(0)
    const priya = await notes(PRIYA, 'shoot_tomorrow')
    expect(priya).toHaveLength(1)
    expect(priya[0]!.title).toBe('Tomorrow: Haldi')
    expect(await notes(AMAN, 'shoot_tomorrow')).toHaveLength(1)
  })

  it('skips cancelled shoots', async () => {
    await db.exec(`update shoots set status = 'cancelled' where id = '${SHOOT}'`)
    const r = await q<{ s: { bookings_tomorrow: number } }>(
      `select run_shoot_reminder_cron(true, '2026-10-01T15:30:00Z') as s`,
    )
    expect(r[0]!.s.bookings_tomorrow).toBe(0)
  })
})
