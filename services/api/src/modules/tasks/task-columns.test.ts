import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { selectTasks, type RawTask, type TaskFilter } from './task-query'
import {
  assembleColumns,
  assemblePage,
  decodeBoardCursor,
  encodeBoardCursor,
  placeRestAfter,
  selectColumnKeys,
  selectColumnPageKeys,
  type BoardKey,
  type BoardStatus,
} from './task-columns'
import { defaultSince, readBoardQuery } from './routes-columns'

/**
 * The Tasks board a page at a time (speed audit, 21 Nov): each column's first
 * cards with its own total, Show more within one status -- run for real
 * against every migration as `authenticated`, so RLS decides what each person
 * sees (as task-window.test.ts and crm/lead-pages.test.ts).
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'supabase', 'migrations')

const OWNER = 'c1000000-0000-4000-8000-000000000001'
const MEMBER = 'c1000000-0000-4000-8000-000000000002'
const OWNER_B = 'c1000000-0000-4000-8000-000000000003'
const STUDIO = 'c1000000-0000-4000-8000-0000000000aa'
const STUDIO_B = 'c1000000-0000-4000-8000-0000000000bb'
const T = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`

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

async function run<T>(uid: string, frag: unknown): Promise<T[]> {
  const q = render(frag as Fragment)
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`)
  try {
    return (await db.query<T>(q.text, q.params)).rows
  } finally {
    await db.exec(`reset role;`)
  }
}

const SINCE = defaultSince()

/** The board as GET /tasks/columns builds it, `per` cards a column. */
async function board(uid: string, f: TaskFilter, per: number) {
  const keys = await run<BoardKey>(uid, selectColumnKeys(fakeSql, f, SINCE, per))
  const shown = keys.filter((k) => Number(k.k_n) <= per).map((k) => k.id)
  const rows = shown.length ? await run<RawTask>(uid, selectTasks(fakeSql, { ids: shown, since: SINCE })) : []
  return assembleColumns(keys, rows, per)
}

/** One column whole, by following Show more from the first page. */
async function wholeColumn(uid: string, f: TaskFilter, status: BoardStatus, per: number) {
  const first = (await board(uid, f, per)).find((c) => c.status === status)!
  const out = first.items.map((r) => r.id)
  let cursor = first.next_cursor
  for (let i = 0; cursor && i < 50; i++) {
    const after = decodeBoardCursor(cursor)
    if (after === 'bad') throw new Error('bad cursor')
    const keys = await run<BoardKey>(uid, selectColumnPageKeys(fakeSql, f, SINCE, status, after, per))
    const ids = keys.slice(0, per).map((k) => k.id)
    const rows = ids.length ? await run<RawTask>(uid, selectTasks(fakeSql, { ids, since: SINCE })) : []
    const page = assemblePage(keys, rows, per)
    out.push(...page.items.map((r) => r.id))
    cursor = page.next_cursor
  }
  return { total: first.total, ids: out }
}

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
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@c.test'), ('${MEMBER}', 'm@c.test'), ('${OWNER_B}', 'b@c.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${STUDIO}', 'Studio', '${OWNER}'), ('${STUDIO_B}', 'Other', '${OWNER_B}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}',   '${STUDIO}',   'super_admin', 'Asha Owner',  'o@c.test'),
      ('${MEMBER}',  '${STUDIO}',   'employee',    'Ravi Editor', 'm@c.test'),
      ('${OWNER_B}', '${STUDIO_B}', 'super_admin', 'Bina Owner',  'b@c.test');
  `)
  // 25 to do (T1..T25, T1 the oldest; every fifth one Ravi's), 3 in progress,
  // 2 done this week, 1 done long ago, 1 cancelled, and one in another studio.
  // T1..T3 and T5 share one instant, so the id has to break the tie.
  const values: string[] = []
  for (let n = 1; n <= 25; n++) {
    const made = n <= 3 || n === 5 ? `'2026-10-01T10:00:00Z'` : `now() - interval '${100 - n} hours'`
    values.push(`('${T(n)}', '${STUDIO}', 'Edit ${n}', 'to_do', ${made}, now())`)
  }
  for (let n = 26; n <= 28; n++) values.push(`('${T(n)}', '${STUDIO}', 'Grade ${n}', 'in_progress', now() - interval '${n} hours', now())`)
  values.push(`('${T(29)}', '${STUDIO}', 'Done 29', 'completed', now() - interval '5 days', now() - interval '2 days')`)
  values.push(`('${T(30)}', '${STUDIO}', 'Done 30', 'completed', now() - interval '5 days', now() - interval '1 day')`)
  values.push(`('${T(31)}', '${STUDIO}', 'Done long ago', 'completed', now() - interval '90 days', now() - interval '80 days')`)
  values.push(`('${T(32)}', '${STUDIO}', 'Called off', 'cancelled', now() - interval '3 days', now() - interval '1 day')`)
  values.push(`('${T(33)}', '${STUDIO_B}', 'Not yours', 'to_do', now(), now())`)
  await db.exec(`insert into tasks (id, company_id, title, status, created_at, updated_at) values ${values.join(',\n')};`)
  await db.exec(`insert into task_assignees (task_id, user_id, company_id) values
    ${[5, 10, 15, 20, 25].map((n) => `('${T(n)}', '${MEMBER}', '${STUDIO}')`).join(', ')};`)
  // The owner dragged T7 to the top of To do, and T26 below the other two.
  await db.exec(`insert into production_board_card_order (company_id, board_view, lane_key, task_id, sort_order) values
    ('${STUDIO}', 'default', 'to_do', '${T(7)}', -1),
    ('${STUDIO}', 'default', 'in_progress', '${T(26)}', 5);`)
}, 120_000)

afterAll(async () => {
  await db.close()
})

const ownerFilter = readBoardQuery(() => undefined, OWNER, true).filter

describe('GET /tasks/columns: each column a page at a time', () => {
  it('sends every column, each with its own total and only its first cards', async () => {
    const cols = await board(OWNER, ownerFilter, 10)
    expect(cols.map((c) => c.status)).toEqual(['to_do', 'in_progress', 'review', 'blocked', 'completed'])
    const byStatus = Object.fromEntries(cols.map((c) => [c.status, c]))
    expect(byStatus.to_do!.total).toBe(25)
    expect(byStatus.to_do!.items).toHaveLength(10)
    expect(byStatus.to_do!.next_cursor).not.toBeNull()
    expect(byStatus.in_progress!.total).toBe(3)
    expect(byStatus.in_progress!.next_cursor).toBeNull()
    expect(byStatus.review!).toMatchObject({ total: 0, items: [], next_cursor: null })
  })

  it('keeps the hand order, then newest first', async () => {
    const cols = await board(OWNER, ownerFilter, 10)
    const todo = cols.find((c) => c.status === 'to_do')!.items.map((r) => r.id)
    expect(todo.slice(0, 3)).toEqual([T(7), T(25), T(24)])
    const doing = cols.find((c) => c.status === 'in_progress')!.items.map((r) => r.id)
    expect(doing).toEqual([T(27), T(28), T(26)])
    expect(cols.find((c) => c.status === 'in_progress')!.items.at(-1)!.sort_order).toBe(5)
  })

  it('Done holds the window only; cancelled work and other studios stay off', async () => {
    const cols = await board(OWNER, ownerFilter, 10)
    const done = cols.find((c) => c.status === 'completed')!
    expect(done.items.map((r) => r.id)).toEqual([T(30), T(29)])
    expect(done.total).toBe(2)
    const all = cols.flatMap((c) => c.items.map((r) => r.id))
    expect(all).not.toContain(T(31))
    expect(all).not.toContain(T(32))
    expect(all).not.toContain(T(33))
  })

  it('Show more walks a whole column without a gap or a repeat, ties included', async () => {
    const col = await wholeColumn(OWNER, ownerFilter, 'to_do', 4)
    expect(col.total).toBe(25)
    expect(col.ids).toHaveLength(25)
    expect(new Set(col.ids).size).toBe(25)
    expect(col.ids[0]).toBe(T(7))
    // The four made in the same instant come last, highest id first.
    expect(col.ids.slice(-4)).toEqual([T(5), T(3), T(2), T(1)])
  })

  it('applies the toolbar: a person, and the search', async () => {
    const ravi = { ...ownerFilter, member: MEMBER }
    const cols = await board(OWNER, ravi, 30)
    expect(cols.find((c) => c.status === 'to_do')!.total).toBe(5)
    const search = await board(OWNER, { ...ownerFilter, search: 'Grade' }, 30)
    expect(search.map((c) => c.total)).toEqual([0, 3, 0, 0, 0])
  })

  it('someone who cannot view the studio gets their own, whatever they ask', async () => {
    const f = readBoardQuery((k) => (k === 'member' ? OWNER : undefined), MEMBER, false).filter
    expect(f.assignee).toBe(MEMBER)
    const cols = await board(MEMBER, f, 30)
    expect(cols.find((c) => c.status === 'to_do')!.items.map((r) => r.id).sort()).toEqual([5, 10, 15, 20, 25].map(T).sort())
    expect(cols.find((c) => c.status === 'in_progress')!.total).toBe(0)
  })

  it('another studio sees none of it', async () => {
    const cols = await board(OWNER_B, readBoardQuery(() => undefined, OWNER_B, true).filter, 30)
    expect(cols.flatMap((c) => c.items.map((r) => r.id))).toEqual([T(33)])
  })
})

describe('the board cursor', () => {
  it('round-trips, and refuses anything we did not make', () => {
    const c = encodeBoardCursor({ k_so: -1, k_at: '2026-11-21 10:00:00.123456+00', id: T(1) })
    expect(decodeBoardCursor(c)).toEqual({ so: -1, at: '2026-11-21 10:00:00.123456+00', id: T(1) })
    expect(decodeBoardCursor(undefined)).toBeNull()
    expect(decodeBoardCursor('nope')).toBe('bad')
    expect(decodeBoardCursor(Buffer.from(JSON.stringify(['b', 1.5, '2026-11-21 10:00:00+00', T(1)])).toString('base64url'))).toBe('bad')
    expect(decodeBoardCursor(Buffer.from(JSON.stringify(['u', 1, '2026-11-21 10:00:00+00', T(1)])).toString('base64url'))).toBe('bad')
  })

  it('Done reaches back 30 India days by default', () => {
    expect(defaultSince(new Date('2026-11-21T20:00:00Z'))).toBe('2026-10-23T00:00:00+05:30')
  })
})

// Last: it rewrites the To do lane's order.
describe('POST /tasks/board/order with rest_after', () => {
  it("a drag saves the lane's first cards, and every other card keeps its order after them", async () => {
    const before = (await wholeColumn(OWNER, ownerFilter, 'to_do', 30)).ids
    const dragged = [T(25), T(7), T(24)]
    await run(OWNER, fakeSql`select set_board_lane_order(${'default'}, ${'to_do'}, ${dragged}::uuid[])`)
    await run(OWNER, placeRestAfter(fakeSql, STUDIO, 'default', 'to_do', dragged))
    const after = (await wholeColumn(OWNER, ownerFilter, 'to_do', 4)).ids
    expect(after.slice(0, 3)).toEqual(dragged)
    expect(after.slice(3)).toEqual(before.filter((x) => !dragged.includes(x)))
    // Other lanes are untouched.
    const doing = (await board(OWNER, ownerFilter, 10)).find((c) => c.status === 'in_progress')!.items.map((r) => r.id)
    expect(doing).toEqual([T(27), T(28), T(26)])
  })
})
