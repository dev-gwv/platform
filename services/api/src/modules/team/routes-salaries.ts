import { Hono } from 'hono'
import { generateMonthlySalariesRequest, monthlySalaryList, updateMonthlySalaryRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireModule } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const monthlySalaryRoutes = new Hono<AppEnv>()
  // ── Monthly salaries ledger ──────────────────────────────
  // One row per person per calendar month. Managers may view; only the
  // owner or an admin may generate or update (checked here, not just RLS).
  .get('/monthly-salaries', requireModule('team_salaries'), async (c) => {
    const month = c.req.query('month')
    const year = c.req.query('year')
    const status = c.req.query('status')
    const search = c.req.query('search')?.trim().toLowerCase() ?? ''
    const userId = c.req.query('user_id')
    const monthNum = month ? Number(month) : null
    const yearNum = year ? Number(year) : null
    if (month && !(monthNum && monthNum >= 1 && monthNum <= 12)) fail(422, 'Invalid month.')
    if (year && !(yearNum && yearNum >= 2000 && yearNum <= 2100)) fail(422, 'Invalid year.')

    const rows = await attempt(c, 'team.salaries_list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select ms.id, ms.user_id, u.name, u.email, u.phone, u.engagement_type,
               coalesce(ms.pay_month, extract(month from ms.month)::int) as month,
               coalesce(ms.pay_year, extract(year from ms.month)::int) as year,
               coalesce(ms.base_amount, ms.gross, 0) as base_amount,
               coalesce(ms.paid_amount, 0) as paid_amount,
               case ms.status
                 when 'paid' then 'paid'::text
                 when 'partially_paid' then 'partially_paid'::text
                 when 'partial' then 'partial'::text
                 when 'finalised' then 'paid'::text
                 else 'unpaid'::text
               end as status,
               ms.generated_at as created_at
        from monthly_salaries ms
        join users u on u.user_id = ms.user_id
        where ${monthNum ? sql`coalesce(ms.pay_month, extract(month from ms.month)::int) = ${monthNum}` : sql`true`}
          and ${yearNum ? sql`coalesce(ms.pay_year, extract(year from ms.month)::int) = ${yearNum}` : sql`true`}
          and ${userId ? sql`ms.user_id = ${userId}` : sql`true`}
        order by u.name`),
    )
    if (!rows) fail(400, 'We could not load salaries.')
    let items = (rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      month: Number((r as { month: unknown }).month),
      year: Number((r as { year: unknown }).year),
      base_amount: Number((r as { base_amount: unknown }).base_amount ?? 0),
      paid_amount: Number((r as { paid_amount: unknown }).paid_amount ?? 0),
    }))
    if (status && status !== 'all') {
      items = items.filter((r) => {
        const s = String((r as unknown as { status: unknown }).status)
        if (status === 'partial') return s === 'partial' || s === 'partially_paid'
        return s === status
      })
    }
    if (search) {
      items = items.filter((r) => {
        const hay = [ (r as { name?: unknown }).name, (r as { email?: unknown }).email, (r as { phone?: unknown }).phone ]
          .filter(Boolean).map((v) => String(v).toLowerCase()).join(' ')
        return hay.includes(search)
      })
    }
    const base = items.reduce((n, r) => n + Number((r as { base_amount: number }).base_amount ?? 0), 0)
    const paid = items.reduce((n, r) => n + Number((r as { paid_amount: number }).paid_amount ?? 0), 0)
    const countStatus = (s: string) => items.filter((r) => String((r as unknown as { status: unknown }).status) === s).length
    const partial = countStatus('partial') + countStatus('partially_paid')
    return c.json(
      monthlySalaryList.parse({
        items,
        totals: {
          base, paid, pending: Math.max(0, base - paid), count: items.length,
          paid_count: countStatus('paid'), partial_count: partial,
          unpaid_count: countStatus('unpaid'),
        },
      }),
    )
  })

  .post('/monthly-salaries/generate', requireModule('team_salaries'), async (c) => {
    const auth = c.get('auth')
    if (!auth.isOwner && auth.role !== 'admin') fail(403, 'You do not have access to this action.')
    const parsed = generateMonthlySalariesRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A month and year are required.')
    const { month, year } = parsed.data

    const result = await attempt(c, 'team.salaries_generate', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const members = await sql<{ user_id: string; salary: string | null }[]>`
          select user_id, salary::text as salary from users
          where deleted_at is null and status = 'active' and role <> 'super_admin'`
        if (members.length === 0) return { created: 0, skipped: 0 }
        const first = `${year}-${String(month).padStart(2, '0')}-01`
        // Who already has this month, in one read rather than one per person.
        const existing = await sql<{ user_id: string }[]>`
          select distinct user_id from monthly_salaries
          where user_id = any(${members.map((m) => m.user_id)}::uuid[])
            and ((pay_year = ${year} and pay_month = ${month})
              or (pay_year is null and pay_month is null and month = ${first}::date))`
        const has = new Set(existing.map((e) => e.user_id))
        const rows = members
          .filter((m) => !has.has(m.user_id))
          .map((m) => {
            const base = m.salary === null ? 0 : Number(m.salary)
            return {
              company_id: auth.companyId,
              user_id: m.user_id,
              month: first,
              pay_month: month,
              pay_year: year,
              gross: base,
              deductions: 0,
              net: base,
              base_amount: base,
              paid_amount: 0,
              status: 'unpaid',
            }
          })
        if (rows.length) await sql`insert into monthly_salaries ${sql(rows)}`
        return { created: rows.length, skipped: members.length - rows.length }
      }),
    )
    if (!result) fail(400, 'We could not generate salaries.')
    await audit(c, { action: 'salary.generate', entityType: 'monthly_salary', entityId: `${year}-${month}`, after: { ...parsed.data, ...result } })
    return c.json({ created_count: result.created, skipped_existing_count: result.skipped, errors: [] as string[] }, 201)
  })

  .patch('/monthly-salaries/:id', requireModule('team_salaries'), async (c) => {
    const auth = c.get('auth')
    if (!auth.isOwner && auth.role !== 'admin') fail(403, 'You do not have access to this action.')
    const id = uuidParam(c)
    const parsed = updateMonthlySalaryRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the paid amount.')
    if (parsed.data.paid_amount === undefined && parsed.data.status === undefined)
      fail(422, 'Nothing to change.')

    const row = await attempt(c, 'team.salaries_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const found = await sql<{ id: string; base_amount: string | null; gross: string | null; paid_amount: string | null }[]>`
          select id, base_amount::text, gross::text, paid_amount::text from monthly_salaries where id = ${id}`
        if (!found.length) return 'missing' as const
        const base = Number(found[0]!.base_amount ?? found[0]!.gross ?? 0)
        const nextPaid = parsed.data.paid_amount ?? Number(found[0]!.paid_amount ?? 0)
        if (nextPaid < 0) throw Object.assign(new Error('overpay'), { code: 'NEG' })
        // Overpay guard: refuse unless the caller already set status paid —
        // the UI confirms first, then resends with status paid to confirm.
        if (nextPaid > base + 0.001 && parsed.data.status !== 'paid') return 'overpay' as const
        const nextStatus =
          parsed.data.status ??
          (nextPaid <= 0.001 ? 'unpaid' : nextPaid + 0.001 >= base ? 'paid' : 'partial')
        await sql`
          update monthly_salaries set ${sql({ paid_amount: nextPaid, status: nextStatus })} where id = ${id}`
        return 'ok' as const
      }),
    )
    if (row === 'missing') fail(404, 'We could not find that salary row.')
    if (row === 'overpay')
      fail(409, 'Paid amount exceeds the base salary. Confirm the overpayment to save it.')
    if (!row) fail(400, 'We could not update this salary.')
    await audit(c, { action: 'salary.update', entityType: 'monthly_salary', entityId: id, after: parsed.data })
    return c.json({ ok: true })
  })
