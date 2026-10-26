import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0286: whatever is made in the CRM and on the team side can be changed back
 * -- a booking undone, a quote revised, an acceptance reopened, a call's
 * outcome changed, "not duplicates" remembered and undone, a login turned off,
 * a leave decision reopened, an attendance fix taken back, a mark cleared.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e8286000-0000-4000-8000-000000000001'
const RAVI = 'e8286000-0000-4000-8000-000000000002'
const COMPANY = 'e8286000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const one = async <T>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0]!
const by = async (user: string | null) => db.exec(`set request.jwt.claim.sub = '${user ?? ''}';`)

let seq = 0
const newLead = async (name: string, phone?: string) =>
  (
    await one<{ id: string }>(
      `insert into crm_leads (company_id, name, phone, source) values ($1, $2, $3, 'instagram') returning id`,
      [COMPANY, name, phone ?? `98${400000 + ++seq}`],
    )
  ).id

const quoteFor = async (leadId: string, total: number) =>
  (
    await one<{ id: string; quote_number: string }>(
      `select * from create_quote($1::uuid, 'Wedding', null, 'Maharashtra', true, $2, 0, $2, 0, $2,
         $3::jsonb)`,
      [
        leadId,
        total,
        JSON.stringify([{ description: 'Full day', quantity: 1, rate: total, amount: total, gst_rate: 0, taxable: total, cgst: 0, sgst: 0, igst: 0 }]),
      ],
    )
  )

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
  // Safe to run twice.
  await db.exec(readFileSync(join(migDir, '0286_edit_and_undo_crm_team.sql'), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'asha@s.test'), ('${RAVI}', 'ravi@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'asha@s.test'),
      ('${RAVI}', '${COMPANY}', 'employee', 'Ravi', 'ravi@s.test');
  `)
  await by(OWNER)
})

describe('0286 undo a booking', () => {
  it('puts a booked lead back on the first open stage, keeps the project, and lets it be booked again', async () => {
    const id = await newLead('Priya')
    const made = await one<{ project_id: string }>(
      `select * from convert_lead_to_project($1::uuid, null, '{}'::jsonb, '{"name":"Priya wedding"}'::jsonb)`,
      [id],
    )
    await q(`select crm_unbook_lead($1::uuid)`, [id])
    const l = await one<{ status: string; converted_project_id: string | null; converted_client_id: string | null; kind: string }>(
      `select l.status, l.converted_project_id, l.converted_client_id, s.kind
         from crm_leads l join crm_pipeline_stages s on s.id = l.stage_id where l.id = $1`,
      [id],
    )
    expect(l.status).not.toBe('converted')
    expect(l.kind).toBe('open')
    expect(l.converted_project_id).toBeNull()
    expect(l.converted_client_id).toBeNull()
    expect((await q(`select 1 from projects where id = $1`, [made.project_id])).length).toBe(1)
    const ev = await one<{ note: string }>(
      `select note from crm_lead_events where lead_id = $1 and note like 'booking undone%'`,
      [id],
    )
    expect(ev.note).toBe('booking undone (project Priya wedding kept)')

    // 0149's guard reads the two columns, so a second booking is allowed.
    const again = await one<{ project_id: string }>(
      `select * from convert_lead_to_project($1::uuid, null, '{}'::jsonb, '{"name":"Priya again"}'::jsonb)`,
      [id],
    )
    expect(again.project_id).toBeTruthy()
  })

  it('refuses a lead that is not booked', async () => {
    const id = await newLead('Open lead')
    await expect(q(`select crm_unbook_lead($1::uuid)`, [id])).rejects.toThrow(/not booked/)
  })
})

describe('0286 quotes', () => {
  it('revises any quote into a new draft with the next number and the same lines', async () => {
    const id = await newLead('Kavya')
    const first = await quoteFor(id, 50000)
    await q(`update crm_quote_items set unit = 'sq ft', days = 2 where quote_id = $1`, [first.id])
    await q(`update crm_quotes set status = 'sent' where id = $1`, [first.id])
    const copy = await one<{ id: string; quote_number: string }>(`select * from duplicate_quote($1::uuid)`, [first.id])
    expect(copy.quote_number).not.toBe(first.quote_number)
    const row = await one<{ status: string; total: string }>(`select status, total from crm_quotes where id = $1`, [copy.id])
    expect(row.status).toBe('draft')
    expect(Number(row.total)).toBe(50000)
    const item = await one<{ description: string; unit: string; days: string }>(
      `select description, unit, days from crm_quote_items where quote_id = $1`,
      [copy.id],
    )
    expect(item).toMatchObject({ description: 'Full day', unit: 'sq ft' })
    expect(Number(item.days)).toBe(2)
  })

  it('reopening an accepted quote puts the deal value back', async () => {
    const id = await newLead('Meera')
    await q(`update crm_leads set deal_value = 40000 where id = $1`, [id])
    const quote = await quoteFor(id, 65000)
    await q(`update crm_quotes set status = 'sent' where id = $1`, [quote.id])
    await q(`select crm_set_quote_outcome($1::uuid, 'accepted')`, [quote.id])
    expect(Number((await one<{ deal_value: string }>(`select deal_value from crm_leads where id = $1`, [id])).deal_value)).toBe(65000)
    await q(`select crm_set_quote_outcome($1::uuid, 'sent')`, [quote.id])
    expect(Number((await one<{ deal_value: string }>(`select deal_value from crm_leads where id = $1`, [id])).deal_value)).toBe(40000)
  })

  it('leaves a value someone typed after the acceptance alone', async () => {
    const id = await newLead('Neel')
    await q(`update crm_leads set deal_value = 40000 where id = $1`, [id])
    const quote = await quoteFor(id, 65000)
    await q(`update crm_quotes set status = 'sent' where id = $1`, [quote.id])
    await q(`select crm_set_quote_outcome($1::uuid, 'accepted')`, [quote.id])
    await q(`update crm_leads set deal_value = 70000 where id = $1`, [id])
    await q(`select crm_set_quote_outcome($1::uuid, 'declined')`, [quote.id])
    expect(Number((await one<{ deal_value: string }>(`select deal_value from crm_leads where id = $1`, [id])).deal_value)).toBe(70000)
  })
})

describe('0286 calls', () => {
  const call = async (leadId: string, outcome: string, minutesAgo: number) =>
    (
      await one<{ id: string }>(
        `insert into crm_activities (company_id, lead_id, type, direction, outcome, started_at)
         values ($1, $2, 'call', 'out', $3, now() - ($4 || ' minutes')::interval) returning id`,
        [COMPANY, leadId, outcome, String(minutesAgo)],
      )
    ).id
  const state = (id: string) =>
    one<{ call_attempts: number; last_call_outcome: string | null; contacted_status: string }>(
      `select call_attempts, last_call_outcome, contacted_status from crm_leads where id = $1`,
      [id],
    )

  it('recounts when an outcome is changed', async () => {
    const id = await newLead('Rohan')
    await call(id, 'no_answer', 30)
    await call(id, 'no_answer', 20)
    const third = await call(id, 'no_answer', 10)
    expect(await state(id)).toMatchObject({ call_attempts: 3, contacted_status: 'unreachable' })
    await q(`update crm_activities set outcome = 'answered' where id = $1`, [third])
    expect(await state(id)).toMatchObject({ call_attempts: 0, last_call_outcome: 'answered', contacted_status: 'contacted' })
  })

  it('recounts when a call is deleted', async () => {
    const id = await newLead('Sana')
    await call(id, 'busy', 20)
    const wrong = await call(id, 'wrong_number', 10)
    expect((await state(id)).contacted_status).toBe('unreachable')
    await q(`delete from crm_activities where id = $1`, [wrong])
    expect(await state(id)).toMatchObject({ call_attempts: 1, last_call_outcome: 'busy', contacted_status: 'contacted' })
  })
})

describe('0286 not duplicates', () => {
  it('keeps a dismissed pair out of the groups until it is undone', async () => {
    const a = await newLead('Twin A', '9811100000')
    const b = await newLead('Twin B', '9811100000')
    const groups = async () => (await q<{ lead_ids: string[] }>(`select lead_ids from crm_duplicate_groups()`)).filter((g) => g.lead_ids.includes(a))
    expect(await groups()).toHaveLength(1)
    await q(`select resolve_crm_duplicates($1::uuid, array[$2]::uuid[], 'keep_separate')`, [a, b])
    expect(await groups()).toHaveLength(0)
    const listed = await q<{ name_a: string; name_b: string; matched_on: string }>(`select * from crm_duplicate_dismissed()`)
    expect(listed.some((r) => [r.name_a, r.name_b].sort().join() === 'Twin A,Twin B' && r.matched_on === 'phone')).toBe(true)
    await q(`select crm_undo_duplicate_dismissal($1::uuid, $2::uuid)`, [b, a])
    expect(await groups()).toHaveLength(1)
  })
})

describe('0286 turn a login off', () => {
  it('keeps the person on the team but out of the app', async () => {
    const count = async () => (await one<{ n: number }>(`select count(*)::int as n from list_login_profiles($1::uuid)`, [RAVI])).n
    expect(await count()).toBe(1)
    await q(`update users set sign_in_off = true where user_id = $1`, [RAVI])
    expect(await count()).toBe(0)
    await by(RAVI)
    expect(await q(`select * from get_auth_context()`)).toEqual([])
    await by(OWNER)
    await q(`update users set sign_in_off = false where user_id = $1`, [RAVI])
    expect(await count()).toBe(1)
  })
})

describe('0286 leave', () => {
  it('reopens a split approval as the one request that was asked for', async () => {
    const [orig] = await q<{ id: string }>(
      `insert into leave_requests (company_id, user_id, kind, start_date, end_date, status, decided_by, decided_at)
       values ($1, $2, 'casual', '2026-12-01', '2026-12-02', 'approved', $3, '2026-11-20 10:00+05:30') returning id`,
      [COMPANY, RAVI, OWNER],
    )
    await q(
      `insert into leave_requests (company_id, user_id, kind, start_date, end_date, status, decided_by, decided_at)
       values ($1, $2, 'unpaid', '2026-12-03', '2026-12-04', 'approved', $3, '2026-11-20 10:00+05:30')`,
      [COMPANY, RAVI, OWNER],
    )
    await q(`select reopen_leave($1::uuid, 'Wrong days')`, [orig!.id])
    const rows = await q<{ status: string; kind: string; end_date: string }>(
      `select status, kind, end_date::text from leave_requests where user_id = $1 and start_date >= '2026-12-01' order by start_date`,
      [RAVI],
    )
    expect(rows).toEqual([{ status: 'pending', kind: 'casual', end_date: '2026-12-04' }])
  })

  it('gives a request made unpaid its asked-for kind back', async () => {
    const [r] = await q<{ id: string }>(
      `insert into leave_requests (company_id, user_id, kind, start_date, end_date) values ($1, $2, 'sick', '2027-01-05', '2027-01-05') returning id`,
      [COMPANY, RAVI],
    )
    await q(`update leave_requests set status = 'approved', kind = 'unpaid', decided_at = now() where id = $1`, [r!.id])
    await q(`select reopen_leave($1::uuid)`, [r!.id])
    expect(await one(`select status, kind from leave_requests where id = $1`, [r!.id])).toEqual({ status: 'pending', kind: 'sick' })
  })

  it('lets whoever asked change the dates of a waiting request, never an answered one', async () => {
    await by(RAVI)
    const [r] = await q<{ id: string }>(`select request_leave('casual', '2027-02-10', '2027-02-11', false, 'Family') as id`)
    await q(`select update_leave_request($1::uuid, 'casual', '2027-02-12', '2027-02-13', false, 'Family function')`, [r!.id])
    expect(await one(`select start_date::text, end_date::text, reason from leave_requests where id = $1`, [r!.id])).toEqual({
      start_date: '2027-02-12',
      end_date: '2027-02-13',
      reason: 'Family function',
    })
    await by(OWNER)
    await q(`select decide_leave($1::uuid, true, null)`, [r!.id])
    await by(RAVI)
    await expect(q(`select update_leave_request($1::uuid, 'casual', '2027-02-14', '2027-02-14', false, null)`, [r!.id])).rejects.toThrow(
      /waiting request/,
    )
    await by(OWNER)
  })
})

describe('0286 attendance', () => {
  it('lets the person take back a waiting fix request', async () => {
    await by(RAVI)
    const [r] = await q<{ id: string }>(
      `select request_attendance_correction((now() at time zone 'Asia/Kolkata')::date - 1, now() - interval '1 day', null, 'Forgot to tap') as id`,
    )
    await q(`select cancel_attendance_correction($1::uuid)`, [r!.id])
    expect(await q(`select 1 from attendance_corrections where id = $1`, [r!.id])).toEqual([])
    await expect(q(`select cancel_attendance_correction($1::uuid)`, [r!.id])).rejects.toThrow(/already answered/)
    await by(OWNER)
  })

  it("clears a day's mark with 'none'", async () => {
    await q(`select set_attendance_manual($1::uuid, '2026-10-20', 'absent')`, [RAVI])
    expect(await q(`select 1 from attendance where user_id = $1 and a_date = '2026-10-20'`, [RAVI])).toHaveLength(1)
    await q(`select set_attendance_manual($1::uuid, '2026-10-20', 'none')`, [RAVI])
    expect(await q(`select 1 from attendance where user_id = $1 and a_date = '2026-10-20'`, [RAVI])).toEqual([])
  })
})
