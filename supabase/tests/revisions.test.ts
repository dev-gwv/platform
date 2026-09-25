import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Revisions (0180): work sent back for changes -- by a reviewer, or moved to
 * "Changes requested" by hand -- reaches the editor once, with what to change;
 * it shows as sent back on their list; and what they hand in next is the next
 * version and goes back to review like the first one did.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e0000000-0000-4000-8000-000000000001'
const PRIYA = 'e0000000-0000-4000-8000-000000000002'
const SANA = 'e0000000-0000-4000-8000-000000000003'
const COMPANY = 'e0000000-0000-4000-8000-0000000000aa'
const CLIENT = 'e0000000-0000-4000-8000-0000000000c1'
const PROJECT = 'e0000000-0000-4000-8000-0000000000b1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = (user: string) => db.exec(`set request.jwt.claim.sub = '${user}';`)

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test'), ('${SANA}', 's@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test'),
      ('${SANA}', '${COMPANY}', 'manager', 'Sana', 's@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding', 200000, '${OWNER}');
  `)
  await as(OWNER)
})

/** A deliverable given to Priya, which starts it: Editing. */
const deliverable = async (title: string) =>
  (
    await q<{ id: string }>(
      `insert into deliverables (company_id, project_id, title, assignee_id)
       values ('${COMPANY}', '${PROJECT}', '${title}', '${PRIYA}') returning id`,
    )
  )[0]!.id

/** Work handed in for it -- by Priya unless someone else says so. */
const handIn = async (did: string, link: string, by = PRIYA) => {
  await as(by)
  const [row] = await q<{ id: string; version: number }>(
    `insert into team_work_submissions (company_id, deliverable_id, submitted_by, submission_link)
     values ('${COMPANY}', '${did}', '${by}', '${link}') returning id, version`,
  )
  await as(OWNER)
  return row!
}

const sendBack = (sid: string, note: string | null) =>
  db.exec(`select review_work('${sid}', false, ${note === null ? 'null' : `'${note}'`})`)

const moveTo = (did: string, status: string, code: string | null) =>
  db.exec(`update deliverables set status = '${status}', custom_status_code = ${code ? `'${code}'` : 'null'} where id = '${did}'`)

const where = async (did: string) =>
  (await q<{ status: string; custom_status_code: string | null; delivery_link: string | null }>(
    `select status, custom_status_code, delivery_link from deliverables where id = '${did}'`,
  ))[0]!

/** What the editor's own list says about it. */
const state = async (did: string) =>
  (await q<{ changes_requested: boolean; review_note: string | null; last_version: number | null }>(
    `select changes_requested, review_note, last_version from deliverable_revision_state('${did}')`,
  ))[0]!

/** The "Changes requested" alerts someone has had about it. */
const told = (did: string, who = PRIYA) =>
  q<{ title: string; body: string; deep_link: string }>(
    `select title, body, deep_link from notifications
      where recipient_uid = '${who}' and entity_id = '${did}' and type = 'deliverable_changes_requested'
      order by created_at, body`,
  )

describe('sent back by a reviewer', () => {
  it('goes to Changes requested and tells the editor once, with what to change', async () => {
    const did = await deliverable('Wedding Film')
    const v1 = await handIn(did, 'https://drive.test/film-v1')
    expect(v1.version).toBe(1)

    await sendBack(v1.id, 'Shorter intro, please')
    expect(await where(did)).toMatchObject({ status: 'in_progress', custom_status_code: 'changes_requested' })
    expect(await told(did)).toEqual([
      { title: 'Changes requested: Wedding Film', body: 'Sharma Wedding · Shorter intro, please', deep_link: '/my-work' },
    ])
    // The words stay in the timeline -- without a second "left a note" alert.
    expect(await q(`select body from deliverable_notes where deliverable_id = '${did}' and kind = 'text'`)).toEqual([
      { body: 'Shorter intro, please' },
    ])
    const kinds = await q<{ type: string }>(
      `select type from notifications where recipient_uid = '${PRIYA}' and entity_id = '${did}' order by type`,
    )
    expect(kinds.map((k) => k.type)).toEqual(['deliverable_assigned', 'deliverable_changes_requested'])
    expect(await state(did)).toEqual({ changes_requested: true, review_note: 'Shorter intro, please', last_version: 1 })

    // The same version reopened and sent back again: still one alert.
    await db.exec(`update team_work_submissions set status = 'submitted' where id = '${v1.id}'`)
    await sendBack(v1.id, 'Shorter intro, please')
    expect(await told(did)).toHaveLength(1)
  })

  it('with no note, still tells her -- and where to look', async () => {
    const did = await deliverable('Invitation video')
    const v1 = await handIn(did, 'https://drive.test/invite-v1')
    await sendBack(v1.id, null)
    expect(await told(did)).toEqual([
      { title: 'Changes requested: Invitation video', body: 'Sharma Wedding · Open My Work to see what to change.', deep_link: '/my-work' },
    ])
    expect(await state(did)).toEqual({ changes_requested: true, review_note: null, last_version: 1 })
  })

  it('tells whoever made that version too, but never the one who sent it back', async () => {
    const did = await deliverable('Pre-wedding film')
    const v1 = await handIn(did, 'https://drive.test/prewed-v1', OWNER)
    await as(SANA)
    await sendBack(v1.id, 'Add the drone shots')
    await as(OWNER)
    expect(await told(did, PRIYA)).toHaveLength(1)
    expect(await told(did, OWNER)).toHaveLength(1)
    expect(await told(did, SANA)).toHaveLength(0)
  })
})

describe('the revision', () => {
  it('is the next version, and goes back to review like the first', async () => {
    const did = await deliverable('Album design')
    const v1 = await handIn(did, 'https://drive.test/album-v1')
    await sendBack(v1.id, 'Swap the cover photo')

    const v2 = await handIn(did, 'https://drive.test/album-v2')
    expect(v2.version).toBe(2)
    expect(await where(did)).toEqual({ status: 'review', custom_status_code: 'with_manager', delivery_link: 'https://drive.test/album-v2' })
    expect(await state(did)).toEqual({ changes_requested: false, review_note: null, last_version: 2 })
    const events = await q<{ body: string }>(
      `select body from deliverable_notes where deliverable_id = '${did}' and kind = 'event' order by created_at`,
    )
    expect(events.map((e) => e.body)).toEqual([`submitted:${v1.id}`, `sent_back:${v1.id}`, `submitted:${v2.id}`])

    // A second round is a new version, so she hears about that one too.
    await sendBack(v2.id, 'Now fix the spine text')
    expect((await told(did)).map((n) => n.body).sort()).toEqual([
      'Sharma Wedding · Now fix the spine text',
      'Sharma Wedding · Swap the cover photo',
    ])
    expect(await state(did)).toEqual({ changes_requested: true, review_note: 'Now fix the spine text', last_version: 2 })
  })

  it('counts on from the highest version already there', async () => {
    const did = await deliverable('Reel')
    const v1 = await handIn(did, 'https://drive.test/reel-1')
    await db.exec(`update team_work_submissions set version = 3 where id = '${v1.id}'`)
    expect((await handIn(did, 'https://drive.test/reel-4')).version).toBe(4)

    // Work that is not for a deliverable is left as it was.
    await as(PRIYA)
    const [loose] = await q<{ version: number }>(
      `insert into team_work_submissions (company_id, project_id, submitted_by, submission_link)
       values ('${COMPANY}', '${PROJECT}', '${PRIYA}', 'https://drive.test/loose') returning version`,
    )
    await as(OWNER)
    expect(loose!.version).toBe(1)
  })
})

describe('moved to Changes requested by hand', () => {
  it('ends the same way, and a review of that version afterwards does not say it twice', async () => {
    const did = await deliverable('Teaser')
    const v1 = await handIn(did, 'https://drive.test/teaser-v1')

    await moveTo(did, 'in_progress', 'changes_requested')
    await db.exec(`insert into deliverable_notes (deliverable_id, kind, body) values ('${did}', 'text', 'Music is too loud')`)
    expect(await told(did)).toEqual([
      { title: 'Changes requested: Teaser', body: 'Sharma Wedding · Open My Work to see what to change.', deep_link: '/my-work' },
    ])
    expect(await state(did)).toEqual({ changes_requested: true, review_note: 'Music is too loud', last_version: 1 })

    await sendBack(v1.id, 'Music is too loud')
    expect(await told(did)).toHaveLength(1)
  })

  it('with nothing handed in: once for each time it is sent back, and never for her own moves', async () => {
    const did = await deliverable('Photo selection')
    await moveTo(did, 'review', null)
    await db.exec(`insert into deliverable_notes (deliverable_id, kind, body) values ('${did}', 'text', 'Too many near-duplicates')`)
    await moveTo(did, 'in_progress', 'changes_requested')
    expect((await told(did)).map((n) => n.body)).toEqual(['Sharma Wedding · Too many near-duplicates'])

    await as(PRIYA)
    await moveTo(did, 'review', 'with_manager')
    await moveTo(did, 'in_progress', 'changes_requested')
    await as(OWNER)
    expect(await told(did)).toHaveLength(1)
    // It went for review since, so that note was about the earlier round.
    expect(await state(did)).toEqual({ changes_requested: true, review_note: null, last_version: null })

    await moveTo(did, 'review', 'with_manager')
    await moveTo(did, 'in_progress', 'changes_requested')
    expect(await told(did)).toHaveLength(2)
  })
})

describe('a studio that removed the "Changes requested" stage', () => {
  it('still shows the work as sent back', async () => {
    await db.exec(`delete from company_deliverable_statuses where company_id = '${COMPANY}' and code = 'changes_requested'`)
    try {
      const did = await deliverable('Cinematic Film')
      const v1 = await handIn(did, 'https://drive.test/cine-v1')
      await sendBack(v1.id, 'Colour the night shots')
      expect(await where(did)).toMatchObject({ status: 'in_progress', custom_status_code: null })
      expect(await state(did)).toEqual({ changes_requested: true, review_note: 'Colour the night shots', last_version: 1 })
      expect(await told(did)).toHaveLength(1)
    } finally {
      await db.exec(`select seed_deliverable_stages('${COMPANY}')`)
    }
  })
})
