import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0282: a lead given to someone tells them, and moves the old person's open
 * follow-ups with it; a follow-up rings one bell -- its owner's -- in the 15
 * minutes before it is due.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e8200000-0000-4000-8000-000000000001'
const RAVI = 'e8200000-0000-4000-8000-000000000002'
const NEHA = 'e8200000-0000-4000-8000-000000000003'
const COMPANY = 'e8200000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
/** Act as someone for auth.uid(), still as the superuser for writes. */
const by = async (user: string | null) => db.exec(`set request.jwt.claim.sub = '${user ?? ''}';`)
const bell = (to: string, type: string) =>
  q<{ title: string; body: string | null; deep_link: string | null }>(
    `select title, body, deep_link from notifications where recipient_uid = $1 and type = $2 order by created_at`,
    [to, type],
  )
const newLead = async (name: string, assigned: string | null) =>
  (
    await q<{ id: string }>(
      `insert into crm_leads (company_id, name, phone, event_type, event_date, city, assigned_to)
       values ($1, $2, '9812300000', 'Wedding', '2027-02-14', 'Jaipur', $3) returning id`,
      [COMPANY, name, assigned],
    )
  )[0]!.id

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
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'asha@s.test'), ('${RAVI}', 'ravi@s.test'), ('${NEHA}', 'neha@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'asha@s.test'),
      ('${RAVI}', '${COMPANY}', 'employee', 'Ravi', 'ravi@s.test'),
      ('${NEHA}', '${COMPANY}', 'employee', 'Neha', 'neha@s.test');
  `)
})

describe('0282 lead assigned, follow-up alerts', () => {
  it('tells the person a lead is given to, never the one who gave it to themselves', async () => {
    await by(OWNER)
    const id = await newLead('Priya Sharma', RAVI)
    const [n] = await bell(RAVI, 'crm_assigned')
    expect(n!.title).toBe('New lead for you: Priya Sharma')
    expect(n!.body).toBe('Wedding · 14 Feb 2027 · Jaipur · from Asha')
    expect(n!.deep_link).toBe(`/follow-ups?lead=${id}`)

    await newLead('Own lead', OWNER)
    expect(await bell(OWNER, 'crm_assigned')).toEqual([])
  })

  it('says nothing for a lead that arrived by itself (the new-lead workflow does)', async () => {
    await by(null)
    await newLead('From the form', NEHA)
    expect(await bell(NEHA, 'crm_assigned')).toEqual([])
  })

  it("moves a lead with the old person's open follow-ups, and tells the new person", async () => {
    await by(OWNER)
    const id = await newLead('Kavya', RAVI)
    await q(
      `insert into crm_activities (company_id, lead_id, type, direction, subject, due_at, assigned_to, actor_id)
       values ($1, $2, 'task', 'none', 'Call', now() + interval '2 days', $3, $4)`,
      [COMPANY, id, RAVI, OWNER],
    )
    await q(`update crm_leads set assigned_to = $1 where id = $2`, [NEHA, id])
    const tasks = await q<{ assigned_to: string }>(`select assigned_to from crm_activities where lead_id = $1 and type = 'task'`, [id])
    expect(tasks.every((t) => t.assigned_to === NEHA)).toBe(true)
    expect((await bell(NEHA, 'crm_assigned')).map((n) => n.title)).toContain('New lead for you: Kavya')
  })

  it("rings only the follow-up's owner, once, in the 15 minutes before it is due", async () => {
    await by(OWNER)
    const lead = await newLead('Meera', RAVI)
    // Written by the owner, on Ravi's lead, for nobody in particular: it is Ravi's.
    const [t] = await q<{ id: string }>(
      `insert into crm_activities (company_id, lead_id, type, direction, subject, due_at, actor_id)
       values ($1, $2, 'task', 'none', 'Site visit', now() + interval '10 minutes', $3) returning id`,
      [COMPANY, lead, OWNER],
    )
    // Not yet: an hour away.
    await q(
      `insert into crm_activities (company_id, lead_id, type, direction, subject, due_at, actor_id)
       values ($1, $2, 'task', 'none', 'Call', now() + interval '1 hour', $3)`,
      [COMPANY, lead, OWNER],
    )
    await by(null)
    const [first] = await q<{ n: number }>(`select crm_follow_up_soon() as n`)
    expect(first!.n).toBe(1)
    const [again] = await q<{ n: number }>(`select crm_follow_up_soon() as n`)
    expect(again!.n).toBe(0)

    const [n] = await bell(RAVI, 'crm_follow_up_soon')
    expect(n!.title).toMatch(/^Site visit at \d{1,2}:\d{2} [ap]m: Meera$/)
    expect(n!.deep_link).toBe(`/follow-ups?lead=${lead}`)
    expect(await bell(OWNER, 'crm_follow_up_soon')).toEqual([])

    // Moved to a new time: it rings again for that time.
    await q(`update crm_activities set due_at = now() + interval '12 minutes' where id = $1`, [t!.id])
    const [moved] = await q<{ n: number }>(`select crm_follow_up_soon() as n`)
    expect(moved!.n).toBe(1)

    // Given to Neha by name: only Neha hears of it.
    await q(
      `insert into crm_activities (company_id, lead_id, type, direction, subject, due_at, actor_id, assigned_to)
       values ($1, $2, 'task', 'none', 'WhatsApp', now() + interval '5 minutes', $3, $4)`,
      [COMPANY, lead, OWNER, NEHA],
    )
    const before = (await bell(RAVI, 'crm_follow_up_soon')).length
    await q(`select crm_follow_up_soon()`)
    expect((await bell(NEHA, 'crm_follow_up_soon')).map((x) => x.title)[0]).toMatch(/^WhatsApp at /)
    expect((await bell(RAVI, 'crm_follow_up_soon')).length).toBe(before)
  })
})
