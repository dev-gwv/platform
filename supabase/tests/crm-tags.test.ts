import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Tags on a lead (0197), and the free-text column they replaced.
 *
 * `group_name` held one value per lead and its server filter was never wired to
 * anything, so a studio could label forty leads and had no way to ask for those
 * forty back. These check the three things that make tags different: many per
 * lead, one shared list per studio, and a boundary at the studio edge — a
 * guessed tag id must not let one company label another's leads.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const RIVAL_OWNER = '33333333-3333-3333-3333-333333333333'
const RIVAL = '44444444-4444-4444-4444-444444444444'

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

  // Leads carrying group_name must exist BEFORE the migrations run, or the
  // backfill has nothing to find. So apply everything up to 0196, seed, then
  // let 0197 do its work.
  const files = readdirSync(migDir)
    .filter((x) => x.endsWith('.sql') && !x.startsWith('0000_'))
    .sort()
  const cut = files.findIndex((f) => f.startsWith('0197_'))
  expect(cut).toBeGreaterThan(0)

  for (const f of files.slice(0, cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  for (const [id, email] of [
    [OWNER, 'o@s.test'],
    [RIVAL_OWNER, 'r@s.test'],
  ]) {
    await db.exec(`insert into auth.users (id, email) values ('${id}', '${email}');`)
  }
  await db.exec(`
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Studio', '${OWNER}'),
      ('${RIVAL}', 'Rival', '${RIVAL_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${RIVAL_OWNER}', '${RIVAL}', 'super_admin', 'Rival', 'r@s.test');
  `)

  // Three leads in one studio share a group; a fourth uses different casing and
  // padding, which is the same tag; the rival studio reuses the same word.
  await db.exec(`
    insert into crm_leads (company_id, name, phone, source, group_name) values
      ('${COMPANY}', 'A', '9800000001', 'manual', 'Referral'),
      ('${COMPANY}', 'B', '9800000002', 'manual', 'Referral'),
      ('${COMPANY}', 'C', '9800000003', 'manual', '  referral '),
      ('${COMPANY}', 'D', '9800000004', 'manual', 'Destination'),
      ('${COMPANY}', 'E', '9800000005', 'manual', null),
      ('${RIVAL}',   'F', '9800000006', 'manual', 'Referral');
  `)

  for (const f of files.slice(cut)) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('the group_name backfill', () => {
  it('turns each distinct group into one tag per studio', async () => {
    const rows = await q<{ name: string; company_id: string }>(
      `select name, company_id from crm_tags order by company_id, lower(name)`,
    )
    // 'Referral' and '  referral ' are one tag here, and the rival's 'Referral'
    // is a different row because a tag list belongs to a studio.
    expect(rows.filter((r) => r.company_id === COMPANY).map((r) => r.name).sort()).toEqual([
      'Destination',
      'Referral',
    ])
    expect(rows.filter((r) => r.company_id === RIVAL).map((r) => r.name)).toEqual(['Referral'])
  })

  it('carries every lead that had one over to the tag', async () => {
    const n = await one<{ n: number }>(`
      select count(*)::int as n
        from crm_lead_tags lt
        join crm_tags t on t.id = lt.tag_id
       where t.company_id = '${COMPANY}' and lower(t.name) = 'referral'`)
    expect(n.n).toBe(3) // including the one with odd casing and padding
  })

  it('leaves a lead that had no group untagged', async () => {
    const n = await one<{ n: number }>(`
      select count(*)::int as n from crm_lead_tags lt
        join crm_leads l on l.id = lt.lead_id
       where l.name = 'E'`)
    expect(n.n).toBe(0)
  })

  it('keeps group_name readable, so the release is reversible', async () => {
    const row = await one<{ group_name: string }>(
      `select group_name from crm_leads where name = 'A' and company_id = '${COMPANY}'`,
    )
    expect(row.group_name).toBe('Referral')
  })
})

describe('a tag list belongs to one studio', () => {
  it('refuses the same name twice in one studio', async () => {
    await expect(
      db.exec(`insert into crm_tags (company_id, name) values ('${COMPANY}', 'REFERRAL');`),
    ).rejects.toThrow()
  })

  it('allows the same name in two studios', async () => {
    await db.exec(`insert into crm_tags (company_id, name) values ('${RIVAL}', 'Destination');`)
    const n = await one<{ n: number }>(`select count(*)::int as n from crm_tags where lower(name) = 'destination'`)
    expect(n.n).toBe(2)
  })
})

describe('crm_tag_leads', () => {
  let tag: string
  let leads: string[]

  beforeEach(async () => {
    await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
    tag = (
      await one<{ id: string }>(`select id from crm_tags where company_id = '${COMPANY}' and name = 'Destination'`)
    ).id
    leads = (
      await q<{ id: string }>(`select id from crm_leads where company_id = '${COMPANY}' order by name limit 3`)
    ).map((r) => r.id)
  })

  it('attaches to many leads and is idempotent', async () => {
    const ids = `array['${leads.join("','")}']::uuid[]`
    await db.exec(`select crm_tag_leads(${ids}, '${tag}', true)`)
    const after = await one<{ n: number }>(
      `select count(*)::int as n from crm_lead_tags where tag_id = '${tag}' and lead_id = any(${ids})`,
    )
    expect(after.n).toBe(3)

    // Running it twice must not double anything, because a bulk action people
    // click twice is a bulk action people click twice.
    const second = await one<{ n: number }>(`select crm_tag_leads(${ids}, '${tag}', true) as n`)
    expect(second.n).toBe(0)
  })

  it('detaches again', async () => {
    const ids = `array['${leads.join("','")}']::uuid[]`
    await db.exec(`select crm_tag_leads(${ids}, '${tag}', true)`)
    await db.exec(`select crm_tag_leads(${ids}, '${tag}', false)`)
    const after = await one<{ n: number }>(
      `select count(*)::int as n from crm_lead_tags where tag_id = '${tag}' and lead_id = any(${ids})`,
    )
    expect(after.n).toBe(0)
  })

  it('will not label another studio’s lead even with a real tag id', async () => {
    const theirs = (await one<{ id: string }>(`select id from crm_leads where company_id = '${RIVAL}'`)).id
    const n = await one<{ n: number }>(`select crm_tag_leads(array['${theirs}']::uuid[], '${tag}', true) as n`)
    expect(n.n).toBe(0)
    // Their lead does carry a tag -- its own studio's 'Referral', from the
    // backfill. What must not happen is OUR tag landing on it.
    const rows = await one<{ n: number }>(
      `select count(*)::int as n from crm_lead_tags where lead_id = '${theirs}' and tag_id = '${tag}'`,
    )
    expect(rows.n).toBe(0)
  })

  it('refuses a tag belonging to another studio', async () => {
    const theirTag = (await one<{ id: string }>(`select id from crm_tags where company_id = '${RIVAL}' limit 1`)).id
    await expect(
      db.exec(`select crm_tag_leads(array['${leads[0]}']::uuid[], '${theirTag}', true)`),
    ).rejects.toThrow(/unknown tag/)
  })
})

describe('crm_set_lead_tags', () => {
  it('replaces the whole set in one call', async () => {
    const lead = (await one<{ id: string }>(`select id from crm_leads where company_id = '${COMPANY}' and name = 'E'`)).id
    const [a, b] = (
      await q<{ id: string }>(`select id from crm_tags where company_id = '${COMPANY}' order by name limit 2`)
    ).map((r) => r.id)

    await db.exec(`select crm_set_lead_tags('${lead}', array['${a}','${b}']::uuid[])`)
    expect((await one<{ n: number }>(`select count(*)::int as n from crm_lead_tags where lead_id = '${lead}'`)).n).toBe(2)

    // Sending only one is how the picker removes the other.
    await db.exec(`select crm_set_lead_tags('${lead}', array['${a}']::uuid[])`)
    const left = await q<{ tag_id: string }>(`select tag_id from crm_lead_tags where lead_id = '${lead}'`)
    expect(left.map((r) => r.tag_id)).toEqual([a])

    // An empty set clears it, rather than being ignored as "no change".
    await db.exec(`select crm_set_lead_tags('${lead}', array[]::uuid[])`)
    expect((await one<{ n: number }>(`select count(*)::int as n from crm_lead_tags where lead_id = '${lead}'`)).n).toBe(0)
  })

  it('deleting a tag takes it off the leads, deactivating does not', async () => {
    const lead = (await one<{ id: string }>(`select id from crm_leads where company_id = '${COMPANY}' and name = 'D'`)).id
    const tag = (
      await one<{ id: string }>(`insert into crm_tags (company_id, name) values ('${COMPANY}', 'Temp') returning id`)
    ).id
    await db.exec(`select crm_set_lead_tags('${lead}', array['${tag}']::uuid[])`)

    await db.exec(`update crm_tags set is_active = false where id = '${tag}'`)
    expect((await one<{ n: number }>(`select count(*)::int as n from crm_lead_tags where tag_id = '${tag}'`)).n).toBe(1)

    await db.exec(`delete from crm_tags where id = '${tag}'`)
    expect((await one<{ n: number }>(`select count(*)::int as n from crm_lead_tags where tag_id = '${tag}'`)).n).toBe(0)
  })
})
