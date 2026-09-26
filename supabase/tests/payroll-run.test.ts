import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { computePayrollLine, payableDates, payWindow, unpaidLeaveDays, workingDates } from '../../packages/domain/src/payroll'

/**
 * Monthly payroll run (0185): generate a month from attendance and leave,
 * type a bonus or an advance, approve (locks it), mark paid (writes the
 * salaries ledger and tells the member). A member sees only their own line,
 * and only after approval. The database's sums match packages/domain.
 *
 * Pro-rata (0188): someone who joins or leaves during the month is paid for
 * the working days in between, and only those days' absences are cut.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'd0000000-0000-4000-8000-000000000001'
const PRIYA = 'd0000000-0000-4000-8000-000000000002'
const AMAN = 'd0000000-0000-4000-8000-000000000003'
const NEHA = 'd0000000-0000-4000-8000-000000000004'
const COMPANY = 'd0000000-0000-4000-8000-0000000000aa'
const OTHER_CO = 'd0000000-0000-4000-8000-0000000000bb'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const fails = async (sql: string) => {
  try {
    await db.query(sql)
  } catch (e) {
    return (e as Error).message
  }
  return null
}
/** Run as a signed-in member, under RLS. */
async function asUser<T>(uid: string, sql: string) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`)
  try {
    return (await db.query<T>(sql)).rows
  } finally {
    await db.exec(`reset role;`)
  }
}

let runId = ''
const line = async (uid: string) =>
  (await q<Record<string, string | number | boolean | null>>(`select * from payroll_lines where run_id = '${runId}' and user_id = '${uid}'`))[0]!

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@p.test'), ('${PRIYA}', 'p@p.test'), ('${AMAN}', 'a@p.test'), ('${NEHA}', 'n@p.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER_CO}', 'Other', null);
    insert into users (user_id, company_id, role, name, email, created_at, salary, engagement_type, stipend_amount) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@p.test', '2020-01-01', 90000, 'in_house', null),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@p.test', '2020-01-01', 30000, 'in_house', null),
      ('${AMAN}', '${COMPANY}', 'employee', 'Aman', 'a@p.test', '2020-01-01', 20000, 'freelancer', null),
      ('${NEHA}', '${COMPANY}', 'employee', 'Neha', 'n@p.test', '2020-01-01', null, null, 10000);
    insert into attendance_policy (company_id, weekly_off) values ('${COMPANY}', '{0}');
    insert into company_holidays (company_id, holiday_date, name) values ('${COMPANY}', '2026-09-14', 'Studio day');
    -- Priya: 2 days + a half day unpaid leave, one absence, one late, and a
    -- sick day that the sweep had marked absent (leave wins: not absent).
    insert into leave_requests (company_id, user_id, kind, start_date, end_date, half_day, status) values
      ('${COMPANY}', '${PRIYA}', 'unpaid', '2026-09-02', '2026-09-03', false, 'approved'),
      ('${COMPANY}', '${PRIYA}', 'unpaid', '2026-09-10', '2026-09-10', true, 'approved'),
      ('${COMPANY}', '${PRIYA}', 'sick', '2026-09-21', '2026-09-21', false, 'approved'),
      ('${COMPANY}', '${PRIYA}', 'unpaid', '2026-09-24', '2026-09-24', false, 'pending');
    insert into attendance (company_id, user_id, a_date, status, late_minutes) values
      ('${COMPANY}', '${PRIYA}', '2026-09-15', 'absent', 0),
      ('${COMPANY}', '${PRIYA}', '2026-09-16', 'late', 25),
      ('${COMPANY}', '${PRIYA}', '2026-09-17', 'present', 0),
      ('${COMPANY}', '${PRIYA}', '2026-09-21', 'absent', 0),
      ('${COMPANY}', '${PRIYA}', '2026-09-13', 'absent', 0);
  `)
})

describe('generate', () => {
  it('makes one line per in-house member on a monthly salary or stipend, counted from attendance and leave', async () => {
    ;[{ id: runId }] = (await q<{ id: string }>(`select payroll_generate('${COMPANY}', 2026, 9, '${OWNER}') as id`)) as [{ id: string }]
    const people = await q<{ user_id: string }>(`select user_id from payroll_lines where run_id = '${runId}' order by user_id`)
    // Not the owner, not the freelancer.
    expect(people.map((p) => p.user_id)).toEqual([PRIYA, NEHA])

    const p = await line(PRIYA)
    expect({
      working: p.working_days, present: p.days_present, unpaid: Number(p.unpaid_leave_days), absent: p.absent_days, late: p.late_marks,
    }).toEqual({ working: 25, present: 2, unpaid: 2.5, absent: 1, late: 1 })
    // 30000 / 25 × 3.5 = 4200
    expect(Number(p.deduction)).toBe(4200)
    expect(Number(p.net_pay)).toBe(25800)

    // The screen's arithmetic agrees with the database's.
    const working = workingDates(2026, 9, [0], ['2026-09-14'])
    const unpaid = unpaidLeaveDays(
      [
        { start_date: '2026-09-02', end_date: '2026-09-03', half_day: false },
        { start_date: '2026-09-10', end_date: '2026-09-10', half_day: true },
      ],
      working,
    )
    expect(computePayrollLine({ base: 30000, workingDays: working.length, unpaidLeaveDays: unpaid, absentDays: 1 })).toEqual({ prorated: 30000, deduction: 4200, net: 25800 })
    // Here all month (0188): paid for every working day, exactly as before.
    const pp = (await q<{ ps: string; pe: string; payable_days: number; prorated_base: string }>(
      `select period_start::text as ps, period_end::text as pe, payable_days, prorated_base from payroll_lines where id = '${p.id}'`))[0]
    expect(pp).toEqual({ ps: '2026-09-01', pe: '2026-09-30', payable_days: 25, prorated_base: '30000.00' })

    const n = await line(NEHA)
    expect([Number(n.base_amount), Number(n.deduction), Number(n.net_pay)]).toEqual([10000, 0, 10000])
    const [run] = await q<{ total_net: string; people: number; status: string }>(`select total_net, people, status from payroll_runs where id = '${runId}'`)
    expect(run).toEqual({ total_net: '35800.00', people: 2, status: 'draft' })
  })

  it('keeps a bonus and an advance (with notes) when the draft is generated again', async () => {
    const p = await line(PRIYA)
    expect(await fails(`select payroll_set_adjustments('${COMPANY}', '${p.id}', 2000, '', 0, null)`)).toMatch(/say what the addition/)
    expect(await fails(`select payroll_set_adjustments('${OTHER_CO}', '${p.id}', 2000, 'Bonus', 0, null)`)).toMatch(/not found/)
    await q(`select payroll_set_adjustments('${COMPANY}', '${p.id}', 2000, 'Wedding season bonus', 5000, 'Advance in August')`)
    expect(Number((await line(PRIYA)).net_pay)).toBe(22800)

    // Another absence turns up; generating again recounts, keeps the notes.
    await q(`insert into attendance (company_id, user_id, a_date, status, late_minutes) values ('${COMPANY}', '${PRIYA}', '2026-09-18', 'absent', 0)`)
    await q(`select payroll_generate('${COMPANY}', 2026, 9, '${OWNER}')`)
    const again = await line(PRIYA)
    expect([again.absent_days, Number(again.deduction), Number(again.additions), again.additions_note, Number(again.net_pay)]).toEqual([
      2, 5400, 2000, 'Wedding season bonus', 21600,
    ])
  })

  it('is only callable by the API (service role), never by a signed-in user', async () => {
    for (const fn of [
      `payroll_generate('${COMPANY}', 2026, 9, '${OWNER}')`,
      `payroll_approve('${COMPANY}', '${runId}', '${OWNER}')`,
      `payroll_mark_paid('${COMPANY}', '${runId}', null, '${OWNER}', null, null)`,
    ]) {
      const denied = await asUser(OWNER, `select ${fn}`).catch((e: Error) => e.message)
      expect(denied).toMatch(/permission denied/)
    }
  })
})

describe('who sees what', () => {
  it('a member sees nothing before approval; the owner sees the whole month', async () => {
    expect(await asUser(PRIYA, `select id from payroll_lines`)).toHaveLength(0)
    expect(await asUser(OWNER, `select id from payroll_lines`)).toHaveLength(2)
    expect(await asUser(OWNER, `select id from payroll_runs`)).toHaveLength(1)
  })

  it('after approval a member sees their own line only, and never the run totals', async () => {
    await q(`select payroll_approve('${COMPANY}', '${runId}', '${OWNER}')`)
    const mine = await asUser<{ user_id: string }>(PRIYA, `select user_id from payroll_lines`)
    expect(mine.map((m) => m.user_id)).toEqual([PRIYA])
    expect(await asUser(PRIYA, `select id from payroll_runs`)).toHaveLength(0)
    expect(await asUser(PRIYA, `update payroll_lines set net_pay = 99999 returning id`).catch((e: Error) => e.message)).toMatch(/permission denied/)
  })
})

describe('approve and pay', () => {
  it('locks an approved month: no regenerate, no edits, no second approve', async () => {
    const p = await line(PRIYA)
    expect(await fails(`select payroll_generate('${COMPANY}', 2026, 9, '${OWNER}')`)).toMatch(/locked/)
    expect(await fails(`select payroll_set_adjustments('${COMPANY}', '${p.id}', 0, null, 0, null)`)).toMatch(/locked/)
    expect(await fails(`select payroll_approve('${COMPANY}', '${runId}', '${OWNER}')`)).toMatch(/already approved/)
    // Approval puts what is owed into the salaries ledger, unpaid.
    const [ms] = await q<{ base_amount: string; paid_amount: string; status: string }>(
      `select base_amount, paid_amount, status from monthly_salaries where user_id = '${PRIYA}' and pay_year = 2026 and pay_month = 9`)
    expect(ms).toEqual({ base_amount: '21600.00', paid_amount: '0.00', status: 'unpaid' })
  })

  it('marks one person paid: the ledger says paid and the member is told', async () => {
    const p = await line(PRIYA)
    const paid = await q<{ line_id: string; net_pay: string }>(`select * from payroll_mark_paid('${COMPANY}', '${runId}', '${p.id}', '${OWNER}', 'UPI', 'UTR123')`)
    expect(paid).toHaveLength(1)
    expect(await fails(`select * from payroll_mark_paid('${COMPANY}', '${runId}', '${p.id}', '${OWNER}', 'UPI', null)`)).toMatch(/already marked paid/)
    const after = await line(PRIYA)
    expect([Number(after.paid_amount), after.payment_mode, after.payment_reference, after.paid_at !== null]).toEqual([21600, 'UPI', 'UTR123', true])
    const [ms] = await q<{ paid_amount: string; status: string; net: string }>(
      `select paid_amount, status, net from monthly_salaries where user_id = '${PRIYA}' and pay_year = 2026 and pay_month = 9`)
    expect(ms).toEqual({ paid_amount: '21600.00', status: 'paid', net: '21600.00' })
    const told = await q<{ title: string; deep_link: string }>(`select title, deep_link from notifications where recipient_uid = '${PRIYA}' and type = 'payroll.payslip'`)
    expect(told).toEqual([{ title: 'Payslip for September 2026 is ready', deep_link: `/payroll/payslip/${p.id}` }])
    expect((await q<{ status: string }>(`select status from payroll_runs where id = '${runId}'`))[0]!.status).toBe('approved')
  })

  it('marks everyone left paid at once, and the month is paid', async () => {
    const rest = await q<{ user_id: string }>(`select user_id from payroll_mark_paid('${COMPANY}', '${runId}', null, '${OWNER}', 'Bank transfer', null)`)
    expect(rest.map((r) => r.user_id)).toEqual([NEHA])
    const [run] = await q<{ status: string; total_paid: string; paid: boolean }>(`select status, total_paid, paid_at is not null as paid from payroll_runs where id = '${runId}'`)
    expect(run).toEqual({ status: 'paid', total_paid: '31600.00', paid: true })
  })

  it('refuses to pay a draft, and a run of another studio', async () => {
    const [{ id }] = (await q<{ id: string }>(`select payroll_generate('${COMPANY}', 2026, 8, '${OWNER}') as id`)) as [{ id: string }]
    expect(await fails(`select * from payroll_mark_paid('${COMPANY}', '${id}', null, '${OWNER}', 'UPI', null)`)).toMatch(/approve the month/)
    expect(await fails(`select payroll_approve('${OTHER_CO}', '${id}', '${OWNER}')`)).toMatch(/not found/)
  })
})

describe('pro-rata: joining and leaving during the month (0188)', () => {
  const CO3 = 'd0000000-0000-4000-8000-0000000000cc'
  const BOSS = 'd0000000-0000-4000-8000-000000000010'
  const RAVI = 'd0000000-0000-4000-8000-000000000011' // joined 12 Sep (profile)
  const MEERA = 'd0000000-0000-4000-8000-000000000012' // pay ends 20 Sep, removed 25 Sep
  const KIRAN = 'd0000000-0000-4000-8000-000000000013' // removed in August
  const ANU = 'd0000000-0000-4000-8000-000000000014' // joins in October
  const SAM = 'd0000000-0000-4000-8000-000000000015' // added late on 16 Sep UTC = 17 Sep India
  const TARA = 'd0000000-0000-4000-8000-000000000016' // pay starts 29 Sep
  const FULL = 'd0000000-0000-4000-8000-000000000017' // here all month
  let run3 = ''
  const l3 = async (uid: string) =>
    (await q<Record<string, string | number | null>>(`select *, period_start::text as ps, period_end::text as pe from payroll_lines where run_id = '${run3}' and user_id = '${uid}'`))[0]

  beforeAll(async () => {
    await db.exec(`
      insert into auth.users (id, email) values
        ('${BOSS}', 'b@p3.test'), ('${RAVI}', 'r@p3.test'), ('${MEERA}', 'm@p3.test'), ('${KIRAN}', 'k@p3.test'),
        ('${ANU}', 'an@p3.test'), ('${SAM}', 's@p3.test'), ('${TARA}', 't@p3.test'), ('${FULL}', 'f@p3.test');
      insert into companies (id, name, owner_user_id) values ('${CO3}', 'Studio 3', '${BOSS}');
      insert into users (user_id, company_id, role, name, email, created_at, salary, engagement_type, status, deleted_at, pay_effective_from, pay_effective_to) values
        ('${BOSS}', '${CO3}', 'super_admin', 'Boss', 'b@p3.test', '2020-01-01', null, 'in_house', 'active', null, null, null),
        ('${RAVI}', '${CO3}', 'employee', 'Ravi', 'r@p3.test', '2020-01-01', 25000, 'in_house', 'active', null, null, null),
        ('${MEERA}', '${CO3}', 'employee', 'Meera', 'm@p3.test', '2020-01-01', 25000, 'in_house', 'inactive', '2026-09-25T10:00:00+05:30', null, '2026-09-20'),
        ('${KIRAN}', '${CO3}', 'employee', 'Kiran', 'k@p3.test', '2020-01-01', 25000, 'in_house', 'inactive', '2026-08-20T10:00:00+05:30', null, null),
        ('${ANU}', '${CO3}', 'employee', 'Anu', 'an@p3.test', '2020-01-01', 25000, 'in_house', 'active', null, null, null),
        ('${SAM}', '${CO3}', 'employee', 'Sam', 's@p3.test', '2026-09-16T20:00:00Z', 25000, 'in_house', 'active', null, null, null),
        ('${TARA}', '${CO3}', 'employee', 'Tara', 't@p3.test', '2020-01-01', 25000, 'in_house', 'active', null, '2026-09-29', null),
        ('${FULL}', '${CO3}', 'employee', 'Full', 'f@p3.test', '2020-01-01', 25000.5, 'in_house', 'active', null, null, null);
      insert into member_profiles (user_id, company_id, joined_on) values
        ('${RAVI}', '${CO3}', '2026-09-12'), ('${ANU}', '${CO3}', '2026-10-03'), ('${FULL}', '${CO3}', '2019-06-01');
      insert into attendance_policy (company_id, weekly_off) values ('${CO3}', '{0}');
      insert into company_holidays (company_id, holiday_date, name) values ('${CO3}', '2026-09-14', 'Studio day');
      -- Ravi: an absence before he joined (not his), one after; unpaid leave 10-12 Sep (only the 12th is his).
      insert into attendance (company_id, user_id, a_date, status, late_minutes) values
        ('${CO3}', '${RAVI}', '2026-09-05', 'absent', 0),
        ('${CO3}', '${RAVI}', '2026-09-15', 'absent', 0),
        ('${CO3}', '${MEERA}', '2026-09-22', 'absent', 0),
        ('${CO3}', '${FULL}', '2026-09-15', 'absent', 0);
      insert into leave_requests (company_id, user_id, kind, start_date, end_date, half_day, status) values
        ('${CO3}', '${RAVI}', 'unpaid', '2026-09-10', '2026-09-12', false, 'approved');
    `)
    ;[{ id: run3 }] = (await q<{ id: string }>(`select payroll_generate('${CO3}', 2026, 9, '${BOSS}') as id`)) as [{ id: string }]
  })

  it('pays only the people who were here during the month', async () => {
    const people = await q<{ name: string }>(`select u.name from payroll_lines l join users u using (user_id) where l.run_id = '${run3}' order by u.name`)
    // Not Kiran (left in August), not Anu (joins in October).
    expect(people.map((p) => p.name)).toEqual(['Full', 'Meera', 'Ravi', 'Sam', 'Tara'])
  })

  it('pays a joiner for the working days since they joined, and cuts only their own days', async () => {
    // 25 working days (Sundays and the 14th off). Ravi: 12-30 Sep = 15 working days.
    const r = (await l3(RAVI))!
    expect([r.ps, r.pe, r.working_days, r.payable_days, Number(r.base_amount), Number(r.prorated_base)]).toEqual([
      '2026-09-12', '2026-09-30', 25, 15, 25000, 15000,
    ])
    // Cut: the 15th absent + the 12th unpaid = 2 days × 1000.
    expect([Number(r.unpaid_leave_days), r.absent_days, Number(r.deduction), Number(r.net_pay)]).toEqual([1, 1, 2000, 13000])

    // The screen's arithmetic agrees.
    const working = workingDates(2026, 9, [0], ['2026-09-14'])
    const payable = payableDates(working, payWindow(2026, 9, '2026-09-12', null)!)
    const unpaid = unpaidLeaveDays([{ start_date: '2026-09-10', end_date: '2026-09-12', half_day: false }], payable)
    expect(computePayrollLine({ base: 25000, workingDays: working.length, payableDays: payable.length, unpaidLeaveDays: unpaid, absentDays: 1 })).toEqual({
      prorated: 15000,
      deduction: 2000,
      net: 13000,
    })
  })

  it('pays a leaver up to their last day, even once removed; an absence after leaving is not theirs', async () => {
    // 1-20 Sep = 16 working days.
    const m = (await l3(MEERA))!
    expect([m.ps, m.pe, m.payable_days, Number(m.prorated_base), m.absent_days, Number(m.net_pay)]).toEqual(['2026-09-01', '2026-09-20', 16, 16000, 0, 16000])
  })

  it('uses the owner’s pay start date; with no date at all, a full month (never the day they were added)', async () => {
    // Sam was added to the app on 17 Sep with no join date: the studio's own
    // staff onboarded mid-month are not docked for the days before signing up.
    const s = (await l3(SAM))!
    expect([s.ps, s.payable_days, Number(s.prorated_base)]).toEqual(['2026-09-01', 25, 25000])
    const t = (await l3(TARA))!
    expect([t.ps, t.payable_days, Number(t.prorated_base)]).toEqual(['2026-09-29', 2, 2000])
  })

  it('changes nothing for someone here all month (paise and all)', async () => {
    const f = (await l3(FULL))!
    expect([f.ps, f.pe, f.payable_days, f.working_days, Number(f.base_amount), Number(f.prorated_base), Number(f.deduction), Number(f.net_pay)]).toEqual([
      '2026-09-01', '2026-09-30', 25, 25, 25000.5, 25000.5, 1000, 24000.5,
    ])
    const [run] = await q<{ total_base: string; total_net: string }>(`select total_base, total_net from payroll_runs where id = '${run3}'`)
    // The run's salary total is what is actually earned: 25000.5 + 16000 + 15000 + 25000 (Sam: no date, full month) + 2000.
    expect(run).toEqual({ total_base: '83000.50', total_net: '80000.50' })
  })

  it('recounts on a new joining date and keeps the bonus; approval writes the earned salary to the ledger', async () => {
    const r = (await l3(RAVI))!
    await q(`select payroll_set_adjustments('${CO3}', '${r.id}', 500, 'Joining bonus', 0, null)`)
    // Net starts from the pro-rated salary, not the full one.
    expect(Number((await l3(RAVI))!.net_pay)).toBe(13500)

    await q(`update member_profiles set joined_on = '2026-09-19' where user_id = '${RAVI}'`)
    await q(`select payroll_generate('${CO3}', 2026, 9, '${BOSS}')`)
    // 19-30 Sep = 10 working days; the absence and the leave are before he joined now.
    const again = (await l3(RAVI))!
    expect([again.ps, again.payable_days, Number(again.prorated_base), Number(again.deduction), Number(again.additions), again.additions_note, Number(again.net_pay)]).toEqual([
      '2026-09-19', 10, 10000, 0, 500, 'Joining bonus', 10500,
    ])

    await q(`select payroll_approve('${CO3}', '${run3}', '${BOSS}')`)
    const [ms] = await q<{ gross: string; deductions: string; net: string }>(
      `select gross, deductions, net from monthly_salaries where user_id = '${RAVI}' and pay_year = 2026 and pay_month = 9`)
    expect(ms).toEqual({ gross: '10500.00', deductions: '0.00', net: '10500.00' })
    // Approved: locked, a new joining date changes nothing.
    await q(`update member_profiles set joined_on = '2026-09-01' where user_id = '${RAVI}'`)
    expect(await fails(`select payroll_generate('${CO3}', 2026, 9, '${BOSS}')`)).toMatch(/locked/)
    expect(Number((await l3(RAVI))!.prorated_base)).toBe(10000)
  })

  it('pays someone removed in August for their August days only', async () => {
    const [{ id }] = (await q<{ id: string }>(`select payroll_generate('${CO3}', 2026, 8, '${BOSS}') as id`)) as [{ id: string }]
    const k = (await q<{ pe: string; payable_days: number }>(`select period_end::text as pe, payable_days from payroll_lines where run_id = '${id}' and user_id = '${KIRAN}'`))[0]
    // August 2026, Sundays off: 26 working days; 1-20 Aug has 17.
    expect(k).toEqual({ pe: '2026-08-20', payable_days: 17 })
  })
})
