import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0234: Simple delivery mode. A Full studio's hand-in always goes to review,
 * whatever the request said; a Simple studio's is Delivered as it lands, can
 * still be sent back, and its editor can fix the link afterwards.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e3400000-0000-4000-8000-000000000001'
const EDITOR = 'e3400000-0000-4000-8000-000000000002'
const COMPANY = 'e3400000-0000-4000-8000-0000000000aa'
const CLIENT = 'e3400000-0000-4000-8000-0000000000c1'
const PROJECT = 'e3400000-0000-4000-8000-0000000000b1'
const DELIVERABLE = 'e3400000-0000-4000-8000-0000000000d1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)

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
  // The hosted bootstrap grants these; pglite skips it.
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant select, insert, update on all tables in schema public to authenticated;
    grant execute on all functions in schema public, auth to authenticated;
  `)
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@sd.test'), ('${EDITOR}', 'e@sd.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@sd.test'),
      ('${EDITOR}', '${COMPANY}', 'employee', 'Rahul', 'e@sd.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
    insert into deliverables (id, company_id, project_id, title, assignee_id) values
      ('${DELIVERABLE}', '${COMPANY}', '${PROJECT}', 'Wedding Film', '${EDITOR}');
  `)
})

beforeEach(async () => {
  await db.exec(`reset role; delete from team_work_submissions; delete from deliverable_notes;`)
  await db.exec(`update deliverables set status = 'in_progress', custom_status_code = null, delivery_link = null where id = '${DELIVERABLE}';`)
  await db.exec(`update companies set delivery_flow = 'full' where id = '${COMPANY}';`)
})

/** The editor hands in, as the API does: as `authenticated`, under RLS. */
const handIn = async (extra = '', link = 'https://drive.test/v1') => {
  await as(EDITOR)
  await db.exec(`set role authenticated`)
  const [row] = await q<{ id: string; status: string; review_required: boolean }>(`
    insert into team_work_submissions (company_id, deliverable_id, project_id, submitted_by, submission_link${extra ? ', ' + extra.split('=')[0] : ''})
    values ('${COMPANY}', '${DELIVERABLE}', '${PROJECT}', '${EDITOR}', '${link}'${extra ? ', ' + extra.split('=')[1] : ''})
    returning id, status, review_required`)
  await db.exec(`reset role`)
  return row!
}
const d = async () =>
  (await q<{ status: string; custom_status_code: string | null; delivery_link: string | null }>(
    `select status, custom_status_code, delivery_link from deliverables where id = '${DELIVERABLE}'`,
  ))[0]!

describe('Full studio', () => {
  it('starts every studio on Full', async () => {
    const [c] = await q<{ delivery_flow: string }>(`select delivery_flow from companies where id = '${COMPANY}'`)
    expect(c!.delivery_flow).toBe('full')
    await expect(db.query(`update companies set delivery_flow = 'quick' where id = '${COMPANY}'`)).rejects.toThrow()
  })

  it('sends a hand-in to review even when it asks to skip it', async () => {
    const row = await handIn('review_required=false')
    expect(row).toMatchObject({ status: 'submitted', review_required: true })
    expect(await d()).toMatchObject({ status: 'review', custom_status_code: 'with_manager' })
  })

  it('never lets an editor post a hand-in already approved', async () => {
    const row = await handIn("status='approved'")
    expect(row.status).toBe('submitted')
  })
})

describe('Simple studio', () => {
  beforeEach(async () => {
    await db.exec(`update companies set delivery_flow = 'simple' where id = '${COMPANY}';`)
  })

  it('delivers a hand-in as it lands', async () => {
    const row = await handIn()
    expect(row).toMatchObject({ status: 'approved', review_required: false })
    expect(await d()).toMatchObject({ status: 'completed', delivery_link: 'https://drive.test/v1' })
  })

  it('reopens Editing when a manager sends it back', async () => {
    const row = await handIn()
    await as(OWNER)
    await db.exec(`set role authenticated`)
    await db.exec(`select review_work('${row.id}', false, 'Colour is off')`)
    await db.exec(`reset role`)
    expect(await d()).toMatchObject({ status: 'in_progress', custom_status_code: 'changes_requested' })
  })

  it('lets the editor fix the link, and only the link', async () => {
    const row = await handIn()
    await as(EDITOR)
    await db.exec(`set role authenticated`)
    await db.exec(`update team_work_submissions set submission_link = 'https://drive.test/v2' where id = '${row.id}'`)
    await db.exec(`update team_work_submissions set status = 'sent', review_required = true where id = '${row.id}'`)
    await db.exec(`reset role`)
    const [s] = await q<{ submission_link: string; status: string; review_required: boolean }>(
      `select submission_link, status, review_required from team_work_submissions where id = '${row.id}'`,
    )
    expect(s).toMatchObject({ submission_link: 'https://drive.test/v2', status: 'approved', review_required: false })
    expect((await d()).delivery_link).toBe('https://drive.test/v2')
  })
})
