import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The rota gives the next lead to whoever is carrying least.
 *
 * It did not. Until 0196 all three assigning functions ordered the rota by
 * `count(*)` over every lead a member had ever held — converted, lost and
 * archived included — so the longer someone worked here the less work they
 * were given. A rep with a year of closed business eventually received
 * nothing and a new hire received everything. No error, no warning, and the
 * rota screen made it worse by counting *open* leads and printing "N open"
 * beside a sentence promising that was the rule.
 *
 * The first test here is that regression, written so it fails against the old
 * ordering: Closer has two hundred finished leads and nothing live, Newbie has
 * three live ones. The next lead is Closer's.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const CLOSER = '33333333-3333-3333-3333-333333333333'
const NEWBIE = '44444444-4444-4444-4444-444444444444'
const OTHER_COMPANY = '66666666-6666-6666-6666-666666666666'
const OTHER_OWNER = '77777777-7777-7777-7777-777777777777'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]

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
  for (const f of readdirSync(migDir)
    .filter((x) => x.endsWith('.sql') && !x.startsWith('0000_'))
    .sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }

  for (const [id, email] of [
    [OWNER, 'o@s.test'],
    [CLOSER, 'closer@s.test'],
    [NEWBIE, 'newbie@s.test'],
    [OTHER_OWNER, 'other@s.test'],
  ]) {
    await db.exec(`insert into auth.users (id, email) values ('${id}', '${email}');`)
  }
  await db.exec(`
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Studio', '${OWNER}'),
      ('${OTHER_COMPANY}', 'Rival Studio', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}',  '${COMPANY}', 'super_admin', 'Owner',  'o@s.test'),
      ('${CLOSER}', '${COMPANY}', 'employee',    'Closer', 'closer@s.test'),
      ('${NEWBIE}', '${COMPANY}', 'employee',    'Newbie', 'newbie@s.test'),
      ('${OTHER_OWNER}', '${OTHER_COMPANY}', 'super_admin', 'Rival', 'other@s.test');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

let seq = 0
/** A lead in whatever state the test needs, bypassing the rota. */
const lead = async (assignee: string, status: string, archived = false) => {
  seq += 1
  const lost = status === 'lost' ? `'Client went elsewhere'` : 'null'
  return (
    await one<{ id: string }>(`
      insert into crm_leads (company_id, name, phone, source, assigned_to, status, is_archived, lost_reason)
      values ('${COMPANY}', 'Seed ${seq}', '9${String(700000000 + seq)}', 'manual',
              '${assignee}', '${status}', ${archived}, ${lost})
      returning id`)
  ).id
}

const rota = async (strategy: 'least_loaded' | 'round_robin') => {
  await db.exec(`delete from crm_distribution_rules where company_id = '${COMPANY}';`)
  await db.exec(`
    insert into crm_distribution_rules (company_id, user_id, priority, is_active, strategy) values
      ('${COMPANY}', '${CLOSER}', 0, true, 'round_robin'),
      ('${COMPANY}', '${NEWBIE}', 1, true, 'round_robin');`)
  await db.exec(`
    insert into crm_settings (company_id, assign_strategy) values ('${COMPANY}', '${strategy}')
      on conflict (company_id) do update set assign_strategy = '${strategy}';`)
}

const pick = async () =>
  (await one<{ crm_pick_assignee: string | null }>(`select crm_pick_assignee('${COMPANY}')`)).crm_pick_assignee

beforeEach(async () => {
  await db.exec(`delete from crm_leads where company_id = '${COMPANY}';`)
  await db.exec(`delete from crm_distribution_rules where company_id = '${COMPANY}';`)
  await db.exec(`delete from crm_settings where company_id = '${COMPANY}';`)
})

describe('load is counted in open leads', () => {
  it('prefers the rep whose work is finished over the one still holding three', async () => {
    await rota('least_loaded')
    // Two hundred closed deals. Under the old ordering this made Closer the
    // busiest person on the rota and permanently ineligible.
    for (let i = 0; i < 100; i += 1) await lead(CLOSER, 'converted')
    for (let i = 0; i < 100; i += 1) await lead(CLOSER, 'lost')
    for (let i = 0; i < 3; i += 1) await lead(NEWBIE, 'new')

    expect(await pick()).toBe(CLOSER)
  })

  it('does not count an archived lead as work in hand', async () => {
    await rota('least_loaded')
    for (let i = 0; i < 5; i += 1) await lead(CLOSER, 'new', true)
    await lead(NEWBIE, 'new')

    expect(await pick()).toBe(CLOSER)
  })

  it('still counts a lead that is genuinely live', async () => {
    await rota('least_loaded')
    for (let i = 0; i < 4; i += 1) await lead(CLOSER, 'contacted')
    await lead(NEWBIE, 'proposal_sent')

    expect(await pick()).toBe(NEWBIE)
  })

  it('ignores another studio’s leads entirely', async () => {
    await rota('least_loaded')
    for (let i = 0; i < 6; i += 1) await lead(NEWBIE, 'new')
    // Closer has nothing here, so Closer is next regardless of the rival.
    expect(await pick()).toBe(CLOSER)
  })
})

describe('the strategy column finally does something', () => {
  it('round robin takes turns where least loaded would repeat', async () => {
    await rota('round_robin')
    const first = await pick()
    const second = await pick()
    expect(first).toBe(CLOSER) // priority 0, never assigned
    expect(second).toBe(NEWBIE) // Closer just had one

    // Least loaded, given the same rota and no leads at all, keeps answering
    // with the same person because nobody's load ever changes.
    await rota('least_loaded')
    expect(await pick()).toBe(CLOSER)
    expect(await pick()).toBe(CLOSER)
  })

  it('records the turn it just gave out', async () => {
    await rota('round_robin')
    await pick()
    const row = await one<{ assigned_count: number; last_assigned_at: string | null }>(
      `select assigned_count, last_assigned_at from crm_distribution_rules
        where company_id = '${COMPANY}' and user_id = '${CLOSER}'`,
    )
    expect(row.assigned_count).toBe(1)
    expect(row.last_assigned_at).not.toBeNull()
  })

  it('defaults to least loaded for a studio that never chose', async () => {
    await db.exec(`
      insert into crm_distribution_rules (company_id, user_id, priority, is_active) values
        ('${COMPANY}', '${CLOSER}', 0, true),
        ('${COMPANY}', '${NEWBIE}', 1, true);`)
    // No crm_settings row at all.
    for (let i = 0; i < 3; i += 1) await lead(CLOSER, 'new')
    expect(await pick()).toBe(NEWBIE)
  })

  it('skips a paused member', async () => {
    await rota('least_loaded')
    await db.exec(
      `update crm_distribution_rules set is_active = false where company_id = '${COMPANY}' and user_id = '${CLOSER}';`,
    )
    for (let i = 0; i < 9; i += 1) await lead(NEWBIE, 'new')
    expect(await pick()).toBe(NEWBIE)
  })

  it('hands back nothing when the rota is empty rather than failing', async () => {
    await db.exec(`insert into crm_settings (company_id) values ('${COMPANY}') on conflict do nothing;`)
    expect(await pick()).toBeNull()
  })
})

describe('the callers use it', () => {
  it('add_lead routes a manual lead through the rota', async () => {
    await rota('least_loaded')
    for (let i = 0; i < 3; i += 1) await lead(CLOSER, 'new')

    const id = (await one<{ add_lead: string }>(`select add_lead('Walk-in', '9812345678')`)).add_lead
    const got = await one<{ assigned_to: string }>(`select assigned_to from crm_leads where id = '${id}'`)
    expect(got.assigned_to).toBe(NEWBIE)
  })

  it('a webhook lead lands on the lighter rep', async () => {
    await rota('least_loaded')
    for (let i = 0; i < 3; i += 1) await lead(NEWBIE, 'new')
    // create_lead_source returns the whole crm_webhook_sources row, not the key.
    const key = (
      await one<{ source_key: string }>(`select (create_lead_source('Website', 'webform')).source_key`)
    ).source_key

    const id = (
      await one<{ capture_lead: string }>(`select capture_lead('${key}', 'Enquiry', '9899000111', null, '{}'::jsonb)`)
    ).capture_lead
    const got = await one<{ assigned_to: string }>(`select assigned_to from crm_leads where id = '${id}'`)
    expect(got.assigned_to).toBe(CLOSER)
  })

  it('a CSV rotates across the rota instead of landing on one person', async () => {
    await rota('round_robin')
    const rows = JSON.stringify([
      { name: 'One', phone: '9811111111' },
      { name: 'Two', phone: '9822222222' },
      { name: 'Three', phone: '9833333333' },
      { name: 'Four', phone: '9844444444' },
    ]).replace(/'/g, "''")

    await db.exec(`select crm_import_leads('${rows}'::jsonb, true, 'create')`)
    const spread = await q<{ assigned_to: string; n: number }>(
      `select assigned_to, count(*)::int as n from crm_leads
        where company_id = '${COMPANY}' and source_key = 'csv_import'
        group by assigned_to order by assigned_to`,
    )
    // Two people, four leads, two each — not four on whoever sorted first.
    expect(spread).toHaveLength(2)
    expect(spread.map((r) => r.n)).toEqual([2, 2])
  })
})
