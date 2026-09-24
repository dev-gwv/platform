import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Deliverable notes (0165): written and voice notes on a deliverable, a stage
 * history the database writes itself, and a notification to the other side.
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
    insert into deliverables (id, company_id, project_id, title, assignee_id) values
      ('${DELIVERABLE}', '${COMPANY}', '${PROJECT}', 'Wedding Film', '${EDITOR}');
    insert into files (id, company_id, name, mime, size_bytes, bytes) values
      ('${FILE}', '${COMPANY}', 'note.webm', 'audio/webm', 3, '\\x010203'),
      ('${OTHER_FILE}', '${OTHER}', 'theirs.webm', 'audio/webm', 3, '\\x010203');
  `)
})

beforeEach(async () => {
  await db.exec(`delete from deliverable_notes; delete from notifications;`)
  await db.exec(`update deliverables set status = 'pending', title = 'Wedding Film' where id = '${DELIVERABLE}';`)
  await db.exec(`delete from deliverable_notes;`)
  await as(OWNER)
})

const notesOf = () =>
  q<{ kind: string; body: string | null; author_id: string | null; company_id: string }>(
    `select kind, body, author_id, company_id from deliverable_notes where deliverable_id = '${DELIVERABLE}' order by created_at, kind`,
  )
const notificationsFor = (user: string) =>
  q<{ type: string; title: string; deep_link: string | null }>(
    `select type, title, deep_link from notifications where recipient_uid = '${user}'`,
  )

describe('notes', () => {
  it('takes the company from the deliverable and the author from the session', async () => {
    await db.exec(`insert into deliverable_notes (deliverable_id, kind, body) values ('${DELIVERABLE}', 'text', 'Warmer tones please')`)
    const [n] = await notesOf()
    expect(n).toMatchObject({ kind: 'text', body: 'Warmer tones please', author_id: OWNER, company_id: COMPANY })
  })

  it('stores a voice note with its recording, and refuses one without', async () => {
    await db.exec(
      `insert into deliverable_notes (deliverable_id, kind, file_id, duration_seconds) values ('${DELIVERABLE}', 'voice', '${FILE}', 12)`,
    )
    expect((await notesOf())[0]).toMatchObject({ kind: 'voice' })
    await expect(db.query(`insert into deliverable_notes (deliverable_id, kind) values ('${DELIVERABLE}', 'voice')`)).rejects.toThrow()
  })

  it('refuses an empty written note', async () => {
    await expect(db.query(`insert into deliverable_notes (deliverable_id, kind, body) values ('${DELIVERABLE}', 'text', '   ')`)).rejects.toThrow()
  })

  it('refuses another studio’s recording', async () => {
    await expect(
      db.query(`insert into deliverable_notes (deliverable_id, kind, file_id) values ('${DELIVERABLE}', 'voice', '${OTHER_FILE}')`),
    ).rejects.toThrow(/not in this studio/)
  })

  it('goes with the deliverable when it is deleted', async () => {
    await db.exec(`
      insert into deliverables (id, company_id, project_id, title) values ('d0000000-0000-4000-8000-0000000000d9', '${COMPANY}', '${PROJECT}', 'Temp');
      insert into deliverable_notes (deliverable_id, kind, body) values ('d0000000-0000-4000-8000-0000000000d9', 'text', 'x');
      delete from deliverables where id = 'd0000000-0000-4000-8000-0000000000d9';
    `)
    expect(await q(`select 1 from deliverable_notes where deliverable_id = 'd0000000-0000-4000-8000-0000000000d9'`)).toHaveLength(0)
  })
})

describe('stage history', () => {
  it('writes an event when the stage changes, and not otherwise', async () => {
    await db.exec(`update deliverables set status = 'in_progress' where id = '${DELIVERABLE}'`)
    await db.exec(`update deliverables set title = 'Wedding Film (4K)' where id = '${DELIVERABLE}'`)
    await db.exec(`update deliverables set status = 'review' where id = '${DELIVERABLE}'`)
    const events = (await notesOf()).filter((n) => n.kind === 'event')
    expect(events.map((e) => e.body)).toEqual(['moved:in_progress', 'moved:review'])
    expect(events[0]!.author_id).toBe(OWNER)
  })
})

describe('telling the other side', () => {
  it('tells the editor when someone else writes, with a link straight to it', async () => {
    await db.exec(`insert into deliverable_notes (deliverable_id, kind, file_id, duration_seconds) values ('${DELIVERABLE}', 'voice', '${FILE}', 8)`)
    const [n] = await notificationsFor(EDITOR)
    expect(n).toMatchObject({ type: 'deliverable_note', title: 'Owner sent a voice note on Wedding Film' })
    expect(n!.deep_link).toBe(`/projects/${PROJECT}?tab=deliverables&d=${DELIVERABLE}`)
    expect(await notificationsFor(OWNER)).toHaveLength(0)
  })

  it('tells the project owner when the editor writes', async () => {
    await as(EDITOR)
    await db.exec(`insert into deliverable_notes (deliverable_id, kind, body) values ('${DELIVERABLE}', 'text', 'First cut is up')`)
    expect((await notificationsFor(OWNER))[0]).toMatchObject({ title: 'Rahul left a note on Wedding Film' })
    expect(await notificationsFor(EDITOR)).toHaveLength(0)
  })

  it('does not notify anyone of a stage event', async () => {
    await db.exec(`update deliverables set status = 'in_progress' where id = '${DELIVERABLE}'`)
    expect(await notificationsFor(EDITOR)).toHaveLength(0)
  })
})
