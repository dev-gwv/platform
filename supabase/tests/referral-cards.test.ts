import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Referral cards (0298): a campaign carries the friend's offer; a friend's
 * lead is linked to the referral; booking it makes the client's reward due
 * and rings the bell; the friend's offer is read for their invoice.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const A = 'f2980000-0000-4000-8000-00000000000a'
const B = 'f2980000-0000-4000-8000-00000000000b'
const UA = 'f2980000-0000-4000-8000-0000000000a1'
const UB = 'f2980000-0000-4000-8000-0000000000b1'
const CLIENT = 'f2980000-0000-4000-8000-0000000000c1'
const PROJ = 'f2980000-0000-4000-8000-0000000000e1'
const CAMP = 'f2980000-0000-4000-8000-0000000000d1'
const SUB = 'f2980000-0000-4000-8000-0000000000f1'
const LEAD = 'f2980000-0000-4000-8000-000000000011'
const FRIEND_PROJ = 'f2980000-0000-4000-8000-0000000000e2'

let db: PGlite
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0]!
const as = (uid: string) => db.exec(`set request.jwt.claim.sub = '${uid}';`)

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
  await db.exec(`grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant execute on all functions in schema public, auth to authenticated;`)
  await db.exec(`
    insert into auth.users (id, email) values ('${UA}', 'a@rc.test'), ('${UB}', 'b@rc.test');
    insert into companies (id, name, owner_user_id) values ('${A}', 'Asha Studio', '${UA}'), ('${B}', 'Bina Films', '${UB}');
    insert into users (user_id, company_id, role, name, email) values
      ('${UA}', '${A}', 'super_admin', 'Asha', 'a@rc.test'), ('${UB}', '${B}', 'super_admin', 'Bina', 'b@rc.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${A}', 'Priya Sharma');
    insert into projects (id, company_id, client_id, name, created_by) values ('${PROJ}', '${A}', '${CLIENT}', 'Priya Wedding', '${UA}');
    insert into projects (id, company_id, client_id, name) values ('${FRIEND_PROJ}', '${A}', '${CLIENT}', 'Riya Wedding');
    insert into referral_campaigns (id, company_id, name, slug, reward_type, reward_value, project_id, client_id,
                                    friend_reward_type, friend_reward_value, friend_reward_title)
    values ('${CAMP}', '${A}', 'Priya refers', 'priya-abc123', 'fixed', 5000, '${PROJ}', '${CLIENT}',
            'fixed', 10000, '₹10,000 off your wedding');
    insert into referral_submissions (id, company_id, campaign_id, client_name, client_phone, referring_client_name, status, reward_status)
    values ('${SUB}', '${A}', '${CAMP}', 'Riya', '9876500011', 'Priya Sharma', 'new', 'not_due');
    insert into crm_leads (id, company_id, name, phone, source, status, referral_submission_id, referred_by_name)
    values ('${LEAD}', '${A}', 'Riya', '9876500011', 'referral', 'new', '${SUB}', 'Priya Sharma');
  `)
})

describe('referral cards (0298)', () => {
  it('keeps the friend offer sane', async () => {
    await expect(
      db.exec(`update referral_campaigns set friend_reward_type = 'percentage', friend_reward_value = 150 where id = '${CAMP}'`),
    ).rejects.toThrow()
    await expect(db.exec(`update referral_campaigns set friend_reward_type = 'cash' where id = '${CAMP}'`)).rejects.toThrow()
  })

  it('makes the reward due and rings the bell once the friend books', async () => {
    await db.exec(`update crm_leads set status = 'converted', converted_project_id = '${FRIEND_PROJ}' where id = '${LEAD}'`)
    const s = await one<{ status: string; reward_status: string }>(`select status, reward_status from referral_submissions where id = '${SUB}'`)
    expect(s).toEqual({ status: 'booked', reward_status: 'due' })
    const n = await one<{ n: number; title: string }>(
      `select count(*)::int as n, max(title) as title from notifications where dedupe_key = 'referral_booked:${SUB}'`,
    )
    expect(n.n).toBe(1)
    expect(n.title).toBe("Riya booked through Priya Sharma's card")
  })

  it('reads the friend offer for their project, inside the studio only', async () => {
    await db.exec(`set role authenticated`)
    await as(UA)
    const o = await one<{ referrer: string; friend_reward_type: string; friend_reward_value: string }>(
      `select * from referral_offer_for_project('${FRIEND_PROJ}')`,
    )
    expect(o.referrer).toBe('Priya Sharma')
    expect(o.friend_reward_type).toBe('fixed')
    expect(Number(o.friend_reward_value)).toBe(10000)
    expect((await db.query(`select * from referral_offer_for_project('${PROJ}')`)).rows).toHaveLength(0)
    await as(UB)
    expect((await db.query(`select * from referral_offer_for_project('${FRIEND_PROJ}')`)).rows).toHaveLength(0)
    await db.exec(`reset role`)
  })

  it('puts the reward back to not due when the booking is undone, never a given one', async () => {
    await db.exec(`reset request.jwt.claim.sub`)
    await db.exec(`update crm_leads set status = 'contacted' where id = '${LEAD}'`)
    expect((await one<{ r: string }>(`select reward_status as r from referral_submissions where id = '${SUB}'`)).r).toBe('not_due')
    await db.exec(`update crm_leads set status = 'converted' where id = '${LEAD}'`)
    await db.exec(`update referral_submissions set reward_status = 'given' where id = '${SUB}'`)
    await db.exec(`update crm_leads set status = 'contacted' where id = '${LEAD}'`)
    expect((await one<{ r: string }>(`select reward_status as r from referral_submissions where id = '${SUB}'`)).r).toBe('given')
  })

  it('keeps each studio to its own referral defaults', async () => {
    await db.exec(`set role authenticated`)
    await as(UA)
    await db.exec(`insert into referral_settings (friend_reward_type, friend_reward_value, friend_reward_title) values ('free_addon', 0, 'Free pre-wedding shoot')`)
    await as(UB)
    expect((await db.query(`select * from referral_settings`)).rows).toHaveLength(0)
    await as(UA)
    expect((await one<{ t: string }>(`select friend_reward_title as t from referral_settings`)).t).toBe('Free pre-wedding shoot')
    await db.exec(`reset role`)
  })

  it('counts an open of an active card only', async () => {
    await db.exec(`set role anon`)
    await db.exec(`select referral_card_opened('priya-abc123')`)
    await db.exec(`select referral_card_opened('nobody')`)
    await db.exec(`reset role`)
    expect((await one<{ v: number }>(`select views as v from referral_campaigns where id = '${CAMP}'`)).v).toBe(1)
  })
})
