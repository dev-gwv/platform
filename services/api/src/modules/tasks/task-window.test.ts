import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readDoneBefore, readDoneSince, readLimit, selectTasks, type TaskFilter } from './router'

/**
 * The task lists' window (speed audit, 12 Nov): open tasks plus the last 30
 * days' done, older done ones a page at a time, subtasks, a title search and
 * one task by id -- run for real against every migration, as `authenticated`,
 * so RLS decides what each person sees exactly as it does in production.
 *
 * selectTasks builds its query with postgres.js's `sql` tag; a stand-in tag
 * records the pieces and `render` numbers the parameters for PGlite (the same
 * trick as lib/scope.test.ts).
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'supabase', 'migrations')

const OWNER = '11111111-1111-4111-8111-111111111111'
const COMPANY = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'
const OWNER_B = '55555555-5555-4555-8555-555555555555'
const COMPANY_B = '66666666-6666-4666-8666-666666666666'

const T = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`
const OPEN_OLD = T(1) // open, made long ago: always shown
const DONE_RECENT = T(2) // done 3 days ago: inside the window
const DONE_OLD_1 = T(3) // done 40 days ago
const DONE_OLD_2 = T(4) // cancelled 40 days ago, the same instant as DONE_OLD_1
const DONE_OLD_3 = T(5) // done 90 days ago
const MEMBERS_OLD = T(6) // MEMBER's own, done 60 days ago
const CHILD = T(7) // a subtask of OPEN_OLD
const LONG = T(8) // open, with a long description
const OTHER_STUDIO = T(9)
const OTHERS_TASK = T(10) // given to OTHER only

interface Fragment {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}
const isFragment = (v: unknown): v is Fragment => typeof v === 'object' && v !== null && 'strings' in v && 'values' in v
const fakeSql = ((strings: TemplateStringsArray, ...values: unknown[]): Fragment => ({ strings, values })) as unknown as TransactionSql

function render(f: Fragment, params: unknown[] = []): { text: string; params: unknown[] } {
  let text = f.strings[0] ?? ''
  f.values.forEach((v, i) => {
    if (isFragment(v)) text += render(v, params).text
    else {
      params.push(v)
      text += `$${params.length}`
    }
    text += f.strings[i + 1] ?? ''
  })
  return { text, params }
}

let db: PGlite

interface Row {
  id: string
  status: string
  description: string | null
  description_truncated: boolean
  updated_at: string | Date
}

async function tasksFor(uid: string, f: TaskFilter = {}): Promise<Row[]> {
  const q = render(selectTasks(fakeSql, f) as unknown as Fragment)
  await db.exec(`set role authenticated;`)
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
  try {
    return (await db.query<Row>(q.text, q.params)).rows
  } finally {
    await db.exec(`reset role;`)
  }
}
const ids = (rows: Row[]) => rows.map((r) => r.id)

const daysAgo = (n: number) => `now() - interval '${n} days'`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }

  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER}', 'owner@w.test'), ('${MEMBER}', 'member@w.test'), ('${OTHER}', 'other@w.test'), ('${OWNER_B}', 'b@w.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}'), ('${COMPANY_B}', 'Other Studio', '${OWNER_B}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}',   '${COMPANY}',   'super_admin', 'Asha Owner',    'owner@w.test'),
      ('${MEMBER}',  '${COMPANY}',   'employee',    'Ravi Editor',   'member@w.test'),
      ('${OTHER}',   '${COMPANY}',   'employee',    'Meera Shooter', 'other@w.test'),
      ('${OWNER_B}', '${COMPANY_B}', 'super_admin', 'Bina Owner',    'b@w.test');
  `)
  // Inserted as the table owner with the moments set by hand (the
  // updated_at trigger runs on update only).
  const stamp = `date_trunc('second', now())`
  await db.exec(`
    insert into tasks (id, company_id, title, status, priority, description, parent_task_id, created_at, updated_at) values
      ('${OPEN_OLD}',     '${COMPANY}', 'Album layout',        'in_progress', 'medium', null, null, ${daysAgo(200)}, ${daysAgo(200)}),
      ('${DONE_RECENT}',  '${COMPANY}', 'Cull Sharma 50%_off', 'completed',   'medium', null, null, ${daysAgo(10)},  ${daysAgo(3)}),
      ('${DONE_OLD_1}',   '${COMPANY}', 'Grade film',          'completed',   'medium', null, null, ${daysAgo(50)},  ${stamp} - interval '40 days'),
      ('${DONE_OLD_2}',   '${COMPANY}', 'Teaser',              'cancelled',   'medium', null, null, ${daysAgo(50)},  ${stamp} - interval '40 days'),
      ('${DONE_OLD_3}',   '${COMPANY}', 'Backup cards',        'completed',   'medium', null, null, ${daysAgo(100)}, ${daysAgo(90)}),
      ('${MEMBERS_OLD}',  '${COMPANY}', 'Ravi old edit',       'completed',   'medium', null, null, ${daysAgo(70)},  ${daysAgo(60)}),
      ('${CHILD}',        '${COMPANY}', 'Spread 1-10',         'to_do',       'medium', null, '${OPEN_OLD}', ${daysAgo(5)}, ${daysAgo(5)}),
      ('${LONG}',         '${COMPANY}', 'Brief',               'to_do',       'medium', repeat('x', 250), null, ${daysAgo(1)}, ${daysAgo(1)}),
      ('${OTHERS_TASK}',  '${COMPANY}', 'Meera only',          'to_do',       'medium', null, null, ${daysAgo(1)}, ${daysAgo(1)}),
      ('${OTHER_STUDIO}', '${COMPANY_B}', 'Not yours',         'to_do',       'medium', null, null, ${daysAgo(1)}, ${daysAgo(1)});
    insert into task_assignees (task_id, user_id, company_id) values
      ('${OPEN_OLD}', '${MEMBER}', '${COMPANY}'),
      ('${DONE_RECENT}', '${MEMBER}', '${COMPANY}'),
      ('${MEMBERS_OLD}', '${MEMBER}', '${COMPANY}'),
      ('${OTHERS_TASK}', '${OTHER}', '${COMPANY}');
  `)
}, 120_000)

afterAll(async () => {
  await db.close()
})

const since = () => readDoneSince(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)) as string

describe('the window: open tasks and the last 30 days of done ones', () => {
  it('without a window every task comes back, as before', async () => {
    const all = ids(await tasksFor(OWNER))
    expect(all).toHaveLength(9)
    expect(all).not.toContain(OTHER_STUDIO)
  })

  it('keeps every open task however old, and only recent finished ones', async () => {
    const rows = ids(await tasksFor(OWNER, { since: since() }))
    expect(rows).toEqual(expect.arrayContaining([OPEN_OLD, DONE_RECENT, CHILD, LONG, OTHERS_TASK]))
    expect(rows).not.toContain(DONE_OLD_1)
    expect(rows).not.toContain(DONE_OLD_2)
    expect(rows).not.toContain(DONE_OLD_3)
    expect(rows).not.toContain(MEMBERS_OLD)
  })

  it('cuts a long description to 200 characters and says so', async () => {
    const row = (await tasksFor(OWNER, { since: since() })).find((r) => r.id === LONG)!
    expect(row.description).toHaveLength(200)
    expect(row.description_truncated).toBe(true)
    const short = (await tasksFor(OWNER, { since: since() })).find((r) => r.id === OPEN_OLD)!
    expect(short.description_truncated).toBe(false)
  })

  it('open=1 is open tasks only', async () => {
    const rows = await tasksFor(MEMBER, { assignee: MEMBER, openOnly: true })
    expect(ids(rows)).toEqual([OPEN_OLD])
  })
})

describe('done_before: older finished tasks, newest first, a page at a time', () => {
  it('pages through the finished ones before the window without skipping a tie', async () => {
    const first = await tasksFor(OWNER, { before: { ts: since(), id: null }, limit: 2 })
    expect(first.map((r) => r.status).every((s) => s === 'completed' || s === 'cancelled')).toBe(true)
    // DONE_OLD_1 and DONE_OLD_2 share one instant; id breaks the tie (desc).
    expect(ids(first)).toEqual([DONE_OLD_2, DONE_OLD_1])
    const last = first[first.length - 1]!
    // PGlite hands back a Date; the API's driver an ISO string (lib/db.ts).
    const cursor = readDoneBefore(`${new Date(last.updated_at).toISOString()}|${last.id}`)
    expect(cursor).not.toBe('bad')
    const second = await tasksFor(OWNER, { before: cursor as { ts: string; id: string }, limit: 5 })
    expect(ids(second)).toEqual([MEMBERS_OLD, DONE_OLD_3])
  })

  it('a moment alone (no id) as the cursor works too', async () => {
    const rows = await tasksFor(OWNER, { before: { ts: new Date(Date.now() - 80 * 86_400_000).toISOString(), id: null } })
    expect(ids(rows)).toEqual([DONE_OLD_3])
  })

  it('a staff member pages only their own', async () => {
    const rows = await tasksFor(MEMBER, { assignee: MEMBER, before: { ts: since(), id: null } })
    expect(ids(rows)).toEqual([MEMBERS_OLD])
  })
})

describe('subtasks, the picker search and one task by id', () => {
  it('parent_id lists one task’s subtasks', async () => {
    expect(ids(await tasksFor(OWNER, { parent: OPEN_OLD }))).toEqual([CHILD])
  })

  it('q searches titles, % and _ meaning themselves, at most the limit asked', async () => {
    expect(ids(await tasksFor(OWNER, { q: 'album' }))).toEqual([OPEN_OLD])
    expect(ids(await tasksFor(OWNER, { q: '50%_' }))).toEqual([DONE_RECENT])
    expect(ids(await tasksFor(OWNER, { q: '%' }))).toEqual([DONE_RECENT])
    expect(await tasksFor(OWNER, { q: 'Sharma 5_%' })).toHaveLength(0)
    expect(await tasksFor(OWNER, { q: 'e', limit: 2 })).toHaveLength(2)
  })

  it('by id: the whole description, never another studio’s task', async () => {
    const [row] = await tasksFor(OWNER, { id: LONG })
    expect(row?.description).toHaveLength(250)
    expect(row?.description_truncated).toBe(false)
    expect(await tasksFor(OWNER, { id: OTHER_STUDIO })).toHaveLength(0)
    expect(await tasksFor(OWNER_B, { id: LONG })).toHaveLength(0)
  })

  it('by id: staff see a task they are on, not one given only to someone else', async () => {
    expect(ids(await tasksFor(MEMBER, { id: OPEN_OLD }))).toEqual([OPEN_OLD])
    expect(await tasksFor(MEMBER, { id: OTHERS_TASK })).toHaveLength(0)
  })
})

describe('reading the query string', () => {
  it('done_since is a day, read as the start of that India day', () => {
    expect(readDoneSince('2026-10-13')).toBe('2026-10-13T00:00:00+05:30')
    expect(readDoneSince(undefined)).toBeNull()
    expect(readDoneSince('13/10/2026')).toBe('bad')
  })

  it('done_before is a day, a moment, or a moment and an id', () => {
    expect(readDoneBefore('2026-10-13')).toEqual({ ts: '2026-10-13T00:00:00+05:30', id: null })
    expect(readDoneBefore(`2026-10-01T10:00:00.123456+00:00|${T(3)}`)).toEqual({ ts: '2026-10-01T10:00:00.123456+00:00', id: T(3) })
    expect(readDoneBefore('nonsense')).toBe('bad')
    expect(readDoneBefore('2026-10-01T10:00:00Z|not-a-uuid')).toBe('bad')
    expect(readDoneBefore('a|b|c')).toBe('bad')
  })

  it('limit stays within its bounds', () => {
    expect(readLimit(undefined, 50, 100)).toBe(50)
    expect(readLimit('500', 50, 100)).toBe(100)
    expect(readLimit('0', 20, 20)).toBe(1)
    expect(readLimit('abc', 20, 20)).toBe(20)
  })
})
