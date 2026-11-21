import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * An ended referral link still reaches the studio (0316): the link names its
 * studio whether or not the offer is open; an offer past its valid_until is
 * no longer shown or claimable; and a friend's enquiry after the end becomes
 * a plain lead, marked so and credited to the client, with the owner's bell.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const A = 'f3160000-0000-4000-8000-00000000000a'
const UA = 'f3160000-0000-4000-8000-0000000000a1'
const CLIENT = 'f3160000-0000-4000-8000-0000000000c1'

let db: PGlite
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  // Safe to run twice.
  await db.exec(readFileSync(join(migDir, '0316_leads_paging_index_referral_fallback.sql'), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${UA}', 'a@re.test');
    insert into companies (id, name, display_name, owner_user_id, avatar_url) values ('${A}', 'Asha', 'Asha Studio', '${UA}', 'https://cdn.test/asha.png');
    insert into users (user_id, company_id, role, name, email) values ('${UA}', '${A}', 'super_admin', 'Asha', 'a@re.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${A}', 'Priya Sharma');
    insert into referral_campaigns (company_id, name, slug, status, client_id, friend_reward_type, friend_reward_value, friend_reward_title, valid_until) values
      ('${A}', 'Live', 'live-1', 'active', '${CLIENT}', 'fixed', 10000, '₹10,000 off', null),
      ('${A}', 'Past date', 'past-1', 'active', '${CLIENT}', 'fixed', 10000, '₹10,000 off', '2020-01-01'),
      ('${A}', 'Ended', 'ended-1', 'ended', null, 'none', 0, null, null),
      ('${A}', 'Paused', 'paused-1', 'paused', '${CLIENT}', 'none', 0, null, null);
  `)
})

const studio = (slug: string) =>
  one<{ s: { studio_name: string; logo_url: string | null; active: boolean } | null }>(`select get_public_referral_studio($1) as s`, [slug])

describe('0316: an ended referral link still reaches the studio', () => {
  it('names the studio and says whether the offer is open, and nothing private', async () => {
    expect((await studio('live-1')).s).toMatchObject({ studio_name: 'Asha Studio', logo_url: 'https://cdn.test/asha.png', active: true })
    for (const slug of ['past-1', 'ended-1', 'paused-1']) expect((await studio(slug)).s?.active).toBe(false)
    expect(Object.keys((await studio('past-1')).s!).sort()).toEqual(['active', 'campaign_id', 'logo_url', 'studio_name'])
    expect((await studio('never-was')).s).toBeNull()
  })

  it('no longer shows or takes an offer past its valid_until', async () => {
    expect((await one<{ c: unknown }>(`select get_public_referral_campaign('live-1') as c`)).c).not.toBeNull()
    expect((await one<{ c: unknown }>(`select get_public_referral_campaign('past-1') as c`)).c).toBeNull()
    const past = await one<{ id: string }>(`select id from referral_campaigns where slug = 'past-1'`)
    await expect(db.query(`select submit_referral(p_campaign_id => $1, p_client_name => 'Riya', p_client_phone => '9876500011')`, [past.id])).rejects.toThrow(/inactive/)
  })

  it('turns the enquiry into a lead marked offer-ended, credited to the client, and rings the owner', async () => {
    const r = await one<{ id: string }>(`select submit_ended_referral_enquiry('past-1', 'Riya Kapoor', '98765 00022', 'Wedding in Feb') as id`)
    const lead = await one<{ company_id: string; source: string; referred_by_name: string; notes: string; source_meta: { offer_ended: boolean } }>(
      `select company_id, source, referred_by_name, notes, source_meta from crm_leads where id = $1`,
      [r.id],
    )
    expect(lead).toMatchObject({ company_id: A, source: 'referral', referred_by_name: 'Priya Sharma' })
    expect(lead.source_meta.offer_ended).toBe(true)
    expect(lead.notes).toContain("Priya Sharma's referral link after the offer ended")
    expect(lead.notes).toContain('Wedding in Feb')
    const n = await one<{ n: number; recipient_uid: string; entity_id: string }>(
      `select count(*)::int as n, max(recipient_uid::text) as recipient_uid, max(entity_id::text) as entity_id from notifications where dedupe_key = $1`,
      [`referral_ended:${r.id}`],
    )
    expect(n).toEqual({ n: 1, recipient_uid: UA, entity_id: r.id })
    // Nothing was claimed, so no referral (and no reward) is recorded.
    expect((await one<{ n: number }>(`select count(*)::int as n from referral_submissions`)).n).toBe(0)
  })

  it('takes an enquiry on a link with no client, crediting nobody', async () => {
    const r = await one<{ id: string }>(`select submit_ended_referral_enquiry('ended-1', 'Neha', '9876500033') as id`)
    const lead = await one<{ referred_by_name: string | null; notes: string }>(`select referred_by_name, notes from crm_leads where id = $1`, [r.id])
    expect(lead.referred_by_name).toBeNull()
    expect(lead.notes).toBe('Came through a referral link after the offer ended (no offer applies)')
  })

  it('refuses an unknown link, a live offer, and a missing name or short phone', async () => {
    await expect(db.query(`select submit_ended_referral_enquiry('never-was', 'Riya', '9876500011')`)).rejects.toThrow(/not found/)
    await expect(db.query(`select submit_ended_referral_enquiry('live-1', 'Riya', '9876500011')`)).rejects.toThrow(/still active/)
    await expect(db.query(`select submit_ended_referral_enquiry('past-1', ' ', '9876500011')`)).rejects.toThrow(/required/)
    await expect(db.query(`select submit_ended_referral_enquiry('past-1', 'Riya', '12345')`)).rejects.toThrow(/required/)
  })

  it('is for the API alone: nobody signed in or out can call it directly', async () => {
    for (const role of ['anon', 'authenticated']) {
      const r = await one<{ studio: boolean; submit: boolean }>(
        `select has_function_privilege('${role}', 'get_public_referral_studio(text)', 'execute') as studio,
                has_function_privilege('${role}', 'submit_ended_referral_enquiry(text, text, text, text)', 'execute') as submit`,
      )
      expect(r).toEqual({ studio: false, submit: false })
    }
  })
})
