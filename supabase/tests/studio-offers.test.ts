import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0268: the platform owner sees what each studio is doing and makes some of
 * them a personal offer -- a percent off the first plan, never a renewal,
 * for the regular price unless the offer says Diamond members too.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const ADMIN = 'e1000000-0000-4000-8000-000000000001'
const NEW_OWNER = 'e1000000-0000-4000-8000-000000000002'
const GEM_OWNER = 'e1000000-0000-4000-8000-000000000003'
const PAID_OWNER = 'e1000000-0000-4000-8000-000000000004'
const NEW = 'e1000000-0000-4000-8000-0000000000a1'
const GEM = 'e1000000-0000-4000-8000-0000000000a2'
const PAID = 'e1000000-0000-4000-8000-0000000000a3'
const CLIENT = 'e1000000-0000-4000-8000-0000000000c1'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const as = (uid: string | null) => q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10)
const make = (ids: string[], percent: number, diamond = false, until = inDays(2), tiers = ['starter', 'pro', 'max']) =>
  q<{ r: { made: number; skipped: { name: string; reason: string }[] } }>(
    `select platform_make_offers($1::uuid[], $2, $3::text[], $4::date, 'Just for you', $5) as r`,
    [ids, percent, tiers, until, diamond],
  ).then((rows) => rows[0]!.r)
const mine = () => q<{ id: string; percent: number }>(`select id, percent from my_offer()`)

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
    insert into auth.users (id, email) values
      ('${ADMIN}', 'a@s.test'), ('${NEW_OWNER}', 'n@s.test'), ('${GEM_OWNER}', 'g@s.test'), ('${PAID_OWNER}', 'p@s.test');
    insert into platform_admins (user_id) values ('${ADMIN}');
    insert into companies (id, name, owner_user_id) values
      ('${NEW}', 'New Studio', '${NEW_OWNER}'), ('${GEM}', 'Gem Studio', '${GEM_OWNER}'), ('${PAID}', 'Paid Studio', '${PAID_OWNER}');
    update companies set member_tier = 'diamond' where id = '${GEM}';
    insert into users (user_id, company_id, role, name, email) values
      ('${NEW_OWNER}', '${NEW}', 'super_admin', 'New owner', 'n@s.test'),
      ('${GEM_OWNER}', '${GEM}', 'super_admin', 'Gem owner', 'g@s.test'),
      ('${PAID_OWNER}', '${PAID}', 'super_admin', 'Paid owner', 'p@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${NEW}', 'Priya');
    insert into projects (company_id, client_id, name) values ('${NEW}', '${CLIENT}', 'Wedding 1'), ('${NEW}', '${CLIENT}', 'Wedding 2');
    insert into crm_leads (company_id, name) values ('${NEW}', 'Asha');
    insert into usage_events (company_id, session_id, occurred_at) values ('${NEW}', 's1', now()), ('${NEW}', 's2', now() - interval '3 days');
  `)
  await as(ADMIN)
  await q(`select platform_assign_plan($1, 'starter_yearly_regular')`, [PAID])
})

describe('what each studio is doing (0268)', () => {
  it('is for platform admins only', async () => {
    await as(NEW_OWNER)
    await expect(q(`select * from platform_studio_activity()`)).rejects.toThrow(/platform access only/)
    await expect(make([NEW], 20)).rejects.toThrow(/platform access only/)
    await as(ADMIN)
  })

  it('counts what a studio has made and the days it opened the app', async () => {
    const rows = await q<{ company_id: string; projects: number; leads: number; active_days_7: number; bought: boolean }>(
      `select company_id, projects, leads, active_days_7, bought from platform_studio_activity()`,
    )
    const by = Object.fromEntries(rows.map((r) => [r.company_id, r]))
    expect(by[NEW]).toMatchObject({ projects: 2, leads: 1, active_days_7: 2, bought: false })
    expect(by[PAID]!.bought).toBe(true)
  })
})

describe('a personal offer (0268)', () => {
  it('goes only to studios that have never bought, and not to Diamond members unless the offer says so', async () => {
    const r = await make([NEW, GEM, PAID], 20)
    expect(r.made).toBe(1)
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Gem Studio', reason: 'IPC Diamond member' }),
        expect.objectContaining({ name: 'Paid Studio', reason: 'has bought a plan before' }),
      ]),
    )
    expect((await make([GEM], 10, true)).made).toBe(1)
  })

  it('refuses a past date or a silly percent', async () => {
    await expect(make([NEW], 20, false, inDays(-2))).rejects.toThrow(/today or a later date/)
    await expect(make([NEW], 95)).rejects.toThrow(/1 to 90 percent/)
  })

  it('shows the studio its one live offer, and a new one replaces it', async () => {
    await as(NEW_OWNER)
    const [first] = await mine()
    expect(first!.percent).toBe(20)
    await q(`select offer_mark($1, 'asked')`, [first!.id])
    await as(ADMIN)
    await make([NEW], 25)
    await as(NEW_OWNER)
    const live = await mine()
    expect(live.map((o) => o.percent)).toEqual([25])
    await as(ADMIN)
    const [old] = await q<{ seen: boolean; asked: boolean; cancelled: boolean }>(
      `select seen_at is not null as seen, asked_at is not null as asked, cancelled_at is not null as cancelled
         from platform_list_offers() where id = $1`,
      [first!.id],
    )
    expect(old).toEqual({ seen: true, asked: true, cancelled: true })
  })

  it('is used when the studio is given a plan it covers, and then stops showing', async () => {
    await q(`select platform_offer_used($1, 'pro_yearly_regular')`, [NEW])
    await q(`select platform_assign_plan($1, 'pro_yearly_regular')`, [NEW])
    const [used] = await q<{ used_plan: string }>(`select used_plan from platform_list_offers() where company_id = $1 and used_at is not null`, [NEW])
    expect(used!.used_plan).toBe('pro_yearly_regular')
    await as(NEW_OWNER)
    expect(await mine()).toEqual([])
    await as(ADMIN)
  })

  it('never shows another studio an offer, and a cancelled one is gone', async () => {
    const [gem] = await q<{ id: string }>(`select id from platform_list_offers() where company_id = $1`, [GEM])
    await as(NEW_OWNER)
    await q(`select offer_mark($1, 'seen')`, [gem!.id])
    await as(ADMIN)
    const [still] = await q<{ seen: boolean }>(`select seen_at is not null as seen from platform_list_offers() where id = $1`, [gem!.id])
    expect(still!.seen).toBe(false)
    await q(`select platform_cancel_offer($1)`, [gem!.id])
    await as(GEM_OWNER)
    expect(await mine()).toEqual([])
    await as(ADMIN)
  })
})
