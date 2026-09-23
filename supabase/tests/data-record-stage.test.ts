import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * A data record per booking, and the stage it is at (0160).
 *
 * The stage (data_status) is derived from the two copy tracks by a trigger,
 * never set by a caller -- that is what closes the old bug where the page
 * sent 'received' and the column's check refused it. These pin the rules the
 * shoot card's Data chip reads, and that set_data_track is the guarded way
 * to move a track.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a0000000-0000-4000-8000-000000000001'
const SHOOTER = 'a0000000-0000-4000-8000-000000000002'
const COMPANY = 'a0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'a0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'a0000000-0000-4000-8000-0000000000b1'
const SHOOT = 'a0000000-0000-4000-8000-0000000000d1'
const SLOT = 'a0000000-0000-4000-8000-0000000000e1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${SHOOTER}', 's@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${SHOOTER}', '${COMPANY}', 'employee', 'Rahul', 's@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Client');
    insert into projects (id, company_id, client_id, name) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Wedding');
    insert into shoots (id, company_id, project_id, name, shoot_date) values
      ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Haldi', '2026-10-01');
    insert into team_assignment_slots (id, company_id, user_id, shoot_id, service_name, start_at, end_at)
      values ('${SLOT}', '${COMPANY}', '${SHOOTER}', '${SHOOT}', 'Candid Photographer',
              '2026-10-01T04:30:00Z', '2026-10-01T08:30:00Z');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

beforeEach(async () => {
  await db.exec(`delete from shoot_data_records;`)
})

const insert = async (extra = '') =>
  (
    await one<{ id: string }>(`
      insert into shoot_data_records (company_id, project_id, shoot_id, slot_id, user_id, data_label ${extra ? ', ' + extra.split('=')[0] : ''})
      values ('${COMPANY}', '${PROJECT}', '${SHOOT}', '${SLOT}', '${SHOOTER}', 'Haldi · Candid · Rahul'
              ${extra ? ', ' + extra.split('=').slice(1).join('=') : ''})
      returning id`)
  ).id

const stage = async (id: string) =>
  one<{ data_status: string; verified_at: string | null }>(`select data_status, verified_at from shoot_data_records where id = '${id}'`)

describe('the stage a record is at', () => {
  it('starts with the shooter, and is received once a date is set', async () => {
    const id = await insert()
    expect((await stage(id)).data_status).toBe('with_shooter')
    await db.exec(`update shoot_data_records set date_received = '2026-10-01' where id = '${id}'`)
    expect((await stage(id)).data_status).toBe('received')
  })

  it('moves copied → backed up → verified as the tracks do, stamping verified_at only at the end', async () => {
    const id = await insert()
    await db.exec(`select set_data_track('${id}', 'primary', 'copied')`)
    expect((await stage(id)).data_status).toBe('copied')
    await db.exec(`select set_data_track('${id}', 'backup', 'not_required')`)
    expect(await stage(id)).toMatchObject({ data_status: 'backed_up', verified_at: null })
    await db.exec(`select set_data_track('${id}', 'primary', 'verified')`)
    const done = await stage(id)
    expect(done.data_status).toBe('verified')
    expect(done.verified_at).not.toBeNull()
    // Undoing a verification takes the stamp away again.
    await db.exec(`select set_data_track('${id}', 'primary', 'copied')`)
    expect(await stage(id)).toMatchObject({ data_status: 'backed_up', verified_at: null })
  })

  it('lets an issue on either copy outrank progress', async () => {
    const id = await insert()
    await db.exec(`select set_data_track('${id}', 'primary', 'verified')`)
    await db.exec(`select set_data_track('${id}', 'backup', 'issue')`)
    expect((await stage(id)).data_status).toBe('issue')
  })

  it('ignores a stage written by a caller -- the old "received" bug cannot come back', async () => {
    const id = await insert(`data_status='received'`)
    expect((await stage(id)).data_status).toBe('with_shooter')
    await db.exec(`update shoot_data_records set data_status = 'verified' where id = '${id}'`)
    expect((await stage(id)).data_status).toBe('with_shooter')
  })

  it('keeps verify_data_record working, through set_data_track', async () => {
    const id = await insert()
    await db.exec(`select verify_data_record('${id}', 'primary')`)
    await db.exec(`select verify_data_record('${id}', 'backup')`)
    expect((await stage(id)).data_status).toBe('verified')
  })
})

describe('set_data_track', () => {
  it('refuses a status the track does not take', async () => {
    const id = await insert()
    await expect(db.exec(`select set_data_track('${id}', 'primary', 'not_required')`)).rejects.toThrow(/invalid status/)
    await expect(db.exec(`select set_data_track('${id}', 'backup', 'bogus')`)).rejects.toThrow(/invalid status/)
    await expect(db.exec(`select set_data_track('${id}', 'sideways', 'copied')`)).rejects.toThrow(/invalid track/)
  })

  it('refuses an inactive caller', async () => {
    const id = await insert()
    await db.exec(`update users set status = 'inactive' where user_id = '${OWNER}'`)
    try {
      await expect(db.exec(`select set_data_track('${id}', 'primary', 'copied')`)).rejects.toThrow(/not allowed/)
    } finally {
      await db.exec(`update users set status = 'active' where user_id = '${OWNER}'`)
    }
  })
})

describe('the link to the booking', () => {
  it('outlives the booking: removing the slot keeps the record, just unlinked', async () => {
    const id = await insert()
    await db.exec(`
      insert into team_assignment_slots (id, company_id, user_id, shoot_id, service_name, start_at, end_at)
        values ('a0000000-0000-4000-8000-0000000000e2', '${COMPANY}', '${SHOOTER}', '${SHOOT}', 'Drone',
                '2026-10-02T04:30:00Z', '2026-10-02T08:30:00Z');
      update shoot_data_records set slot_id = 'a0000000-0000-4000-8000-0000000000e2' where id = '${id}';
      delete from team_assignment_slots where id = 'a0000000-0000-4000-8000-0000000000e2';`)
    const row = await one<{ slot_id: string | null; user_id: string }>(
      `select slot_id, user_id from shoot_data_records where id = '${id}'`,
    )
    expect(row).toEqual({ slot_id: null, user_id: SHOOTER })
  })
})
