import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0193: is the studio free on that date?
 *
 * The join that did not exist. A lead carries an event_date, the studio's
 * shoots carry a shoot_date, and until this migration nothing compared them —
 * so a date the studio was already shooting looked identical to an empty one.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a0000000-0000-4000-8000-000000000001'
const OTHER_OWNER = 'a0000000-0000-4000-8000-000000000002'
const COMPANY = 'a0000000-0000-4000-8000-0000000000aa'
const OTHER = 'a0000000-0000-4000-8000-0000000000ab'
const CLIENT = 'a0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'a0000000-0000-4000-8000-0000000000b1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)

/** What the app asks: the status of one date, the way selectLead joins it. */
const statusOf = async (date: string) => {
  const rows = await q<{ status: string; wanted_by: number }>(
    `select status, wanted_by from crm_date_availability() where on_date = '${date}'`,
  )
  return rows[0] ?? { status: 'free', wanted_by: 0 }
}

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${OTHER_OWNER}', 'x@t.test');
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@t.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by)
      values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
  `)
})

beforeEach(async () => {
  await db.exec(`delete from crm_leads; delete from shoots;`)
  await as(OWNER)
})

const lead = (name: string, date: string | null, extra = '') =>
  `insert into crm_leads (company_id, name, phone, event_date, source ${extra ? ', status' : ''})
     values ('${COMPANY}', '${name}', '9${Math.floor(Math.random() * 1e9)}',
             ${date ? `'${date}'` : 'null'}, 'manual' ${extra ? `, '${extra}'` : ''});`

describe('0193: date availability', () => {
  it('one lead on an empty day is free', async () => {
    await db.exec(lead('Aanya', '2027-12-14'))
    expect(await statusOf('2027-12-14')).toEqual({ status: 'free', wanted_by: 1 })
  })

  it('two open leads wanting the same day are contested, and it counts them', async () => {
    await db.exec(lead('Aanya', '2027-12-14'))
    await db.exec(lead('Kapoor', '2027-12-14'))
    expect(await statusOf('2027-12-14')).toEqual({ status: 'contested', wanted_by: 2 })
  })

  // A shoot on the day beats any number of people asking: the studio is not
  // free, and "contested" would invite selling a date already sold.
  it('a shoot on the day makes it booked, however many are asking', async () => {
    await db.exec(lead('Aanya', '2027-12-14'))
    await db.exec(lead('Kapoor', '2027-12-14'))
    await db.exec(
      `insert into shoots (company_id, project_id, name, shoot_date)
         values ('${COMPANY}', '${PROJECT}', 'Wedding Day', '2027-12-14');`,
    )
    expect((await statusOf('2027-12-14')).status).toBe('booked')
  })

  it('a booked day with nobody asking still reports booked', async () => {
    await db.exec(
      `insert into shoots (company_id, project_id, name, shoot_date)
         values ('${COMPANY}', '${PROJECT}', 'Reception', '2027-12-20');`,
    )
    expect(await statusOf('2027-12-20')).toEqual({ status: 'booked', wanted_by: 0 })
  })

  it('a won or lost lead is no longer a claim on the calendar', async () => {
    await db.exec(lead('Aanya', '2027-12-14'))
    await db.exec(lead('Gone', '2027-12-14'))
    // 0037 refuses a lost lead with no reason, and it checks on the way in —
    // so status and reason have to move together.
    await db.exec(`update crm_leads set status = 'lost', lost_reason = 'Went elsewhere' where name = 'Gone';`)
    expect(await statusOf('2027-12-14')).toEqual({ status: 'free', wanted_by: 1 })
  })

  it('an archived lead does not contest a date', async () => {
    await db.exec(lead('Aanya', '2027-12-14'))
    await db.exec(lead('Old', '2027-12-14'))
    await db.exec(`update crm_leads set is_archived = true where name = 'Old';`)
    expect(await statusOf('2027-12-14')).toEqual({ status: 'free', wanted_by: 1 })
  })

  it('a lead with no date produces no row at all', async () => {
    await db.exec(lead('Undated', null))
    const rows = await q<{ n: string }>(`select count(*)::text as n from crm_date_availability()`)
    expect(rows[0]!.n).toBe('0')
  })

  // The whole point of company scoping: another studio's busy December must
  // never make this studio look booked.
  it("another studio's shoots and leads are invisible", async () => {
    await as(OTHER_OWNER)
    await db.exec(`
      insert into clients (id, company_id, name) values ('${OTHER}', '${OTHER}', 'Theirs');
      insert into projects (id, company_id, client_id, name, package_cost, created_by)
        values ('a0000000-0000-4000-8000-0000000000b2', '${OTHER}', '${OTHER}', 'Their wedding', 1, '${OTHER_OWNER}');
      insert into shoots (company_id, project_id, name, shoot_date)
        values ('${OTHER}', 'a0000000-0000-4000-8000-0000000000b2', 'Theirs', '2027-12-14');
      insert into crm_leads (company_id, name, phone, event_date, source)
        values ('${OTHER}', 'Their lead', '9111111111', '2027-12-14', 'manual');
    `)
    await as(OWNER)
    await db.exec(lead('Aanya', '2027-12-14'))
    expect(await statusOf('2027-12-14')).toEqual({ status: 'free', wanted_by: 1 })

    await as(OTHER_OWNER)
    expect((await statusOf('2027-12-14')).status).toBe('booked')
  })

  it('answers for many dates in one pass', async () => {
    await db.exec(lead('A', '2027-12-14'))
    await db.exec(lead('B', '2027-12-14'))
    await db.exec(lead('C', '2027-12-18'))
    await db.exec(
      `insert into shoots (company_id, project_id, name, shoot_date)
         values ('${COMPANY}', '${PROJECT}', 'Shah', '2027-12-25');`,
    )
    const rows = await q<{ on_date: string; status: string }>(
      `select on_date::text, status from crm_date_availability() order by on_date`,
    )
    expect(rows.map((r) => r.status)).toEqual(['contested', 'free', 'booked'])
  })
})
