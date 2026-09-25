import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Data Management v2 (0173): crew hand over only their own cards, a copy
 * says where it is, bulk changes skip what they do not fit, archived is a
 * stage, and the evening reminders repeat daily until the data moves.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'f0000000-0000-4000-8000-000000000001'
const PRIYA = 'f0000000-0000-4000-8000-000000000002'
const AMAN = 'f0000000-0000-4000-8000-000000000003'
const COMPANY = 'f0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'f0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'f0000000-0000-4000-8000-0000000000b1'
const SHOOT = 'f0000000-0000-4000-8000-0000000000d1'
const DISK = 'f0000000-0000-4000-8000-0000000000e1'
const CLOUD = 'f0000000-0000-4000-8000-0000000000e2'

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
let priyaSlot = ''
let amanSlot = ''

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
      ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Haldi', '2026-09-20', 'Jaipur');
    insert into storage_locations (id, company_id, name) values ('${DISK}', '${COMPANY}', 'HDD 4'), ('${CLOUD}', '${COMPANY}', 'Drive');
  `)
  await as(OWNER)
  const book = async (user: string, role: string) =>
    (
      await q<{ id: string }>(
        `select book_team_slot('${user}', '${SHOOT}', '${role}', '2026-09-20T04:30:00Z', '2026-09-20T10:30:00Z') as id`,
      )
    )[0]!.id
  priyaSlot = await book(PRIYA, 'Drone Operator')
  amanSlot = await book(AMAN, 'Candid Photographer')
})

const stageOf = async (slot: string) =>
  (await q<{ data_status: string }>(`select data_status from shoot_data_records where slot_id = '${slot}'`))[0]?.data_status

describe('crew hand over their own cards', () => {
  it('lets Priya hand over her booking, and fills the record from it', async () => {
    await as(PRIYA)
    await q(`select handover_slot_data('${priyaSlot}', 2, 128.5, '${OWNER}', null, 'Card 2 is slow')`)
    await as(OWNER)
    const [r] = await q<Record<string, unknown>>(`select * from shoot_data_records where slot_id = '${priyaSlot}'`)
    expect(r).toMatchObject({
      data_status: 'received',
      card_count: 2,
      data_type: 'drone',
      user_id: PRIYA,
      received_by_uid: OWNER,
      received_by_name: 'Owner',
      data_label: 'Haldi · Drone Operator · Priya',
      notes: 'Card 2 is slow',
    })
  })

  it("refuses Aman's booking to Priya, and a manager-only change to crew", async () => {
    await as(PRIYA)
    expect(await fails(`select handover_slot_data('${amanSlot}', 1, 1, null, null, null)`)).toMatch(/booking not found/)
    expect(await fails(`select bulk_data_update(array['${priyaSlot}']::uuid[], null, 'received', null, null)`)).toMatch(/not allowed/)
    await as(OWNER)
  })
})

describe('a copy says where it is', () => {
  it('will not mark the main copy copied with nowhere named', async () => {
    const [{ id }] = (await q<{ id: string }>(`select id from shoot_data_records where slot_id = '${priyaSlot}'`)) as [{ id: string }]
    expect(await fails(`select set_data_track('${id}', 'primary', 'copied')`)).toMatch(/main copy/)
    await db.exec(`update shoot_data_records set primary_location_id = '${DISK}' where id = '${id}'`)
    await q(`select set_data_track('${id}', 'primary', 'copied')`)
    expect(await stageOf(priyaSlot)).toBe('copied')
  })
})

describe('bulk', () => {
  it('creates the missing record, then skips what a change does not fit', async () => {
    const received = await q<{ r: Record<string, number> }>(
      `select bulk_data_update(array['${amanSlot}']::uuid[], null, 'received', null, null) as r`,
    )
    expect(received[0]!.r).toEqual({ updated: 1, created: 1, skipped: 0 })
    expect(await stageOf(amanSlot)).toBe('received')

    // Backup needs a main copy first: Aman's is skipped, Priya's goes.
    const backed = await q<{ r: Record<string, number> }>(
      `select bulk_data_update(array['${amanSlot}', '${priyaSlot}']::uuid[], null, 'backed_up', '${CLOUD}', '/2026/Haldi') as r`,
    )
    expect(backed[0]!.r).toEqual({ updated: 1, created: 0, skipped: 1 })
    expect(await stageOf(priyaSlot)).toBe('backed_up')
  })

  it('verifies with who did it, and archives after', async () => {
    await q(`select bulk_data_update(array['${priyaSlot}']::uuid[], null, 'verified', null, null)`)
    const [v] = await q<{ data_status: string; verified_by: string }>(
      `select data_status, verified_by from shoot_data_records where slot_id = '${priyaSlot}'`,
    )
    expect(v).toEqual({ data_status: 'verified', verified_by: OWNER })
    await q(`select bulk_data_update(array['${priyaSlot}']::uuid[], null, 'archived', '${DISK}', null)`)
    const [a] = await q<{ data_status: string; verified_by: string }>(
      `select data_status, verified_by from shoot_data_records where slot_id = '${priyaSlot}'`,
    )
    // Archiving keeps the verification.
    expect(a).toEqual({ data_status: 'archived', verified_by: OWNER })
  })

  it('needs a location for a copy', async () => {
    expect(await fails(`select bulk_data_update(array['${amanSlot}']::uuid[], null, 'copied', null, null)`)).toMatch(/pick a location/)
  })
})

describe('evening reminders', () => {
  it('nags the person still holding cards and sends managers one digest, again the next day', async () => {
    const SHOOT2 = 'f0000000-0000-4000-8000-0000000000d2'
    await db.exec(`insert into shoots (id, company_id, project_id, name, shoot_date) values ('${SHOOT2}', '${COMPANY}', '${PROJECT}', 'Sangeet', '2026-09-21')`)
    await q(`select book_team_slot('${AMAN}', '${SHOOT2}', 'Cinematographer', '2026-09-21T12:00:00Z', '2026-09-21T16:00:00Z')`)
    const run = (at: string) => q<{ s: Record<string, number> }>(`select run_data_reminder_cron(false, '${at}') as s`)

    // Before 6 pm in India: nothing.
    expect((await run('2026-09-24T06:00:00Z'))[0]!.s.notifications_created).toBe(0)
    const first = (await run('2026-09-24T13:00:00Z'))[0]!.s
    expect(first.crew_reminders).toBe(1)
    const aman = await q<{ title: string; body: string }>(
      `select title, body from notifications where recipient_uid = '${AMAN}' and type = 'data.handover'`,
    )
    expect(aman).toEqual([{ title: 'Hand over your cards: Sangeet', body: expect.stringContaining('3 days ago') }])
    const digest = await q<{ title: string; body: string; severity: string }>(
      `select title, body, severity from notifications where recipient_uid = '${OWNER}' and type = 'data.digest'`,
    )
    expect(digest).toHaveLength(1)
    expect(digest[0]!.body).toContain('1 not handed over')

    // Same evening again: deduped. Next evening: again.
    expect((await run('2026-09-24T14:00:00Z'))[0]!.s.notifications_created).toBe(0)
    expect((await run('2026-09-25T13:00:00Z'))[0]!.s.notifications_created).toBeGreaterThan(0)
  })
})
