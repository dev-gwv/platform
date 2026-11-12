import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { CARD_SELECT, SUMMARY_SQL, outcomeWhere } from '../../services/api/src/modules/crm/lead-reads'

/**
 * The Leads page's slim reads (speed plan, part 1): `GET /crm/leads?outcome=`
 * and `?shape=card`, `GET /crm/leads/summary`, and the one-lead read the
 * drawer uses. Runs the route's own SQL text, as the studio's own login, so
 * RLS is in the way exactly as it is on the server.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'c7300000-0000-4000-8000-000000000001'
const OTHER_OWNER = 'c7300000-0000-4000-8000-000000000002'
const STUDIO = 'c7300000-0000-4000-8000-0000000000aa'
const OTHER = 'c7300000-0000-4000-8000-0000000000bb'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const asUser = async <T>(user: string, fn: () => Promise<T>): Promise<T> => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role;`)
  }
}

let n = 0
const lead = async (company: string, name: string, extra: Record<string, unknown> = {}) => {
  n += 1
  const cols: Record<string, unknown> = { company_id: company, name, phone: `98765${String(n).padStart(5, '0')}`, source: 'manual', ...extra }
  const keys = Object.keys(cols)
  const [row] = await q<{ id: string }>(
    `insert into crm_leads (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(cols),
  )
  return row!.id
}
const stageOf = async (company: string, kind: string) =>
  (
    await q<{ id: string }>(
      `select s.id from crm_pipeline_stages s join crm_pipelines p on p.id = s.pipeline_id
        where p.company_id = $1 and p.is_default and s.kind = $2 order by s.position limit 1`,
      [company, kind],
    )
  )[0]!.id

type Card = Record<string, unknown> & { id: string; name: string; status: string }
const list = (user: string, where: string) =>
  asUser(user, () => q<Card>(`${CARD_SELECT} where l.is_archived = false and ${where} order by l.created_at desc`))

let ids: { open1: string; open2: string; won: string; lost: string; archived: string; theirs: string }
let firstStage: string

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
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  // Supabase grants these to `authenticated` by default; RLS is what limits rows.
  await db.exec(
    `grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant execute on all functions in schema public, auth to authenticated;`,
  )

  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${OTHER_OWNER}', 'x@s.test');
    insert into companies (id, name, owner_user_id) values ('${STUDIO}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Owner', 'o@s.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@s.test');
  `)

  firstStage = await stageOf(STUDIO, 'open')
  const long = 'Wants candid and drone. '.repeat(20)
  ids = {
    open1: await lead(STUDIO, 'Priya', { deal_value: 100000, notes: long }),
    open2: await lead(STUDIO, 'Rahul', { deal_value: 50000, last_contacted_at: new Date().toISOString(), status: 'contacted' }),
    won: await lead(STUDIO, 'Won Couple', { deal_value: 200000 }),
    lost: await lead(STUDIO, 'Lost Couple', { deal_value: 70000 }),
    archived: await lead(STUDIO, 'Old Couple', { deal_value: 999, is_archived: true }),
    theirs: await lead(OTHER, 'Not yours', { deal_value: 1 }),
  }
  await q(`update crm_leads set stage_id = $1 where id = $2`, [await stageOf(STUDIO, 'won'), ids.won])
  await q(`update crm_leads set stage_id = $1, lost_reason = 'Went with a cheaper studio' where id = $2`, [
    await stageOf(STUDIO, 'lost'),
    ids.lost,
  ])
})

describe('the Leads page reads (speed plan)', () => {
  it('splits leads by outcome, the way isOpen does', async () => {
    const names = async (o: 'open' | 'won' | 'lost' | 'all') =>
      (await list(OWNER, outcomeWhere(o))).map((l) => l.name).sort()
    expect(await names('open')).toEqual(['Priya', 'Rahul'])
    expect(await names('won')).toEqual(['Won Couple'])
    expect(await names('lost')).toEqual(['Lost Couple'])
    expect(await names('all')).toEqual(['Lost Couple', 'Priya', 'Rahul', 'Won Couple'])
    expect(outcomeWhere(undefined)).toBe('true')
  })

  it('sends a card with only what the page reads, the notes cut to a preview', async () => {
    const [priya] = (await list(OWNER, outcomeWhere('open'))).filter((l) => l.id === ids.open1)
    expect(priya).toBeDefined()
    expect(priya).not.toHaveProperty('notes')
    expect(priya).not.toHaveProperty('enquiry_answers')
    expect(priya).not.toHaveProperty('converted_project_name')
    expect(String(priya!.notes_preview)).toHaveLength(140)
    expect(priya).toMatchObject({ date_status: 'unknown', tags: [], functions: [], is_archived: false })
  })

  it('reads one lead whole for the drawer, and never another studio’s', async () => {
    const mine = await asUser(OWNER, () => q<Card>(`${CARD_SELECT} where l.id = $1`, [ids.open1]))
    expect(mine).toHaveLength(1)
    const theirs = await asUser(OWNER, () => q(`select id from crm_leads where id = $1`, [ids.theirs]))
    expect(theirs).toHaveLength(0)
  })

  it('counts the pipeline’s open, live leads per stage on the server', async () => {
    const [s] = await asUser(OWNER, () =>
      q<{ stages: { stage_id: string; count: number; value: number }[]; open_total: number; open_value: number; not_contacted: number }>(
        SUMMARY_SQL,
        [null],
      ),
    )
    expect(s!.open_total).toBe(2)
    expect(s!.open_value).toBe(150000)
    expect(s!.not_contacted).toBe(1)
    expect(s!.stages.reduce((a, x) => a + x.count, 0)).toBe(2)
    // Named pipeline: the default one, asked for by id, says the same.
    const [pipe] = await q<{ id: string }>(`select id from crm_pipelines where company_id = $1 and is_default`, [STUDIO])
    const [byId] = await asUser(OWNER, () => q<{ open_total: number }>(SUMMARY_SQL, [pipe!.id]))
    expect(byId!.open_total).toBe(2)
    // Another studio's login sees only its own lead.
    const [other] = await asUser(OTHER_OWNER, () => q<{ open_total: number; open_value: number }>(SUMMARY_SQL, [null]))
    expect(other).toMatchObject({ open_total: 1, open_value: 1 })
    expect(firstStage).toBeTruthy()
  })
})
