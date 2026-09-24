import { Hono } from 'hono'
import type { Context } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  createExpenseRequest,
  createFixedOverheadRequest,
  updateExpenseRequest,
  expense,
  financialOverview,
  fixedOverhead,
  monthlyProfitSummary,
  projectFinancials,
  profitabilityReportQuery,
  profitabilityReport,
  reconciliationSummary,
} from '@ipc/contracts'
import { grossProfit, balancePending } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction, requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { numberQuery, uuidParam, uuidQuery } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { rpcJson } from '../../lib/rpc'
import { audit } from '../../lib/audit'

const expenses = expense.array()
const financials = projectFinancials.array()

/** Everything the expense list can be narrowed by, read once. */
function expenseFilters(c: Context<AppEnv>) {
  // The studio's own vocabulary, not a with/without guess: `exempt` is a GST
  // treatment that carries no tax, so folding it into "with GST" would put
  // rows with no tax under a tile that counts tax.
  const gstRaw = c.req.query('gst')?.trim() ?? ''
  if (gstRaw && !['gst_applicable', 'exempt', 'non_gst', 'reverse_charge'].includes(gstRaw)) {
    fail(422, 'That GST filter is not one we use.')
  }
  return {
    project: uuidQuery(c, 'project_id'),
    category: c.req.query('category') || null,
    dateFrom: c.req.query('date_from') || null,
    dateTo: c.req.query('date_to') || null,
    search: (c.req.query('search') ?? '').trim() || null,
    minAmount: numberQuery(c, 'min_amount', 'amount_min'),
    maxAmount: numberQuery(c, 'max_amount', 'amount_max'),
    gst: gstRaw || null,
  }
}

/** The one WHERE the list, its count and its tiles all share. */
function expenseWhere(sql: TransactionSql, f: ReturnType<typeof expenseFilters>) {
  return sql`
    where ${f.project ? sql`e.project_id = ${f.project}` : sql`true`}
      and (${f.category}::text is null or e.category = ${f.category})
      and (${f.dateFrom}::date is null or e.expense_date >= ${f.dateFrom}::date)
      and (${f.dateTo}::date is null or e.expense_date <= ${f.dateTo}::date)
      and (${f.search}::text is null or e.description ilike '%' || ${f.search} || '%' or e.invoice_number ilike '%' || ${f.search} || '%')
      and (${f.minAmount}::numeric is null or e.amount >= ${f.minAmount}::numeric)
      and (${f.maxAmount}::numeric is null or e.amount <= ${f.maxAmount}::numeric)
      and ${
        f.gst === 'reverse_charge'
          ? // Two columns say this: the treatment, and the boolean the tile counts.
            sql`(e.gst_treatment = 'reverse_charge' or e.reverse_charge = true)`
          : f.gst
            ? sql`e.gst_treatment = ${f.gst}`
            : sql`true`
      }`
}

interface FinancialRow {
  project_id: string
  name: string
  revenue: number
  received: number
  direct_team_cost: number
  project_expenses: number
}

export const financialsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ── Expenses (company_expenses module) ──────────────────────
  //
  // The list, the count under it and the tiles above it all read ONE
  // predicate. They used not to: the summary endpoint filtered by date alone,
  // so "Total" described every expense in the month while the rows beneath it
  // were narrowed by category, project, amount and a search. Two numbers on
  // one screen that answer different questions is worse than one number.
  .get('/expenses', requireModule('company_expenses'), async (c) => {
    const f = expenseFilters(c)
    const sort = c.req.query('sort') === 'amount' ? 'amount' : 'date'
    const dir = c.req.query('dir') === 'asc' ? 'asc' : 'desc'
    // Paging is opt-in: a caller that asks for a page gets { items, total },
    // one that does not still gets the plain array it always got.
    const wantsPage = c.req.query('page') !== undefined || c.req.query('page_size') !== undefined
    const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(c.req.query('page_size') ?? 100) || 100))
    const result = await attempt(c, 'financials.expenses', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          select e.id, e.project_id, e.party_id, p.name as party_name, e.category, e.description,
                  e.amount, e.expense_date, e.gst_treatment, e.gst_rate, e.is_fixed_overhead,
                  e.invoice_number, e.amount_is, e.tax_name, e.tax_amount, e.reverse_charge, e.itemize_json
          from expenses e
          left join parties p on p.id = e.party_id
          ${expenseWhere(sql, f)}
          order by ${sort === 'amount' ? sql`e.amount` : sql`e.expense_date`} ${dir === 'asc' ? sql`asc` : sql`desc`}
          limit ${pageSize} offset ${(page - 1) * pageSize}`
        if (!wantsPage) return { rows, total: rows.length }
        const counted = await sql<{ n: number }[]>`
          select count(*)::int as n from expenses e ${expenseWhere(sql, f)}`
        return { rows, total: counted[0]?.n ?? rows.length }
      }),
    )
    if (!result) fail(400, 'We could not load expenses.')
    const rows = result.rows
    const items = expenses.parse((rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      invoice_number: (r['invoice_number'] as string | null) ?? null,
      amount_is: (r['amount_is'] as string | null) ?? null,
      tax_name: (r['tax_name'] as string | null) ?? null,
      tax_amount: typeof r['tax_amount'] === 'number' ? r['tax_amount'] : null,
      reverse_charge: typeof r['reverse_charge'] === 'boolean' ? r['reverse_charge'] : null,
      itemize_json: Array.isArray(r['itemize_json']) ? r['itemize_json'] : null,
    })))
    return wantsPage
      ? c.json({ items, total: result.total, page, page_size: pageSize })
      : c.json(items)
  })

  // The tiles, over exactly the rows the list is showing.
  .get('/expenses/summary', requireModule('company_expenses'), async (c) => {
    const f = expenseFilters(c)
    const row = await attempt(c, 'financials.expenses_summary', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<Record<string, unknown>[]>`select
            count(*)::int as count, coalesce(sum(e.amount), 0) as total,
            coalesce(sum(e.tax_amount), 0) as tax_total,
            coalesce(sum(e.amount) filter (where e.reverse_charge = true), 0) as rcm_total,
            count(*) filter (where e.project_id is not null)::int as linked_count,
            count(distinct e.category) filter (where e.category is not null)::int as category_count
          from expenses e ${expenseWhere(sql, f)}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not load the expense summary.')
    return c.json(row)
  })

  .post('/expenses', requireAction('company_expenses', 'create'), async (c) => {
    const parsed = createExpenseRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the expense details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'financials.expense_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // Build the row without ever holding an `undefined`: postgres.js
        // refuses those outright, so writing `itemize_json: undefined` when the
        // caller omitted it failed EVERY insert — which is what it was doing,
        // because nothing in the UI sends that field.
        const values: Record<string, unknown> = {
          ...parsed.data,
          company_id: auth.companyId,
          created_by: auth.userId,
        }
        if (parsed.data.itemize_json) values['itemize_json'] = sql.json(parsed.data.itemize_json as never)
        else delete values['itemize_json']
        const rows = await sql`
          insert into expenses ${sql(values)}
          returning id, project_id, party_id,
                    (select name from parties where id = party_id) as party_name,
                    category, description, amount, expense_date, gst_treatment, gst_rate, is_fixed_overhead,
                    invoice_number, amount_is, tax_name, tax_amount, reverse_charge, itemize_json`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not add the expense.')
    const created = expense.parse({ ...(row as Record<string, unknown>), itemize_json: Array.isArray((row as Record<string, unknown>)['itemize_json']) ? (row as Record<string, unknown>)['itemize_json'] : null })
    await audit(c, { action: 'expense.create', entityType: 'expense', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  .patch('/expenses/:id', requireAction('company_expenses', 'edit'), async (c) => {
    const parsed = updateExpenseRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the expense details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'financials.expense_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const patch = { ...parsed.data } as Record<string, unknown>
        if (Array.isArray(patch['itemize_json'])) patch['itemize_json'] = sql.json(patch['itemize_json'] as never) as never
        const rows = await sql`
          update expenses set ${sql(patch)} where id = ${id}
          returning id, project_id, party_id,
                    (select name from parties where id = party_id) as party_name,
                    category, description, amount, expense_date, gst_treatment, gst_rate, is_fixed_overhead,
                    invoice_number, amount_is, tax_name, tax_amount, reverse_charge, itemize_json`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That expense was not found.')
    const updated = expense.parse({ ...(row as Record<string, unknown>), itemize_json: Array.isArray((row as Record<string, unknown>)['itemize_json']) ? (row as Record<string, unknown>)['itemize_json'] : null })
    await audit(c, { action: 'expense.update', entityType: 'expense', entityId: id, after: parsed.data })
    return c.json(updated)
  })

  .delete('/expenses/:id', requireAction('company_expenses', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'financials.expense_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from expenses where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this expense.')
    if (!rows.length) fail(404, 'That expense was not found.')
    await audit(c, { action: 'expense.delete', entityType: 'expense', entityId: id })
    return c.body(null, 204)
  })

  // ── Profit summary (financials module) ──────────────────────
  .get('/projects', requireModule('financials'), async (c) => {
    const data = await attempt(c, 'financials.projects', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<FinancialRow[]>`
          select project_id, name, revenue, received, direct_team_cost, project_expenses
          from project_financials`,
      ),
    )
    if (!data) fail(400, 'We could not load financials.')
    const rows = data.map((row) => ({
      ...row,
      gross_profit: grossProfit({
        revenue: row.revenue,
        directTeamCost: row.direct_team_cost,
        projectExpenses: row.project_expenses,
      }),
      balance_pending: balancePending(row.revenue, row.received),
    }))
    return c.json(financials.parse(rows))
  })

  // ── Financials overview (financials module) ───────────────────
  // Lovable parity: date filter + salaries + GST/RCM + receivables/collection/
  // margin + attention + recent. Minimal cards payload; heavy charts stay on
  // the dedicated pages (superset: forecast/GiST stay untouched).
  .get('/overview', requireModule('financials'), async (c) => {
    const startDate = c.req.query('start_date') || c.req.query('date_from') || null
    const endDate = c.req.query('end_date') || c.req.query('date_to') || null
    const includeParam = c.req.query('include_salaries')
    const includeSalaries = includeParam == null ? true : includeParam !== 'false' && includeParam !== '0'
    const data = await attempt(c, 'financials.overview', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rev = await sql<{ revenue: string; received: string }[]>`
          select coalesce(sum(p.total_cost), 0)::text as revenue,
                 coalesce((select sum(rp.amount) from received_payments rp
                   where rp.company_id = ${c.get('auth').companyId}
                     and (${startDate}::date is null or rp.paid_on >= ${startDate}::date)
                     and (${endDate}::date is null or rp.paid_on <= ${endDate}::date)), 0)::text as received
            from projects p where p.company_id = ${c.get('auth').companyId}`
        const exp = await sql<{ company: string; rcm: string; uncategorized: string; missing: string }[]>`
          select coalesce(sum(amount), 0)::text as company,
                 coalesce(sum(amount) filter (where reverse_charge = true), 0)::text as rcm,
                 coalesce(count(*) filter (where category is null or category = ''), 0)::text as uncategorized,
                 coalesce(count(*) filter (where invoice_number is null or invoice_number = ''), 0)::text as missing
            from expenses where company_id = ${c.get('auth').companyId}
              and (${startDate}::date is null or expense_date >= ${startDate}::date)
              and (${endDate}::date is null or expense_date <= ${endDate}::date)`.catch(() => [{ company: '0', rcm: '0', uncategorized: '0', missing: '0' }] as { company: string; rcm: string; uncategorized: string; missing: string }[])
        let personal = 0
        let personalMissing = 0
        try {
          const pr = await sql<{ total: string; missing: string }[]>`select coalesce(sum(amount), 0)::text as total,
              coalesce(count(*) filter (where invoice_number is null or invoice_number = ''), 0)::text as missing
            from personal_expense
            where company_id = ${c.get('auth').companyId}`
          personal = Number(pr[0]?.total ?? 0)
          personalMissing = Number(pr[0]?.missing ?? 0)
        } catch { personal = 0 }
        let salaries = 0
        try {
          const sr = await sql<{ total: string }[]>`select coalesce(sum(amount), 0)::text as total from team_payouts
            where company_id = ${c.get('auth').companyId}`
          salaries = Number(sr[0]?.total ?? 0)
        } catch { salaries = 0 }
        // The real tax on the real invoices, from the one function that
        // works it out.
        //
        // This used to read `sum(received_payments.amount * 0.18)` -- a flat
        // 18% of every rupee the studio had ever received, whether the
        // invoice carried tax or not, whether it was taxed at 5% or 12%, and
        // ignoring the date range the rest of this endpoint respects. For a
        // studio that mostly bills families with no GST at all, that card
        // invented a liability out of nothing.
        //
        // gst_analysis() sums the per-line cgst/sgst/igst that invoice_items
        // already carries. Calling it rather than copying its query keeps the
        // one definition of the studio's tax, and keeps the tests that cover
        // it (tenancy, pending-not-received) covering a live path -- the GST
        // Analysis page they were written for is gone. It wants a bounded
        // range; an unbounded overview asks for all of time.
        const gstJson = await sql<{ gst_analysis: unknown }[]>`
          select gst_analysis(
            ${startDate ?? '1900-01-01'}::date,
            ${endDate ?? '2999-12-31'}::date
          ) as gst_analysis`.catch(() => [] as { gst_analysis: unknown }[])
        const gstRow = rpcJson(gstJson[0]?.gst_analysis, {}) as Record<string, unknown>
        const gst = {
          collected: String(gstRow['gst_collected'] ?? 0),
          paid: String(gstRow['gst_paid'] ?? 0),
        }
        const recent = await sql<Record<string, unknown>[]>`select 'payment' as type, amount, paid_on as date from received_payments
          where company_id = ${c.get('auth').companyId} order by paid_on desc limit 8`.catch(() => [] as Record<string, unknown>[])
        return { rev: rev[0], exp: (exp as { company: string; rcm: string; uncategorized: string; missing: string }[])[0], personal, personalMissing, salaries, gst, recent }
      }),
    )
    if (!data) fail(400, 'We could not load the financial overview.')
    const revenue = Number(data.rev?.revenue ?? 0)
    const received = Number(data.rev?.received ?? 0)
    const receivables = Math.max(0, revenue - received)
    const company = Number(data.exp?.company ?? 0)
    const salaryCost = includeSalaries ? data.salaries : 0
    const totalExpenses = company + data.personal + salaryCost
    const netProfit = received - totalExpenses
    const expectedProfit = revenue - totalExpenses
    const uncategorized = Number(data.exp?.uncategorized ?? 0)
    const missing = Number(data.exp?.missing ?? 0) + (data.personalMissing ?? 0)
    const attention: Record<string, unknown>[] = []
    if (receivables > 0) attention.push({ kind: 'receivables', message: 'Outstanding receivables need follow-up.', amount: receivables })
    if (uncategorized > 0) attention.push({ kind: 'uncategorized', message: `${uncategorized} expenses need a category.`, amount: uncategorized })
    if (missing > 0) attention.push({ kind: 'missing_invoice', message: `${missing} expenses are missing an invoice number.`, amount: missing })
    return c.json(financialOverview.parse({
      start_date: startDate, end_date: endDate,
      revenue, received, receivables,
      collection_rate: revenue > 0 ? (received / revenue) * 100 : 0,
      margin: revenue > 0 ? ((revenue - company - data.salaries) / revenue) * 100 : null,
      salaries: data.salaries,
      company_expenses: company,
      personal_expenses: data.personal,
      gst_collected: Number(data.gst?.collected ?? 0),
      gst_paid: Number(data.gst?.paid ?? 0),
      rcm_liability: Number(data.exp?.rcm ?? 0),
      attention_count: attention.length,
      attention,
      recent: data.recent,
      net_profit: netProfit,
      expected_profit: expectedProfit,
      total_expenses: totalExpenses,
      uncategorized_count: uncategorized,
      missing_invoice_count: missing,
      include_salaries: includeSalaries,
      salaries_warning: includeSalaries ? null : 'Salaries excluded. Turn on Include salaries to include paid salary expenses.',
    }))
  })

  // ── Monthly profit (financials module) ────────────────────────
  // Lovable parity: month picker + cash/booked basis + alloc equal/revenue/
  // shoot_days/headcount + cards + warnings + per-project breakdown + salary buckets.
  .get('/monthly-profit-summary', requireModule('financials'), async (c) => {
    const month = c.req.query('month') || new Date().toISOString().slice(0, 7) + '-01'
    const basis = c.req.query('basis') === 'booked' ? 'booked' : 'cash'
    const alloc = ['equal', 'revenue', 'shoot_days', 'headcount'].includes(c.req.query('alloc') ?? '') ? c.req.query('alloc')! : 'equal'
    // The inner `try { ... } catch { return null }` that used to be here
    // swallowed the error before attempt() could see it -- no log line, no
    // report, no correlation id -- and the null then fell through to the
    // all-zeros object below. A studio whose profit query failed was shown a
    // month where it earned nothing and spent nothing, with no error anywhere.
    //
    // The wrapper distinguishes the two nulls: attempt() returning null means
    // the call failed, while { data: null } means the function ran and had
    // nothing to report, which is the only case zeros are honest.
    const row = await attempt(c, 'financials.monthly_profit', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const r = await sql<{ monthly_profit_summary: unknown }[]>`
          select monthly_profit_summary(p_month => ${month}::date, p_basis => ${basis}, p_alloc => ${alloc}) as monthly_profit_summary`
        return { data: rpcJson(r[0]?.monthly_profit_summary, null) as Record<string, unknown> | null }
      }),
    )
    if (!row) fail(400, 'We could not work out this month\u2019s profit.')
    const base = (row.data ?? { month, basis, alloc, cash_received: 0, booked_revenue: 0, salary_cost: 0, office_fixed: 0, variable_cost: 0, fixed_total: 0, total_cost: 0, net_cash: 0, net_booked: 0 }) as Record<string, unknown>
    const net = basis === 'cash' ? Number(base['net_cash'] ?? 0) : Number(base['net_booked'] ?? 0)
    const denom = basis === 'cash' ? Number(base['cash_received'] ?? 0) : Number(base['booked_revenue'] ?? 0)
    const warnings: string[] = []
    if (denom > 0 && (net / denom) * 100 < 15) warnings.push('Net margin below 15% for this month.')
    if (Number(base['salary_cost'] ?? 0) > denom * 0.5 && denom > 0) warnings.push('Salary cost exceeds 50% of revenue.')
    // Monthly team cost, split five ways.
    //
    // This used to group team_payouts by `employment_type` — a column that
    // exists on no table. Every call threw, a bare catch swallowed it, and the
    // card rendered five ₹0 tiles under a non-zero salary figure for as long
    // as it has shipped. It also had no month filter under a month picker, and
    // a `limit 5` that would have dropped a sixth group silently.
    //
    // How someone is paid lives on `users` (0026/0069/0101). The window is the
    // same one monthly_profit_summary uses for salary_cost — payouts created
    // in the month — so the five tiles add up to the figure above them.
    const monthEnd = new Date(`${month.slice(0, 7)}-01T00:00:00Z`)
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)
    const buckets =
      (await attempt(c, 'financials.salary_buckets', () =>
        withUser(c.env, c.get('auth').userId, (sql) =>
          sql<Record<string, unknown>[]>`
            select case
                     when coalesce(u.stipend_amount, 0) > 0 then 'intern'
                     when u.payout_type = 'salary'
                       or (u.payout_type is null and u.engagement_type = 'in_house') then 'salaried'
                     when u.engagement_type = 'freelancer'
                       or u.payout_type in ('per_shoot', 'per_day', 'per_project') then 'contractor'
                     when coalesce(u.commission_pct, 0) > 0 then 'commission'
                     else 'other'
                   end as bucket,
                   coalesce(sum(tp.amount), 0) as total
              from team_payouts tp
              join users u on u.user_id = tp.user_id
             where tp.company_id = ${c.get('auth').companyId}
               and tp.created_at >= ${month.slice(0, 7) + '-01'}::date
               and tp.created_at < ${monthEnd.toISOString().slice(0, 10)}::date
             group by 1`,
        ),
      )) ?? []
    return c.json(monthlyProfitSummary.parse({
      ...base,
      margin_cash: Number(base['cash_received'] ?? 0) > 0 ? (Number(base['net_cash'] ?? 0) / Number(base['cash_received'])) * 100 : null,
      margin_booked: Number(base['booked_revenue'] ?? 0) > 0 ? (Number(base['net_booked'] ?? 0) / Number(base['booked_revenue'])) * 100 : null,
      warnings, salary_buckets: buckets, projects: [],
    }))
  })

  // `/salary-summary` used to live here. It grouped team_payouts by
  // `employment_type` -- a column on no table -- inside a catch that returned
  // [] on the error, so it answered "no salaries" forever. Nothing in the web
  // app ever called it; the five team-cost buckets on /financials/profit come
  // from the monthly summary above, which reads how people are paid off
  // `users` and is covered by tests. A broken endpoint nobody calls is worse
  // than no endpoint, so it is gone rather than repaired twice.

  // FixedOverheads CRUD (9 cats + 4 alloc bases).
  .get('/fixed-overheads', requireModule('financials'), async (c) => {
    const month = c.req.query('month') || null
    const rows = await attempt(c, 'financials.overheads_list', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        return sql`select id, category, label, amount, alloc_basis, month::text as month, is_active, created_at
          from fixed_overheads
         where (${month}::date is null or month = date_trunc('month', ${month}::date))
         order by category asc`
      }),
    )
    if (!rows) fail(400, 'We could not load fixed overheads.')
    return c.json(fixedOverhead.array().parse((rows as Record<string, unknown>[]).map((r) => ({ ...r, month: String(r['month']).slice(0, 10) }))))
  })

  .post('/fixed-overheads', requireModule('financials'), async (c) => {
    const parsed = createFixedOverheadRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the overhead details.')
    const row = await attempt(c, 'financials.overhead_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`insert into fixed_overheads ${sql({ ...parsed.data, company_id: c.get('auth').companyId, created_by: c.get('auth').userId })}
          returning id, category, label, amount, alloc_basis, month::text as month, is_active, created_at`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not add this overhead.')
    await audit(c, { action: 'fixed_overhead.create', entityType: 'fixed_overhead', entityId: (row as { id: string }).id, after: parsed.data })
    return c.json(fixedOverhead.parse({ ...(row as Record<string, unknown>), month: String((row as Record<string, unknown>)['month']).slice(0, 10) }), 201)
  })

  .patch('/fixed-overheads/:id', requireModule('financials'), async (c) => {
    const id = uuidParam(c)
    const patch = createFixedOverheadRequest.partial().safeParse(await c.req.json().catch(() => ({})))
    if (!patch.success || Object.keys(patch.data).length === 0) fail(422, 'Nothing to change.')
    const row = await attempt(c, 'financials.overhead_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`update fixed_overheads set ${sql(patch.data)} where id = ${id}
          returning id, category, label, amount, alloc_basis, month::text as month, is_active, created_at`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That overhead was not found.')
    return c.json(fixedOverhead.parse({ ...(row as Record<string, unknown>), month: String((row as Record<string, unknown>)['month']).slice(0, 10) }))
  })

  .delete('/fixed-overheads/:id', requireModule('financials'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'financials.overhead_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from fixed_overheads where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this overhead.')
    if (!rows.length) fail(404, 'That overhead was not found.')
    await audit(c, { action: 'fixed_overhead.delete', entityType: 'fixed_overhead', entityId: id })
    return c.body(null, 204)
  })

  // ── Reconciliation (financials module) ──────────────────────
  // One read, every difference. See 0147 for why this screen exists.
  .get('/reconciliation', requireModule('financials'), async (c) => {
    const row = await attempt(c, 'financials.reconciliation', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ reconciliation_summary: unknown }[]>`
          select reconciliation_summary() as reconciliation_summary`
        return { data: rpcJson(rows[0]?.reconciliation_summary, null) }
      }),
    )
    if (!row) fail(400, 'We could not work out the reconciliation.')
    if (!row.data) fail(400, 'We could not work out the reconciliation.')
    return c.json(reconciliationSummary.parse(row.data))
  })

  // ── Project profitability report (financials module) ───────
  .get('/profitability', requireModule('financials'), async (c) => {
    const q = c.req.query()
    const parsed = profitabilityReportQuery.safeParse({
      date_from: q.date_from || undefined,
      date_to: q.date_to || undefined,
      project_id: q.project_id || undefined,
      client_id: q.client_id || undefined,
      status: q.status || undefined,
      search: q.search || undefined,
      sort_by: q.sort_by || undefined,
      sort_direction: q.sort_direction || undefined,
      page: q.page ? Number(q.page) : undefined,
      page_size: q.page_size ? Number(q.page_size) : undefined,
    })
    if (!parsed.success) fail(422, 'Please check the report filters.')
    const v = parsed.data

    const data = await attempt(c, 'financials.profitability', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const result = await sql<{ project_profitability_report: unknown }[]>`
          select project_profitability_report(
            p_date_from => ${v.date_from ?? null}::date,
            p_date_to => ${v.date_to ?? null}::date,
            p_project_id => ${v.project_id ?? null}::uuid,
            p_client_id => ${v.client_id ?? null}::uuid,
            p_status => ${v.status ?? null},
            p_search => ${v.search ?? null},
            p_sort_by => ${v.sort_by},
            p_sort_direction => ${v.sort_direction},
            p_page => ${v.page},
            p_page_size => ${v.page_size}
          ) as project_profitability_report`
        return rpcJson(result[0]?.project_profitability_report, {})
      }),
    )
    if (!data) fail(400, 'We could not load the profitability report.')
    const report = data as { summary?: Record<string, unknown> }
    // Lovable parity: pending_income + pending_collection_rate + total_pending summary.
    if (report.summary && report.summary['pending_income'] == null) {
      const total = Number(report.summary['total_receivables'] ?? 0)
      const paid = Number(report.summary['total_paid_income'] ?? 0)
      const value = Number(report.summary['total_project_value'] ?? 0)
      report.summary['pending_income'] = total
      report.summary['total_pending'] = total
      report.summary['pending_collection_rate'] = value > 0 ? (paid / value) * 100 : 0
    }
    return c.json(profitabilityReport.parse(data))
  })
