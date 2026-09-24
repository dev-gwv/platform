import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0166: a studio's own stages, assign-starts-it, submitted work moving the
 * deliverable, and "Suggest a feature" kept to its sender and the platform.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'd0000000-0000-4000-8000-000000000001'
const EDITOR = 'd0000000-0000-4000-8000-000000000002'
const OTHER_OWNER = 'd0000000-0000-4000-8000-000000000003'
const COMPANY = 'd0000000-0000-4000-8000-0000000000aa'
const OTHER = 'd0000000-0000-4000-8000-0000000000ab'
const CLIENT = 'd0000000-0000-4000-8000-0000000000c1'
const OTHER_CLIENT = 'd0000000-0000-4000-8000-0000000000c2'
const PROJECT = 'd0000000-0000-4000-8000-0000000000b1'
const OTHER_PROJECT = 'd0000000-0000-4000-8000-0000000000b2'
const DELIVERABLE = 'd0000000-0000-4000-8000-0000000000d1'
const OTHER_FILE = 'd0000000-0000-4000-8000-0000000000f2'
const FILE = 'd0000000-0000-4000-8000-0000000000f1'

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
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${EDITOR}', 'e@s.test'), ('${OTHER_OWNER}', 'x@t.test');
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${EDITOR}', '${COMPANY}', 'employee', 'Rahul', 'e@s.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@t.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma'), ('${OTHER_CLIENT}', '${OTHER}', 'Them');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}'),
      ('${OTHER_PROJECT}', '${OTHER}', '${OTHER_CLIENT}', 'Their wedding', 1, '${OTHER_OWNER}');
    insert into deliverables (id, company_id, project_id, title) values
      ('${DELIVERABLE}', '${COMPANY}', '${PROJECT}', 'Wedding Film');
    insert into files (id, company_id, name, mime, size_bytes, bytes) values
      ('${FILE}', '${COMPANY}', 'note.webm', 'audio/webm', 3, '\\x010203'),
      ('${OTHER_FILE}', '${OTHER}', 'theirs.webm', 'audio/webm', 3, '\\x010203');
  `)
})


beforeEach(async () => {
  await db.exec(`reset role; delete from deliverable_notes; delete from notifications; delete from team_work_submissions; delete from feature_requests; delete from platform_admins;`)
  await db.exec(`update deliverables set status = 'pending', custom_status_code = null, assignee_id = null, delivery_link = null where id = '${DELIVERABLE}';`)
  await db.exec(`delete from deliverable_notes;`)
  await as(OWNER)
})

const d = async () =>
  (await q<{ status: string; custom_status_code: string | null; delivery_link: string | null }>(
    `select status, custom_status_code, delivery_link from deliverables where id = '${DELIVERABLE}'`,
  ))[0]!
const events = async () =>
  (await q<{ body: string }>(
    `select body from deliverable_notes where deliverable_id = '${DELIVERABLE}' and kind = 'event' order by created_at, body`,
  )).map((r) => r.body)

describe('stages', () => {
  it('seeds five named stages for every studio, new ones included', async () => {
    const codes = (await q<{ code: string; stage: string }>(
      `select code, stage from company_deliverable_statuses where company_id = '${COMPANY}' order by stage, sort_order`,
    )).map((r) => `${r.stage}:${r.code}`)
    expect(codes).toEqual([
      'in_progress:changes_requested',
      'review:with_manager',
      'review:approved',
      'review:with_client',
      'review:client_approved',
    ])
    await db.exec(`insert into companies (id, name, owner_user_id) values ('d0000000-0000-4000-8000-0000000000ac', 'New', '${OWNER}')`)
    expect(await q(`select 1 from company_deliverable_statuses where company_id = 'd0000000-0000-4000-8000-0000000000ac'`)).toHaveLength(5)
  })

  it('starts the work when an editor is given it', async () => {
    await db.exec(`update deliverables set assignee_id = '${EDITOR}' where id = '${DELIVERABLE}'`)
    expect((await d()).status).toBe('in_progress')
    expect(await events()).toEqual(['moved:in_progress'])
  })

  it('does not pull back work already further along when the editor changes', async () => {
    await db.exec(`update deliverables set status = 'review', custom_status_code = 'with_client' where id = '${DELIVERABLE}'`)
    await db.exec(`update deliverables set assignee_id = '${EDITOR}' where id = '${DELIVERABLE}'`)
    expect(await d()).toMatchObject({ status: 'review', custom_status_code: 'with_client' })
  })

  it('records the named stage in the timeline', async () => {
    await db.exec(`update deliverables set status = 'review', custom_status_code = 'approved' where id = '${DELIVERABLE}'`)
    await db.exec(`update deliverables set custom_status_code = 'client_approved' where id = '${DELIVERABLE}'`)
    expect(await events()).toEqual(['moved:review:approved', 'moved:review:client_approved'])
  })

  it('refuses a stage from the wrong step or another studio, and drops one left behind', async () => {
    await expect(db.query(`update deliverables set status = 'pending', custom_status_code = 'approved' where id = '${DELIVERABLE}'`)).rejects.toThrow(/not one of this studio/)
    await db.exec(`insert into company_deliverable_statuses (company_id, code, label, category, stage) values ('${OTHER}', 'theirs', 'Theirs', 'in_progress', 'in_progress')`)
    await expect(db.query(`update deliverables set status = 'in_progress', custom_status_code = 'theirs' where id = '${DELIVERABLE}'`)).rejects.toThrow()
    await db.exec(`update deliverables set status = 'review', custom_status_code = 'with_client' where id = '${DELIVERABLE}'`)
    await db.exec(`update deliverables set status = 'completed' where id = '${DELIVERABLE}'`)
    expect(await d()).toMatchObject({ status: 'completed', custom_status_code: null })
  })
})

describe('submitted work moves the deliverable', () => {
  const submit = async (link = 'https://drive.test/v1') => {
    // Grants come from the hosted bootstrap, which pglite skips; the rules
    // under test are triggers, which run the same either way.
    await as(EDITOR)
    const [row] = await q<{ id: string }>(`
      insert into team_work_submissions (company_id, deliverable_id, submitted_by, submission_link, status)
      values ('${COMPANY}', '${DELIVERABLE}', '${EDITOR}', '${link}', 'submitted') returning id`)
    await as(OWNER)
    return row!.id
  }

  beforeEach(async () => {
    await db.exec(`update deliverables set assignee_id = '${EDITOR}' where id = '${DELIVERABLE}'`)
    await db.exec(`delete from deliverable_notes;`)
  })

  it('goes to Review · With manager with the link, and says so once', async () => {
    const id = await submit()
    expect(await d()).toMatchObject({ status: 'review', custom_status_code: 'with_manager', delivery_link: 'https://drive.test/v1' })
    expect(await events()).toEqual([`submitted:${id}`])
    expect((await q<{ project_id: string }>(`select project_id from team_work_submissions where id = '${id}'`))[0]!.project_id).toBe(PROJECT)
  })

  it('approving moves it to Approved', async () => {
    const id = await submit()
    await db.exec(`select review_work('${id}', true, null)`)
    expect(await d()).toMatchObject({ status: 'review', custom_status_code: 'approved' })
    expect(await events()).toContain(`approved:${id}`)
  })

  it('sending it back moves it to Changes requested and tells the editor what to change', async () => {
    const id = await submit()
    await db.exec(`select review_work('${id}', false, 'Trim the first dance to 3 minutes')`)
    expect(await d()).toMatchObject({ status: 'in_progress', custom_status_code: 'changes_requested' })
    expect(await events()).toContain(`sent_back:${id}`)
    const notes = await q<{ body: string; author_id: string }>(`select body, author_id from deliverable_notes where kind = 'text'`)
    expect(notes).toEqual([{ body: 'Trim the first dance to 3 minutes', author_id: OWNER }])
    const told = await q<{ type: string }>(`select type from notifications where recipient_uid = '${EDITOR}'`)
    expect(told.map((t) => t.type)).toContain('deliverable_note')
  })

  it('refuses a deliverable from another studio or another project', async () => {
    await expect(db.query(`
      insert into team_work_submissions (company_id, deliverable_id, project_id, submitted_by, status)
      values ('${COMPANY}', '${DELIVERABLE}', '${OTHER_PROJECT}', '${EDITOR}', 'submitted')`)).rejects.toThrow()
    await expect(db.query(`
      insert into team_work_submissions (company_id, deliverable_id, submitted_by, status)
      values ('${OTHER}', '${DELIVERABLE}', '${OTHER_OWNER}', 'submitted')`)).rejects.toThrow(/not in this studio/)
  })
})

describe('suggest a feature', () => {
  const suggest = async (user: string, company: string, body: string) => {
    await as(user)
    await db.exec(`set role authenticated;`)
    await db.exec(`insert into feature_requests (company_id, user_id, body, page_url) values ('${company}', '${user}', '${body}', '/projects')`)
    await db.exec(`reset role;`)
  }

  it('keeps each suggestion to its sender, and the platform reads them all', async () => {
    await suggest(EDITOR, COMPANY, 'Bulk WhatsApp to clients')
    await suggest(OTHER_OWNER, OTHER, 'Dark mode on invoices')
    await as(OWNER)
    await db.exec(`set role authenticated;`)
    expect(await q(`select 1 from feature_requests`)).toHaveLength(0)
    await expect(db.query(`select * from platform_list_feature_requests(null)`)).rejects.toThrow(/not allowed/)
    await db.exec(`reset role;`)
    await db.exec(`insert into platform_admins (user_id) values ('${OWNER}')`)
    await db.exec(`set role authenticated;`)
    const all = await q<{ body: string; company_name: string; user_name: string }>(`select body, company_name, user_name from platform_list_feature_requests(null)`)
    expect(all.map((r) => r.body).sort()).toEqual(['Bulk WhatsApp to clients', 'Dark mode on invoices'])
    await db.exec(`reset role;`)
  })

  it('refuses one with nothing in it, or for someone else', async () => {
    await as(EDITOR)
    await db.exec(`set role authenticated;`)
    await expect(db.query(`insert into feature_requests (company_id, user_id, body) values ('${COMPANY}', '${EDITOR}', '  ')`)).rejects.toThrow()
    await expect(db.query(`insert into feature_requests (company_id, user_id, body) values ('${COMPANY}', '${OWNER}', 'x')`)).rejects.toThrow()
    await db.exec(`reset role;`)
  })
})
