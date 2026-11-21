import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { leadPageQuery } from '@ipc/contracts'
import { countLeads, cursorAfter, decodeCursor, encodeCursor, indiaDayStart, selectColumns, selectCounts, selectLeadPage } from './lead-pages'

/**
 * The Leads page a page at a time (speed audit, 21 Nov), run for real against
 * every migration as `authenticated`, so RLS decides what each person sees.
 * The query builders use postgres.js's `sql` tag; a stand-in records the
 * pieces and `render` numbers the parameters for PGlite (as task-window.test.ts).
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'supabase', 'migrations')

const OWNER = 'd1000000-0000-4000-8000-000000000001'
const STAFF = 'd1000000-0000-4000-8000-000000000002'
const OWNER_B = 'd1000000-0000-4000-8000-000000000003'
const STUDIO = 'd1000000-0000-4000-8000-0000000000aa'
const STUDIO_B = 'd1000000-0000-4000-8000-0000000000bb'

interface Fragment {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}
const isFragment = (v: unknown): v is Fragment => typeof v === 'object' && v !== null && 'strings' in v && 'values' in v
const fakeSql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]): Fragment => ({ strings, values }), {
  unsafe: (text: string): Fragment => ({ strings: [text], values: [] }),
}) as unknown as TransactionSql

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
type R = Record<string, unknown> & { id: string; name: string; stage_id: string | null; k_at: string }

async function run<T = R>(uid: string, frag: unknown): Promise<T[]> {
  const q = render(frag as Fragment)
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`)
  try {
    return (await db.query<T>(q.text, q.params)).rows
  } finally {
    await db.exec(`reset role;`)
  }
}

const DAY = indiaDayStart()
const parse = (raw: Record<string, string>) => leadPageQuery.parse(raw)

/** Every page of a query, following the cursor. */
async function allPages(uid: string, raw: Record<string, string>): Promise<R[]> {
  const v = parse({ limit: '7', ...raw })
  const out: R[] = []
  let after = null as ReturnType<typeof decodeCursor>
  for (let i = 0; i < 100; i++) {
    const rows = await run(uid, selectLeadPage(fakeSql, v, DAY, after === 'bad' ? null : after))
    const page = rows.slice(0, v.limit)
    out.push(...page)
    if (rows.length <= v.limit) break
    after = decodeCursor(cursorAfter(page[page.length - 1]!, v.order), v.order)
  }
  return out
}

let stages: string[] = []
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(
    `grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant execute on all functions in schema public, auth to authenticated;`,
  )
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@p.test'), ('${STAFF}', 's@p.test'), ('${OWNER_B}', 'b@p.test');
    insert into companies (id, name, owner_user_id) values ('${STUDIO}', 'Studio', '${OWNER}'), ('${STUDIO_B}', 'Other', '${OWNER_B}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Asha Owner', 'o@p.test'),
      ('${STAFF}', '${STUDIO}', 'employee', 'Ravi Sales', 's@p.test'),
      ('${OWNER_B}', '${STUDIO_B}', 'super_admin', 'Bina', 'b@p.test');
  `)
  stages = (
    await q<{ id: string }>(
      `select s.id from crm_pipeline_stages s join crm_pipelines p on p.id = s.pipeline_id
        where p.company_id = $1 and p.is_default and s.kind = 'open' order by s.position`,
      [STUDIO],
    )
  ).map((r) => r.id)
  // 75 open leads over two stages, some due, some hot, some the staff's; all
  // made in the same second in pairs, so the id breaks the tie.
  for (let i = 0; i < 75; i++) {
    const stage = stages[i % 2]!
    const follow = i % 5 === 0 ? `now() - interval '3 days'` : i % 5 === 1 ? `'${DAY}'::timestamptz + interval '2 hours'` : i % 5 === 2 ? `now() + interval '9 days'` : 'null'
    await db.exec(`
      insert into crm_leads (company_id, name, phone, source, stage_id, is_hot, assigned_to, follow_up_at, created_at, deal_value, event_type)
      values ('${STUDIO}', 'Lead ${String(i).padStart(2, '0')}', '98000${String(i).padStart(5, '0')}', 'manual', '${stage}',
              ${i % 7 === 0}, ${i % 3 === 0 ? `'${STAFF}'` : 'null'}, ${follow},
              date_trunc('second', now()) - interval '${Math.floor(i / 2)} minutes', ${1000 * i}, ${i % 4 === 0 ? `'Wedding'` : 'null'});`)
  }
  await db.exec(`insert into crm_leads (company_id, name, phone, source, status, lost_reason) values ('${STUDIO}', 'Gone', '9100000001', 'manual', 'lost', 'Went elsewhere');`)
  await db.exec(`insert into crm_leads (company_id, name, phone, source) values ('${STUDIO_B}', 'Not yours', '9100000002', 'manual');`)
}, 180_000)

afterAll(async () => {
  await db.close()
})

describe('GET /crm/leads/page', () => {
  it('pages the newest first with nothing skipped or repeated, and counts them all', async () => {
    const rows = await allPages(OWNER, { order: 'newest' })
    expect(rows).toHaveLength(75)
    expect(new Set(rows.map((r) => r.id)).size).toBe(75)
    expect(rows.map((r) => r.name)).not.toContain('Gone')
    expect(rows.map((r) => r.name)).not.toContain('Not yours')
    const at = rows.map((r) => Date.parse(r.k_at))
    expect([...at].sort((a, b) => b - a)).toEqual(at)
    const [count] = await run<{ total: number }>(OWNER, countLeads(fakeSql, parse({}), DAY))
    expect(count!.total).toBe(75)
  })

  it('pages the list late first, then due today, hot first within each', async () => {
    const rows = await allPages(OWNER, { order: 'urgency' })
    expect(rows).toHaveLength(75)
    expect(new Set(rows.map((r) => r.id)).size).toBe(75)
    const rank = (r: R) => Number((r as unknown as { k_rank: number }).k_rank)
    const ranks = rows.map(rank)
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(ranks[0]).toBe(0)
    const late = rows.filter((r) => rank(r) === 0)
    expect(late).toHaveLength(15)
    const hotIdx = late.findIndex((r) => !r.is_hot)
    expect(late.slice(hotIdx).every((r) => !r.is_hot)).toBe(true)
  })

  it('applies filters on the server, so a page is never short', async () => {
    const hot = await allPages(OWNER, { view: 'hot' })
    expect(hot.length).toBe(11)
    expect(hot.every((r) => r.is_hot)).toBe(true)
    const today = await allPages(OWNER, { view: 'today' })
    expect(today).toHaveLength(30)
    const owner = await allPages(OWNER, { f_owner: STAFF })
    expect(owner).toHaveLength(25)
    const nobody = await allPages(OWNER, { f_owner: '__none' })
    expect(nobody).toHaveLength(50)
    const wedding = await allPages(OWNER, { f_event: 'Wedding', f_stage: stages[0]! })
    expect(wedding.every((r) => r.stage_id === stages[0])).toBe(true)
    expect(wedding).toHaveLength(19)
    const search = await allPages(OWNER, { q: 'Lead 7' })
    expect(search.map((r) => r.name).sort()).toEqual(['Lead 70', 'Lead 71', 'Lead 72', 'Lead 73', 'Lead 74'])
    const budget = await allPages(OWNER, { budget_min: '70000' })
    expect(budget).toHaveLength(5)
    const [n] = await run<{ total: number }>(OWNER, countLeads(fakeSql, parse({ view: 'hot' }), DAY))
    expect(n!.total).toBe(11)
    const lost = await allPages(OWNER, { outcome: 'lost' })
    expect(lost.map((r) => r.name)).toEqual(['Gone'])
  })

  it('refuses a cursor it did not make, or one for the other order', () => {
    expect(decodeCursor('nonsense', 'newest')).toBe('bad')
    const n = encodeCursor({ at: '2026-11-21 10:00:00+00', id: OWNER })
    expect(decodeCursor(n, 'urgency')).toBe('bad')
    expect(decodeCursor(n, 'newest')).toEqual({ at: '2026-11-21 10:00:00+00', id: OWNER })
  })

  it('shows another studio nothing', async () => {
    const rows = await allPages(OWNER_B, {})
    expect(rows.map((r) => r.name)).toEqual(['Not yours'])
  })

  it('a staff login sees no more than RLS lets it, and its own leads are all reachable', async () => {
    const rows = await allPages(STAFF, { order: 'urgency' })
    const mine = await allPages(STAFF, { f_owner: STAFF })
    expect(mine).toHaveLength(25)
    expect(rows.length).toBeGreaterThanOrEqual(25)
    expect(rows.every((r) => r.name !== 'Not yours')).toBe(true)
  })
})

describe('GET /crm/leads/columns', () => {
  it('gives each stage its first 31 newest cards and its own total', async () => {
    const rows = await run<R & { k_n: number; k_total: number }>(OWNER, selectColumns(fakeSql, parse({}), DAY, 30))
    const first = rows.filter((r) => r.stage_id === stages[0])
    const second = rows.filter((r) => r.stage_id === stages[1])
    expect(first).toHaveLength(31)
    expect(first[0]!.k_total).toBe(38)
    expect(second[0]!.k_total).toBe(37)
    // Show more continues the column with nothing skipped or repeated.
    const rest = await allPages(OWNER, { stage_id: stages[0]!, order: 'newest' })
    expect(rest).toHaveLength(38)
    expect(rest.slice(0, 30).map((r) => r.id)).toEqual(first.slice(0, 30).map((r) => r.id))
    const v = parse({ stage_id: stages[0]!, limit: '30' })
    const next = await run(OWNER, selectLeadPage(fakeSql, v, DAY, decodeCursor(cursorAfter(first[29]!, 'newest'), 'newest') as never))
    expect(next.map((r) => r.id)).toEqual(rest.slice(30).map((r) => r.id))
  })

  it('counts with the filters on', async () => {
    const rows = await run<R & { k_total: number }>(OWNER, selectColumns(fakeSql, parse({ view: 'hot' }), DAY, 30))
    const totals = new Map(rows.map((r) => [r.stage_id, r.k_total]))
    expect([...totals.values()].reduce((a, b) => a + b, 0)).toBe(11)
  })
})

describe('GET /crm/leads/counts', () => {
  it('sizes every view over all open leads', async () => {
    const [c] = await run<Record<string, number>>(OWNER, selectCounts(fakeSql, DAY))
    expect(c).toMatchObject({ all: 75, overdue: 15, due_today: 15, today: 30, hot: 11, unassigned: 50 })
    expect(c!.no_follow_up).toBe((await allPages(OWNER, { view: "no_follow_up" })).length)
  })
})
