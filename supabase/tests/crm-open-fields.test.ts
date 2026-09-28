import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0209: stage colours, open quality and source, follow-ups as tasks.
 *
 * Seeds leads and stages before 0209 runs, so the backfills have something to
 * find, then checks the three promises: nothing on the board changes colour on
 * deploy, a studio can use its own words for quality and source, and a
 * follow-up is one task whichever way it was set.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a9000000-0000-4000-8000-000000000001'
const COMPANY = 'a9000000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

/** BoardTabs' stageHue before 0209, verbatim, for the parity check. */
const OPEN_HUES = ['blue', 'violet', 'teal', 'amber', 'green', 'rose']
function boardHue(name: string, kind: string): string {
  if (kind === 'won') return 'green'
  if (kind === 'lost') return 'rose'
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return OPEN_HUES[h % OPEN_HUES.length]!
}

const lead = async (name: string, extra: Record<string, string> = {}) => {
  const cols: Record<string, string> = {
    company_id: `'${COMPANY}'`,
    name: `'${name}'`,
    phone: `'98${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}'`,
    source: `'manual'`,
    ...extra,
  }
  return (
    await one<{ id: string }>(
      `insert into crm_leads (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')}) returning id`,
    )
  ).id
}

const tasks = (leadId: string) =>
  q<{ due_at: string | null; done_at: string | null; meta: { auto?: boolean } }>(
    `select due_at, done_at, meta from crm_activities where lead_id = '${leadId}' and type = 'task' order by created_at`,
  )
const followUp = async (leadId: string) =>
  (await one<{ f: string | null }>(`select follow_up_at::text as f from crm_leads where id = '${leadId}'`)).f

let OLD_NOTE: string
let OLD_FOLLOW: string

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)

  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  const cut = files.findIndex((f) => f.startsWith('0209_'))
  expect(cut).toBeGreaterThan(0)
  for (const f of files.slice(0, cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
  `)
  // A custom stage in the default pipeline, and two leads carrying the old
  // shapes: a notes box, and a follow-up date with no task behind it.
  await db.exec(`
    insert into crm_pipeline_stages (pipeline_id, company_id, name, key, position, kind)
    select id, company_id, 'Site visit booked', 'site_visit', 9, 'open' from crm_pipelines where company_id = '${COMPANY}';
  `)
  OLD_NOTE = await lead('Old note', { notes: `'Wants candid only. Call after 6.'` })
  OLD_FOLLOW = await lead('Old follow', { follow_up_at: `now() + interval '2 days'` })
  // 0209 adds its own insert trigger, so a lead made before it has no task:
  // prove the backfill, not the trigger, makes it.
  await db.exec(`delete from crm_activities where lead_id = '${OLD_FOLLOW}'`)

  for (const f of files.slice(cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('stage colours', () => {
  it('backfill every stage with the colour the board already showed', async () => {
    const rows = await q<{ name: string; kind: string; color: string }>(
      `select name, kind, color from crm_pipeline_stages where company_id = '${COMPANY}'`,
    )
    expect(rows.length).toBeGreaterThanOrEqual(7)
    for (const r of rows) expect(r.color, r.name).toBe(boardHue(r.name, r.kind))
  })

  it('give a stage added without a colour the same hash, and keep a chosen one', async () => {
    await db.exec(`
      insert into crm_pipeline_stages (pipeline_id, company_id, name, key, position, kind)
      select id, company_id, 'Album chosen', 'album_chosen', 10, 'open' from crm_pipelines where company_id = '${COMPANY}';
      insert into crm_pipeline_stages (pipeline_id, company_id, name, key, position, kind, color)
      select id, company_id, 'Tea tasting', 'tea', 11, 'open', 'teal' from crm_pipelines where company_id = '${COMPANY}';`)
    const rows = await q<{ key: string; color: string }>(
      `select key, color from crm_pipeline_stages where key in ('album_chosen', 'tea') order by key`,
    )
    expect(rows).toEqual([
      { key: 'album_chosen', color: boardHue('Album chosen', 'open') },
      { key: 'tea', color: 'teal' },
    ])
  })

  it('refuse a colour outside the palette', async () => {
    await expect(
      db.exec(`update crm_pipeline_stages set color = 'gold' where key = 'tea'`),
    ).rejects.toThrow(/check/)
  })
})

describe('the studio’s own words', () => {
  it('seed the CRM lists, coloured, for existing and new studios', async () => {
    const rows = await q<{ category: string; n: number }>(
      `select category, count(*)::int as n from custom_lookups
        where company_id = '${COMPANY}' and category in ('lead_quality', 'lead_source', 'follow_up_type', 'follow_up_priority')
          and color is not null group by category order by category`,
    )
    expect(rows).toEqual([
      { category: 'follow_up_priority', n: 4 },
      { category: 'follow_up_type', n: 5 },
      { category: 'lead_quality', n: 3 },
      { category: 'lead_source', n: 10 },
    ])
    const NEW = 'a9000000-0000-4000-8000-0000000000bb'
    await db.exec(`insert into companies (id, name, owner_user_id) values ('${NEW}', 'New', '${OWNER}')`)
    expect((await one<{ n: number }>(`select count(*)::int as n from custom_lookups where company_id = '${NEW}' and category = 'lead_quality'`)).n).toBe(3)
  })

  it('accept any quality and source; only "hot" makes a lead hot', async () => {
    const id = await lead('Custom', { quality: `'Super hot'`, source: `'Wedding fair'` })
    expect(await one(`select quality, source, is_hot from crm_leads where id = '${id}'`)).toEqual({
      quality: 'Super hot',
      source: 'Wedding fair',
      is_hot: false,
    })
    await db.exec(`update crm_leads set quality = 'hot' where id = '${id}'`)
    expect((await one<{ is_hot: boolean }>(`select is_hot from crm_leads where id = '${id}'`)).is_hot).toBe(true)
  })

  it('let the bulk edit set a quality of the studio’s own', async () => {
    const id = await lead('Bulk')
    await db.exec(`set role authenticated`)
    try {
      await q(`select * from crm_bulk_patch(array['${id}']::uuid[], '{"quality": "Very keen"}'::jsonb)`)
    } finally {
      await db.exec(`reset role`)
    }
    expect((await one<{ quality: string }>(`select quality from crm_leads where id = '${id}'`)).quality).toBe('Very keen')
  })
})

describe('follow-ups as tasks', () => {
  it('backfill a task for a follow-up set before 0209', async () => {
    const t = await tasks(OLD_FOLLOW)
    expect(t).toHaveLength(1)
    expect(t[0]!.meta.auto).toBe(true)
  })

  it('keep follow_up_at on the earliest open task, and clear it when the last is done', async () => {
    const id = await lead('Tasks')
    const [{ a }] = [await one<{ a: string }>(`insert into crm_activities (company_id, lead_id, type, subject, due_at)
      values ('${COMPANY}', '${id}', 'task', 'Call', now() + interval '3 days') returning id as a`)]
    const b = (await one<{ b: string }>(`insert into crm_activities (company_id, lead_id, type, subject, due_at)
      values ('${COMPANY}', '${id}', 'task', 'Visit', now() + interval '1 day') returning id as b`)).b
    const due = async (x: string) => (await one<{ d: string }>(`select due_at::text as d from crm_activities where id = '${x}'`)).d
    expect(await followUp(id)).toBe(await due(b))
    await db.exec(`update crm_activities set done_at = now() where id = '${b}'`)
    expect(await followUp(id)).toBe(await due(a))
    await db.exec(`update crm_activities set done_at = now() where id = '${a}'`)
    expect(await followUp(id)).toBeNull()
    // Marking tasks done must not have made new ones.
    expect(await tasks(id)).toHaveLength(2)
  })

  it('make one task when a legacy path sets follow_up_at, move it when it changes, drop it when cleared', async () => {
    const id = await lead('Legacy')
    await db.exec(`update crm_leads set follow_up_at = now() + interval '1 hour' where id = '${id}'`)
    expect(await tasks(id)).toHaveLength(1)
    await db.exec(`update crm_leads set follow_up_at = now() + interval '1 day' where id = '${id}'`)
    const t = await tasks(id)
    expect(t).toHaveLength(1)
    expect(await followUp(id)).not.toBeNull()
    await db.exec(`update crm_leads set follow_up_at = null where id = '${id}'`)
    expect(await tasks(id)).toHaveLength(0)
  })

  it('leave a hand-written task alone when the lead’s follow-up is cleared', async () => {
    const id = await lead('Hand')
    await db.exec(`insert into crm_activities (company_id, lead_id, type, subject, due_at)
      values ('${COMPANY}', '${id}', 'task', 'Send album', now() + interval '5 days')`)
    await db.exec(`update crm_leads set follow_up_at = null where id = '${id}'`)
    expect(await tasks(id)).toHaveLength(1)
  })

  it('give a new lead that arrives with a follow-up its task', async () => {
    const id = await lead('Imported', { follow_up_at: `now() + interval '4 hours'` })
    expect(await tasks(id)).toHaveLength(1)
  })

  it('alert a legacy follow-up once, as a follow-up and not as its auto task', async () => {
    const id = await lead('Due', { assigned_to: `'${OWNER}'` })
    await db.exec(`update crm_leads set follow_up_at = now() - interval '1 hour' where id = '${id}'`)
    const r = await one<{ r: { due: number } }>(`select crm_task_reminders(true) as r`)
    const dueTasks = await one<{ n: number }>(`select count(*)::int as n from crm_activities a join crm_leads l on l.id = a.lead_id
      where a.type = 'task' and a.done_at is null and a.due_at <= now() and coalesce(a.meta->>'auto', '') <> 'true'`)
    expect(r.r.due).toBe(dueTasks.n)
  })
})

describe('the notes box', () => {
  it('becomes the first, pinned note in the thread', async () => {
    const rows = await q<{ type: string; body: string; meta: { pinned?: boolean } }>(
      `select type, body, meta from crm_activities where lead_id = '${OLD_NOTE}' and type = 'note'`,
    )
    expect(rows).toEqual([{ type: 'note', body: 'Wants candid only. Call after 6.', meta: { pinned: true, migrated: true } }])
  })
})
