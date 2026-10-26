import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0285: what is made can be changed back -- a hand-in taken back, an arrival
 * undone, a payout emptied, a task made for oneself edited and deleted, a
 * deleted wedding anniversary that stays deleted, a note's words changed.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e8500000-0000-4000-8000-000000000001'
const NITIN = 'e8500000-0000-4000-8000-000000000002'
const ASHA = 'e8500000-0000-4000-8000-000000000003'
const COMPANY = 'e8500000-0000-4000-8000-0000000000aa'
const CLIENT = 'e8500000-0000-4000-8000-0000000000c1'
const PROJECT = 'e8500000-0000-4000-8000-0000000000b1'
const SHOOT = 'e8500000-0000-4000-8000-0000000000d1'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const one = async <T>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0]!
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)
const fails = (sql: string, params: unknown[] = []) => db.query(sql, params).then(() => null, (e: Error) => e.message)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  // Safe to run twice: a deploy may apply it again.
  await db.exec(readFileSync(join(migDir, '0285_edit_and_undo_work.sql'), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${NITIN}', 'n@s.test'), ('${ASHA}', 'a@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test', 'active'),
      ('${NITIN}', '${COMPANY}', 'employee', 'Nitin', 'n@s.test', 'active'),
      ('${ASHA}', '${COMPANY}', 'employee', 'Asha', 'a@s.test', 'active');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
    insert into shoots (id, company_id, project_id, name, shoot_date, location) values
      ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Haldi', current_date, 'Jaipur');
  `)
})

describe('a hand-in taken back', () => {
  const handIn = async (by: string) => {
    const d = await one<{ id: string }>(
      `insert into deliverables (company_id, project_id, title, assignee_id) values ($1, $2, 'Teaser', $3) returning id`,
      [COMPANY, PROJECT, by],
    )
    await as(by)
    const s = await one<{ id: string }>(
      `insert into team_work_submissions (company_id, project_id, deliverable_id, submitted_by, submission_link)
       values ($1, $2, $3, $4, 'https://drive.example/teaser') returning id`,
      [COMPANY, PROJECT, d.id, by],
    )
    return { deliverable: d.id, submission: s.id }
  }

  it('goes, and the deliverable is back in editing', async () => {
    const { deliverable, submission } = await handIn(NITIN)
    expect((await one<{ status: string }>(`select status::text from deliverables where id = $1`, [deliverable])).status).toBe('review')
    await as(NITIN)
    expect((await one<{ r: string }>(`select withdraw_submission($1) as r`, [submission])).r).toBe('ok')
    expect(await q(`select 1 from team_work_submissions where id = $1`, [submission])).toEqual([])
    const d = await one<{ status: string; code: string | null }>(
      `select status::text, custom_status_code as code from deliverables where id = $1`,
      [deliverable],
    )
    expect(d).toEqual({ status: 'in_progress', code: null })
    const [ev] = await q<{ body: string }>(`select body from deliverable_notes where deliverable_id = $1 and kind = 'event' order by created_at desc limit 1`, [deliverable])
    expect(ev!.body).toBe(`withdrawn:${submission}`)
  })

  it('is only for the person who handed it in, and only before review', async () => {
    const { submission } = await handIn(NITIN)
    await as(ASHA)
    expect((await one<{ r: string }>(`select withdraw_submission($1) as r`, [submission])).r).toBe('not_yours')
    await as(OWNER)
    await q(`select review_work($1, true)`, [submission])
    await as(NITIN)
    expect((await one<{ r: string }>(`select withdraw_submission($1) as r`, [submission])).r).toBe('reviewed')
  })

  it('a review decision can be changed: approved, then sent back', async () => {
    const { deliverable, submission } = await handIn(NITIN)
    await as(OWNER)
    await q(`select review_work($1, true)`, [submission])
    await q(`select review_work($1, false, 'Colour is off')`, [submission])
    expect((await one<{ status: string }>(`select status from team_work_submissions where id = $1`, [submission])).status).toBe('rejected')
    expect((await one<{ status: string }>(`select status::text from deliverables where id = $1`, [deliverable])).status).toBe('in_progress')
  })
})

describe('an arrival undone', () => {
  it("takes off the stamp and the shoot-day attendance, for a manager only", async () => {
    await as(OWNER)
    const { id } = await one<{ id: string }>(
      `select book_team_slot($1, $2, 'Candid', now() - interval '1 hour', now() + interval '4 hours') as id`,
      [NITIN, SHOOT],
    )
    await db.exec(`update team_assignment_slots set arrived_at = now(), arrived_lat = 26.9 where id = '${id}'`)
    await q(
      `insert into attendance (company_id, user_id, a_date, status, source, slot_id, check_in_at) values ($1, $2, current_date, 'present', 'shoot', $3, now())`,
      [COMPANY, NITIN, id],
    )
    await as(NITIN)
    expect(await fails(`select unmark_arrived($1)`, [id])).toMatch(/not allowed/)
    await as(OWNER)
    expect((await one<{ ok: boolean }>(`select unmark_arrived($1) as ok`, [id])).ok).toBe(true)
    expect(await one(`select arrived_at, arrived_lat from team_assignment_slots where id = $1`, [id])).toEqual({ arrived_at: null, arrived_lat: null })
    expect(await q(`select 1 from attendance where slot_id = $1`, [id])).toEqual([])
    // Nothing to undo the second time.
    expect((await one<{ ok: boolean }>(`select unmark_arrived($1) as ok`, [id])).ok).toBe(false)
  })
})

describe('a payout emptied', () => {
  let day = 1
  const booked = async () => {
    await as(OWNER)
    day += 1
    const { id } = await one<{ id: string }>(
      `select book_team_slot($1, $2, 'Candid', now() + make_interval(days => $3), now() + make_interval(days => $3, hours => 5), 12000) as id`,
      [ASHA, SHOOT, day],
    )
    await q(`select set_slot_cost($1, null, 12000, 'final', 'Agreed on call')`, [id])
    return id
  }

  it('clears the amounts and the note, and the payout is not decided', async () => {
    const id = await booked()
    await q(`select clear_slot_cost($1, $2::text[])`, [id, ['estimated_cost', 'final_cost', 'cost_notes']])
    expect(
      await one(`select estimated_cost, final_cost, cost_notes, cost_status from team_assignment_slots where id = $1`, [id]),
    ).toEqual({ estimated_cost: null, final_cost: null, cost_notes: null, cost_status: 'not_decided' })
  })

  it('clears just the note, keeping the money', async () => {
    const id = await booked()
    await q(`select clear_slot_cost($1, $2::text[])`, [id, ['cost_notes']])
    const r = await one<{ final_cost: string; cost_notes: string | null; cost_status: string }>(
      `select final_cost::text, cost_notes, cost_status from team_assignment_slots where id = $1`,
      [id],
    )
    expect(r).toEqual({ final_cost: '12000.00', cost_notes: null, cost_status: 'final' })
  })

  it('will not empty a payout that money was paid against', async () => {
    const id = await booked()
    await q(`select * from create_payout_settlement($1, 5000)`, [id])
    expect(await fails(`select clear_slot_cost($1, $2::text[])`, [id, ['estimated_cost', 'final_cost']])).toMatch(/paid/)
  })
})

describe('a task made for oneself', () => {
  const ownTask = async (by: string) => {
    await as(by)
    const { id } = await one<{ id: string }>(
      `insert into tasks (company_id, title, status, created_by) values ($1, 'Back up cards', 'to_do', $2) returning id`,
      [COMPANY, by],
    )
    await q(`insert into task_assignees (task_id, user_id, company_id) values ($1, $2, $3)`, [id, by, COMPANY])
    return id
  }

  it('is edited, ticked done and reopened by its maker', async () => {
    const id = await ownTask(NITIN)
    await as(NITIN)
    expect((await one<{ ok: boolean }>(`select is_own_task($1) as ok`, [id])).ok).toBe(true)
    await q(`select update_own_task($1, $2::jsonb)`, [id, JSON.stringify({ title: 'Back up Haldi cards', due_date: '2026-11-02' })])
    await q(`select update_own_task($1, $2::jsonb)`, [id, JSON.stringify({ status: 'completed' })])
    expect(await one(`select title, due_date::text as due, status::text from tasks where id = $1`, [id])).toEqual({
      title: 'Back up Haldi cards',
      due: '2026-11-02',
      status: 'completed',
    })
    await q(`select update_own_task($1, $2::jsonb)`, [id, JSON.stringify({ status: 'to_do', due_date: null })])
    expect(await one(`select due_date, status::text from tasks where id = $1`, [id])).toEqual({ due_date: null, status: 'to_do' })
    expect(await fails(`select update_own_task($1, $2::jsonb)`, [id, JSON.stringify({ status: 'review' })])).toMatch(/Submit work/)
  })

  it('is not someone else’s to change, nor one with others on it', async () => {
    const id = await ownTask(NITIN)
    await as(ASHA)
    expect(await fails(`select update_own_task($1, $2::jsonb)`, [id, JSON.stringify({ title: 'x' })])).toMatch(/not your task/)
    expect((await one<{ ok: boolean }>(`select delete_own_task($1) as ok`, [id])).ok).toBe(false)
    await q(`insert into task_assignees (task_id, user_id, company_id) values ($1, $2, $3)`, [id, ASHA, COMPANY])
    await as(NITIN)
    expect((await one<{ ok: boolean }>(`select is_own_task($1) as ok`, [id])).ok).toBe(false)
  })

  it('is deleted by its maker', async () => {
    const id = await ownTask(NITIN)
    await as(NITIN)
    expect((await one<{ ok: boolean }>(`select delete_own_task($1) as ok`, [id])).ok).toBe(true)
    expect(await q(`select 1 from tasks where id = $1`, [id])).toEqual([])
  })
})

describe('a deleted wedding anniversary', () => {
  it('does not come back when the wedding day moves', async () => {
    await as(OWNER)
    const { id: wedding } = await one<{ id: string }>(
      `insert into shoots (company_id, project_id, name, shoot_date) values ($1, $2, 'Wedding', '2026-12-12') returning id`,
      [COMPANY, PROJECT],
    )
    const made = await q<{ id: string; source: string }>(
      `select id, source from client_occasions where client_id = $1 and kind = 'anniversary'`,
      [CLIENT],
    )
    expect(made).toHaveLength(1)
    expect(made[0]!.source).toBe('wedding_day')
    // What the API's delete does for a wedding-day anniversary.
    await q(`delete from client_occasions where id = $1`, [made[0]!.id])
    await q(`insert into client_occasion_dismissals (company_id, client_id, kind, person_name) values ($1, $2, 'anniversary', '')`, [COMPANY, CLIENT])
    await q(`update shoots set shoot_date = '2026-12-13' where id = $1`, [wedding])
    expect(await q(`select 1 from client_occasions where client_id = $1 and kind = 'anniversary'`, [CLIENT])).toEqual([])
  })
})

describe('a note edited', () => {
  it('keeps the words its author typed and when they changed', async () => {
    await as(NITIN)
    const { id: d } = await one<{ id: string }>(
      `insert into deliverables (company_id, project_id, title, assignee_id) values ($1, $2, 'Album', $3) returning id`,
      [COMPANY, PROJECT, NITIN],
    )
    const { id } = await one<{ id: string }>(
      `insert into deliverable_notes (deliverable_id, kind, body, author_id) values ($1, 'text', 'Warmer tones', $2) returning id`,
      [d, NITIN],
    )
    await q(`update deliverable_notes set body = 'Warmer tones on the reception', edited_at = now() where id = $1`, [id])
    const n = await one<{ body: string; edited: boolean }>(`select body, edited_at is not null as edited from deliverable_notes where id = $1`, [id])
    expect(n).toEqual({ body: 'Warmer tones on the reception', edited: true })
  })
})

describe("the client's events the studio said no to", () => {
  it('keeps one row per event and day', async () => {
    const add = (name: string, date: string | null) =>
      q(
        `insert into client_detail_dismissals (company_id, project_id, name, event_date) values ($1, $2, $3, $4) on conflict do nothing`,
        [COMPANY, PROJECT, name, date],
      )
    await add('Mehendi', '2026-12-10')
    await add(' mehendi', '2026-12-10')
    await add('Mehendi', null)
    await add('Mehendi', null)
    expect((await one<{ n: number }>(`select count(*)::int as n from client_detail_dismissals where project_id = $1`, [PROJECT])).n).toBe(2)
  })
})
