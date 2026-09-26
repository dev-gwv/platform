import { Hono, type Context } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  generatePayrollRequest,
  markPayrollPaidRequest,
  markPayrollPaidResponse,
  payrollExportRow,
  payrollMonth,
  payslip,
  payslipSummary,
  updatePayrollLineRequest,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/**
 * Monthly payroll run (0185): one screen to pay everyone this month.
 *
 * Who may do what:
 *   - see the month: the owner, or anyone with the Team Salaries module;
 *   - generate, edit, approve, pay, export: the owner, or Team Salaries edit;
 *   - a member: their own payslips, once the month is approved.
 *
 * Module access lives here, not in the database, so the month is read and
 * written through the service role AFTER these checks, always scoped to the
 * caller's own studio -- the same path a salaries delegate already takes. A
 * member's own payslips are read under RLS, which shows them only their own
 * released lines.
 *
 * The audit trail records amounts, never account numbers.
 */

const DENIED = 'You do not have access to payroll.'

const canView = (c: Context<AppEnv>) => {
  const a = c.get('auth')
  return a.isOwner || a.access.hasModule('team_salaries')
}
const canEdit = (c: Context<AppEnv>) => {
  const a = c.get('auth')
  return a.isOwner || a.access.hasAction('team_salaries', 'edit')
}

async function viewGate(c: Context<AppEnv>, next: () => Promise<void>) {
  if (!canView(c)) fail(403, DENIED)
  await next()
}
async function editGate(c: Context<AppEnv>, next: () => Promise<void>) {
  if (!canEdit(c)) fail(403, 'Only the owner, or someone who edits team salaries, can change payroll.')
  await next()
}

/** The database's own words for a refused step ("this month is approved and locked"). */
function explain(code: string, err: unknown): undefined {
  const msg = String((err as { message?: string })?.message ?? '')
  const sentence = msg ? `${msg[0]!.toUpperCase()}${msg.slice(1)}.` : ''
  if (code === 'P0002') fail(404, sentence || 'Not found.')
  if (code === '22023' && msg) fail(422, sentence)
  return undefined
}

const LINE_COLUMNS = (sql: TransactionSql) => sql`
  l.id, l.user_id, coalesce(u.name, 'Team member') as name, l.base_amount, l.working_days,
  to_char(l.period_start, 'YYYY-MM-DD') as period_start, to_char(l.period_end, 'YYYY-MM-DD') as period_end,
  l.payable_days, l.prorated_base, l.days_present,
  l.unpaid_leave_days::float8 as unpaid_leave_days, l.absent_days, l.late_marks, l.deduction,
  l.additions, l.additions_note, l.other_deductions, l.other_deductions_note, l.net_pay,
  l.paid_amount, l.paid_at, l.payment_mode, l.payment_reference`

const monthQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})

async function runOf(c: Context<AppEnv>, id: string) {
  const rows = await attempt(c, 'payroll.run_of', () =>
    withService(c.env, (sql) => sql<{ id: string; pay_year: number; pay_month: number; status: string }[]>`
      select id, pay_year, pay_month, status from payroll_runs where id = ${id} and company_id = ${c.get('auth').companyId}`),
  )
  if (!rows) fail(400, 'We could not load that payroll.')
  if (!rows[0]) fail(404, 'That payroll was not found.')
  return rows[0]
}

export const payrollRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // The month: the run (if generated), every line, and shoot payouts still owed.
  .get('/runs', viewGate, async (c) => {
    const parsed = monthQuery.safeParse({ year: c.req.query('year'), month: c.req.query('month') })
    if (!parsed.success) fail(422, 'Pick a month.')
    const { year, month } = parsed.data
    const auth = c.get('auth')
    const seePayouts = auth.isOwner || auth.access.hasModule('team_payouts')
    const data = await attempt(c, 'payroll.month', () =>
      withService(c.env, async (sql) => {
        const [run] = await sql`
          select r.id, r.pay_year, r.pay_month, r.status, r.total_base, r.total_deductions, r.total_additions,
                 r.total_net, r.total_paid, r.people, r.generated_at, r.approved_at, a.name as approved_by_name, r.paid_at
            from payroll_runs r
            left join users a on a.user_id = r.approved_by
           where r.company_id = ${auth.companyId} and r.pay_year = ${year} and r.pay_month = ${month}`
        const lines = run
          ? await sql`
              select ${LINE_COLUMNS(sql)}
                from payroll_lines l join users u on u.user_id = l.user_id
               where l.run_id = ${run.id as string}
               order by u.name`
          : []
        const freelancers = seePayouts
          ? await sql`
              with slots as (
                select t.user_id, coalesce(t.final_cost, t.estimated_cost, 0) as cost,
                       coalesce((select sum(st.amount_paid) from team_slot_settlements st where st.slot_id = t.id), 0) as paid
                  from team_assignment_slots t
                  left join shoots s on s.id = t.shoot_id
                 where t.company_id = ${auth.companyId} and t.status not in ('cancelled', 'released')
                   and coalesce(s.shoot_date, (t.start_at at time zone 'Asia/Kolkata')::date)
                       between make_date(${year}, ${month}, 1) and (make_date(${year}, ${month}, 1) + interval '1 month - 1 day')::date
              )
              select s.user_id, coalesce(u.name, 'Team member') as name, count(*)::int as shoots,
                     sum(s.cost) as owed, sum(s.paid) as paid, sum(s.cost - s.paid) as due
                from slots s join users u on u.user_id = s.user_id
               where s.cost - s.paid > 0
               group by s.user_id, u.name
               order by u.name`
          : null
        return { run: run ?? null, lines, freelancers }
      }),
    )
    if (!data) fail(400, 'We could not load payroll.')
    return c.json(payrollMonth.parse({ ...data, can_edit: canEdit(c) }))
  })

  // Make the month, or count a draft again (manual additions stay).
  .post('/runs/generate', editGate, async (c) => {
    const parsed = generatePayrollRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a month.')
    const { year, month } = parsed.data
    const auth = c.get('auth')
    const rows = await attempt(
      c,
      'payroll.generate',
      () =>
        withService(c.env, async (sql) => {
          // Two statements: a query cannot see a row its own function call inserted.
          const [g] = await sql<{ id: string }[]>`select payroll_generate(${auth.companyId}, ${year}, ${month}, ${auth.userId}) as id`
          return sql<{ id: string; people: number; total_net: number }[]>`
            select id, people, total_net from payroll_runs where id = ${g!.id}`
        }),
      { onCode: explain },
    )
    if (!rows?.[0]) fail(400, 'We could not make this month’s payroll.')
    const r = rows[0]
    await audit(c, { action: 'payroll.generate', entityType: 'payroll_run', entityId: r.id, after: { year, month, people: r.people, total_net: r.total_net } })
    return c.json({ id: r.id }, 201)
  })

  // A bonus or allowance, and an advance taken back -- each with a note.
  .patch('/lines/:id', editGate, async (c) => {
    const id = uuidParam(c)
    const parsed = updatePayrollLineRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the amounts.')
    const d = parsed.data
    const auth = c.get('auth')
    const rows = await attempt(
      c,
      'payroll.line_update',
      () =>
        withService(c.env, (sql) => sql<{ net: number }[]>`
          select payroll_set_adjustments(${auth.companyId}, ${id}, ${d.additions}, ${d.additions_note ?? null},
                                         ${d.other_deductions}, ${d.other_deductions_note ?? null}) as net`),
      { onCode: explain },
    )
    if (!rows?.[0]) fail(400, 'We could not save that.')
    await audit(c, {
      action: 'payroll.line_update',
      entityType: 'payroll_line',
      entityId: id,
      after: { additions: d.additions, other_deductions: d.other_deductions, net_pay: rows[0].net },
    })
    return c.json({ net_pay: Number(rows[0].net) })
  })

  .post('/runs/:id/approve', editGate, async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(
      c,
      'payroll.approve',
      () =>
        withService(c.env, async (sql) => {
          await sql`select payroll_approve(${auth.companyId}, ${id}, ${auth.userId})`
          return sql<{ pay_year: number; pay_month: number; people: number; total_net: number }[]>`
            select pay_year, pay_month, people, total_net from payroll_runs where id = ${id}`
        }),
      { onCode: explain },
    )
    if (!rows?.[0]) fail(400, 'We could not approve this month.')
    const r = rows[0]
    await audit(c, {
      action: 'payroll.approve',
      entityType: 'payroll_run',
      entityId: id,
      after: { year: r.pay_year, month: r.pay_month, people: r.people, total_net: r.total_net },
    })
    return c.body(null, 204)
  })

  // Mark one person paid, or everyone still to pay. Each member is told
  // their payslip is ready; the salaries ledger follows.
  .post('/runs/:id/pay', editGate, async (c) => {
    const id = uuidParam(c)
    const parsed = markPayrollPaidRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the payment details.')
    const d = parsed.data
    const auth = c.get('auth')
    const run = await runOf(c, id)
    const rows = await attempt(
      c,
      'payroll.pay',
      () =>
        withService(c.env, (sql) => sql<{ line_id: string; net_pay: number }[]>`
          select line_id, net_pay from payroll_mark_paid(${auth.companyId}, ${id}, ${d.line_id ?? null}, ${auth.userId},
                                                         ${d.payment_mode ?? null}, ${d.reference ?? null})`),
      { onCode: explain },
    )
    if (!rows) fail(400, 'We could not mark this paid.')
    const total = rows.reduce((n, r) => n + Number(r.net_pay), 0)
    // Amounts and the mode only: no account numbers, no reference.
    await audit(c, {
      action: 'payroll.pay',
      entityType: d.line_id ? 'payroll_line' : 'payroll_run',
      entityId: d.line_id ?? id,
      after: { year: run.pay_year, month: run.pay_month, people: rows.length, total, payment_mode: d.payment_mode ?? null },
    })
    return c.json(markPayrollPaidResponse.parse({ paid_count: rows.length, paid_total: total }))
  })

  // The bank-transfer sheet: who, account or UPI, how much. Full account
  // details, so only for whoever pays -- and the export itself is recorded.
  .get('/runs/:id/export', editGate, async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const run = await runOf(c, id)
    const rows = await attempt(c, 'payroll.export', () =>
      withService(c.env, (sql) => sql`
        select coalesce(u.name, 'Team member') as name, mp.upi_id, mp.bank_account_name,
               nullif(btrim(mp.bank_account_number), '') as bank_account_number, mp.bank_ifsc, l.net_pay,
               l.payable_days
          from payroll_lines l
          join users u on u.user_id = l.user_id
          left join member_profiles mp on mp.user_id = l.user_id
         where l.run_id = ${id} and l.company_id = ${auth.companyId}
         order by u.name`),
    )
    if (!rows) fail(400, 'We could not export this month.')
    await audit(c, { action: 'payroll.export', entityType: 'payroll_run', entityId: id, after: { year: run.pay_year, month: run.pay_month, rows: rows.length } })
    return c.json(payrollExportRow.array().parse(rows))
  })

  // Payslips for one member: your own (approved months only), or anyone's
  // for whoever sees payroll.
  .get('/payslips', async (c) => {
    const auth = c.get('auth')
    const userId = c.req.query('user_id') ?? auth.userId
    if (!z.string().uuid().safeParse(userId).success) fail(422, 'Unknown member.')
    const staff = canView(c)
    if (userId !== auth.userId && !staff) fail(403, DENIED)
    const rows = await attempt(c, 'payroll.payslips', () =>
      staff
        ? withService(c.env, (sql) => sql`
            select l.id, l.pay_year, l.pay_month, l.net_pay, l.paid_at, r.status as run_status
              from payroll_lines l
              join payroll_runs r on r.id = l.run_id
             where l.user_id = ${userId} and l.company_id = ${auth.companyId}
             order by l.pay_year desc, l.pay_month desc
             limit 24`)
        : // A member reads their own lines under RLS (released = approved);
          // the run itself is not theirs to read.
          withUser(c.env, auth.userId, (sql) => sql`
            select l.id, l.pay_year, l.pay_month, l.net_pay, l.paid_at,
                   case when l.paid_at is not null then 'paid' else 'approved' end as run_status
              from payroll_lines l
             where l.user_id = ${auth.userId} and l.released
             order by l.pay_year desc, l.pay_month desc
             limit 24`),
    )
    if (!rows) fail(400, 'We could not load payslips.')
    return c.json(payslipSummary.array().parse(rows))
  })

  // One payslip. Staff read it through the service role (scoped to the
  // studio); a member under RLS, which shows only their own approved lines.
  .get('/payslips/:id', async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const staff = canView(c)
    const read = async (sql: TransactionSql) => {
      const [l] = await sql`
        select ${LINE_COLUMNS(sql)}, l.pay_year, l.pay_month,
               case when l.paid_at is not null then 'paid' when l.released then 'approved' else 'draft' end as run_status,
               u.email, u.phone,
               (select string_agg(er.type_name, ', ' order by er.type_name)
                  from employee_role_assignments era join employee_roles er on er.id = era.role_id
                 where era.user_id = l.user_id) as job_title
          from payroll_lines l join users u on u.user_id = l.user_id
         where l.id = ${id} and l.company_id = ${auth.companyId}
           and ${staff ? sql`true` : sql`l.user_id = ${auth.userId} and l.released`}`
      if (!l) return 'missing' as const
      const [co] = await sql`
        select coalesce(co.display_name, co.name) as company_name, co.legal_name as company_legal_name,
               co.invoice_address as company_address, co.invoice_phone as company_phone,
               co.invoice_email as company_email, coalesce(co.invoice_logo_url, co.avatar_url) as logo_url
          from companies co where co.id = ${auth.companyId}`
      return { ...l, ...co }
    }
    const row = await attempt(c, 'payroll.payslip', () => (staff ? withService(c.env, read) : withUser(c.env, auth.userId, read)))
    if (row === 'missing') fail(404, 'That payslip was not found.')
    if (!row) fail(400, 'We could not load that payslip.')
    return c.json(payslip.parse(row))
  })
