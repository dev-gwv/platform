import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0205: each caller's day in numbers (India time), the owner's row per
 * caller, the cold-lead nudges that fire once, and the morning email's
 * "leads going cold" and "yesterday" facts.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a2000000-0000-4000-8000-000000000001'
const REP = 'a2000000-0000-4000-8000-000000000002'
const REP2 = 'a2000000-0000-4000-8000-000000000003'
const OTHER = 'a2000000-0000-4000-8000-000000000004'
const COMPANY = 'a2000000-0000-4000-8000-0000000000aa'
const COMPANY_B = 'a2000000-0000-4000-8000-0000000000bb'
// 2026-10-05 in India: 00:00 IST = 2026-10-04T18:30Z.
const DAY = '2026-10-05'
const AT = (t: string) => `'${t}'::timestamptz`

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
let n = 0
const lead = async (over: Record<string, string> = {}) => {
  n += 1
  const id = `b2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const cols = { id: `'${id}'`, company_id: `'${COMPANY}'`, name: `'Lead ${n}'`, phone: `'98765001${String(n).padStart(2, '0')}'`, assigned_to: `'${REP}'`, ...over }
  await db.exec(`insert into crm_leads (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`)
  return id
}
const act = (leadId: string, type: string, at: string, over: Record<string, string> = {}) => {
  const cols = { company_id: `'${COMPANY}'`, lead_id: `'${leadId}'`, type: `'${type}'`, direction: `'out'`, actor_id: `'${REP}'`, created_at: AT(at), ...over }
  return db.exec(`insert into crm_activities (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`)
}
const as = async <T>(user: string, sql: string) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await q<T>(sql)
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
  }
}
type Day = { calls_made: number; calls_answered: number; messages: number; follow_ups_done: number; leads_moved: number; quotes_sent: number; booked: number; leads_touched: number; overdue_left: number; due_today_left: number; lead_lines: Array<{ name: string; last_type: string; last_outcome: string | null; last_note: string | null }> }

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${REP}', 'r@s.test'), ('${REP2}', 'r2@s.test'), ('${OTHER}', 'x@o.test');
    update auth.users set email_verified = true;
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}'), ('${COMPANY_B}', 'Other', '${OTHER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'o@s.test', 'active'),
      ('${REP}', '${COMPANY}', 'employee', 'Ravi', 'r@s.test', 'active'),
      ('${REP2}', '${COMPANY}', 'employee', 'Meera', 'r2@s.test', 'active'),
      ('${OTHER}', '${COMPANY_B}', 'super_admin', 'Kiran', 'x@o.test', 'active');
    grant select on crm_leads to authenticated;
    grant usage on schema auth to authenticated;
  `)
})

beforeEach(async () => {
  await db.exec(`delete from notifications; delete from crm_quotes; delete from crm_activities; delete from crm_lead_events; delete from crm_leads; delete from morning_emails;`)
})

describe('crm_day_report', () => {
  it('counts what the caller did that day, in India time, and lists the leads worked', async () => {
    const a = await lead({ follow_up_at: AT('2026-10-04T10:00:00Z') })
    const b = await lead({ follow_up_at: AT('2026-10-05T10:00:00Z') })
    const c = await lead()
    await act(a, 'call', '2026-10-05T04:00:00Z', { outcome: `'answered'`, body: `'Wants a quote for December'` })
    await act(a, 'whatsapp', '2026-10-05T04:10:00Z')
    await act(b, 'call', '2026-10-05T09:00:00Z', { outcome: `'no_answer'` })
    await act(c, 'call', '2026-10-04T17:00:00Z', { outcome: `'answered'` }) // 22:30 IST the day before
    await act(c, 'call', '2026-10-05T18:40:00Z', { outcome: `'answered'` }) // 00:10 IST the day after
    await act(b, 'task', '2026-10-05T05:00:00Z', { done_at: AT('2026-10-05T06:00:00Z') })
    await db.exec(`insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, created_at)
                   values ('${COMPANY}', '${a}', 'new', 'contacted', '${REP}', ${AT('2026-10-05T04:01:00Z')})`)
    await db.exec(`insert into crm_quotes (company_id, lead_id, quote_number, title, status, sent_at, created_by, total)
                   values ('${COMPANY}', '${a}', 'Q-1', 'Wedding', 'sent', ${AT('2026-10-05T07:00:00Z')}, '${REP}', 100000)`)
    await db.exec(`update crm_leads set converted_at = ${AT('2026-10-05T08:00:00Z')} where id = '${b}'`)

    const [r] = await as<Day>(REP, `select * from crm_day_report('${REP}', '${DAY}')`)
    expect(r).toMatchObject({
      calls_made: 2, calls_answered: 1, messages: 1, follow_ups_done: 1, leads_moved: 1,
      quotes_sent: 1, booked: 1, leads_touched: 2, overdue_left: 1, due_today_left: 1,
    })
    expect(r!.lead_lines.map((l) => [l.name, l.last_type, l.last_outcome, l.last_note])).toEqual([
      ['Lead 2', 'call', 'no_answer', null],
      ['Lead 1', 'whatsapp', null, null],
    ])
  })

  it('is yours, or your studio’s if you run it', async () => {
    await lead()
    // Different query text from the owner's call on purpose: pglite replays
    // an identical statement's plan and the refusal would not be seen.
    expect((await as<Day>(OWNER, `select calls_made from crm_day_report('${REP}', '${DAY}') as o`))[0]!.calls_made).toBe(0)
    await expect(as(REP2, `select * from crm_day_report('${REP}', '${DAY}')`)).rejects.toThrow(/forbidden/)
    await expect(as(OTHER, `select * from crm_day_report('${REP}', '${DAY}')`)).rejects.toThrow(/forbidden/)
    await expect(as(REP, `select * from crm_day_report_team('${DAY}')`)).rejects.toThrow(/forbidden/)
  })

  it('the team view has one row per person with open leads or work today, busiest first', async () => {
    const a = await lead()
    await lead({ assigned_to: `'${REP2}'` })
    await act(a, 'call', '2026-10-05T04:00:00Z', { outcome: `'answered'` })
    const rows = await as<{ user_name: string; calls_made: number }>(OWNER, `select user_name, calls_made from crm_day_report_team('${DAY}')`)
    expect(rows).toEqual([{ user_name: 'Ravi', calls_made: 1 }, { user_name: 'Meera', calls_made: 0 }])
  })
})

describe('crm_cold_sweep', () => {
  it('nudges the owner of a lead nobody has called in two hours, once', async () => {
    const waited = await lead({ created_at: `now() - interval '3 hours'`, source: `'facebook'` })
    await lead({ created_at: `now() - interval '1 hour'` }) // not yet
    const called = await lead({ created_at: `now() - interval '3 hours'` })
    await act(called, 'call', new Date().toISOString(), { outcome: `'no_answer'` })
    await lead({ created_at: `now() - interval '9 days'` }) // too old to nudge
    const s = (await q<{ s: { uncalled: number; unassigned: number } }>(`select crm_cold_sweep() as s`))[0]!.s
    expect(s).toMatchObject({ uncalled: 1, unassigned: 0 })
    const notes = await q<{ recipient_uid: string; title: string; body: string; entity_id: string }>(
      `select recipient_uid, title, body, entity_id from notifications where type = 'crm_cold'`,
    )
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ recipient_uid: REP, entity_id: waited, title: expect.stringMatching(/^Lead \d+ has waited 2 hours for a call$/) })
    expect(notes[0]!.body).toContain('from facebook')
    expect((await q<{ s: { uncalled: number } }>(`select crm_cold_sweep() as s`))[0]!.s.uncalled).toBe(0)
  })

  it('tells the studio owner about a lead nobody is on after an hour, once', async () => {
    const id = await lead({ assigned_to: 'null', created_at: `now() - interval '2 hours'` })
    await lead({ assigned_to: 'null', created_at: `now() - interval '10 minutes'` })
    const s = (await q<{ s: { unassigned: number } }>(`select crm_cold_sweep() as s`))[0]!.s
    expect(s.unassigned).toBe(1)
    const notes = await q<{ recipient_uid: string; entity_id: string; title: string }>(`select recipient_uid, entity_id, title from notifications where type = 'crm_cold'`)
    expect(notes).toEqual([{ recipient_uid: OWNER, entity_id: id, title: expect.stringMatching(/has nobody on it$/) }])
    expect((await q<{ s: { unassigned: number } }>(`select crm_cold_sweep() as s`))[0]!.s.unassigned).toBe(0)
  })

  it('runs inside the CRM cron', async () => {
    await lead({ created_at: `now() - interval '3 hours'` })
    const s = (await q<{ s: { cold: { uncalled: number } } }>(`select run_crm_followup_cron() as s`))[0]!.s
    expect(s.cold.uncalled).toBe(1)
  })
})

describe('the morning email', () => {
  it('says how many leads are going cold, and what each caller did yesterday', async () => {
    const at = AT('2026-10-05T03:00:00Z') // 08:30 IST
    const old = await lead({ created_at: AT('2026-10-01T05:00:00Z') }) // never called, 4 days
    await lead({ created_at: AT('2026-10-04T20:00:00Z') }) // never called but not a day old yet
    const quoted = await lead({ created_at: AT('2026-09-20T05:00:00Z'), last_contacted_at: AT('2026-09-20T06:00:00Z'), status: `'contacted'` })
    await db.exec(`insert into crm_quotes (company_id, lead_id, quote_number, title, status, sent_at, created_by, total)
                   values ('${COMPANY}', '${quoted}', 'Q-2', 'Wedding', 'sent', ${AT('2026-09-30T07:00:00Z')}, '${REP}', 100000)`)
    const stuck = await lead({ created_at: AT('2026-09-01T05:00:00Z'), last_contacted_at: AT('2026-09-01T06:00:00Z'), status: `'contacted'` })
    await db.exec(`update crm_leads set stage_changed_at = ${AT('2026-09-25T05:00:00Z')} where id in ('${stuck}', '${quoted}')`)
    // Yesterday, 4 Oct IST: Ravi made two calls, one answered.
    await act(old, 'call', '2026-10-04T05:00:00Z', { outcome: `'answered'` })
    await act(old, 'call', '2026-10-04T06:00:00Z', { outcome: `'busy'` })
    await db.exec(`update crm_leads set last_contacted_at = null, last_call_at = null where id = '${old}'`)

    const rows = await q<{ user_id: string; cold_uncalled: number; cold_oldest_days: number; cold_quiet_quotes: number; cold_stuck: number; yesterday: Array<{ name: string; calls: number; answered: number }> }>(
      `select * from morning_email_due(${at}) where company_id = '${COMPANY}' order by user_id`,
    )
    expect(rows.map((r) => r.user_id)).toEqual([OWNER])
    expect(rows[0]).toMatchObject({ cold_uncalled: 1, cold_oldest_days: 3, cold_quiet_quotes: 1, cold_stuck: 2 })
    expect(rows[0]!.yesterday).toEqual([{ name: 'Ravi', calls: 2, answered: 1, quotes: 0, booked: 0 }])
  })
})
