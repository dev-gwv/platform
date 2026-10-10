import { Hono } from 'hono'
import { billingOverview, billingDue, type DueLineRow } from '@ipc/contracts'
import { allocateDue, dueBucket, instalmentAmounts, planDueDate } from '@ipc/domain'
import { planInstalmentsFrom } from '../../lib/plan'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { todayInIndia } from '../../lib/dates'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'

export const billingDueRoutes = new Hono<AppEnv>()
  /**
   * Payments received's tiles: what is still to come in, project by project,
   * placed on dates -- open invoices, then promises, then the rest of the
   * plan by its dates (worked out from the shoots), anything past that is
   * Later -- each rupee once (allocateDue). Received is the period's money in.
   */
  .get('/due', async (c) => {
    const from = c.req.query('from')
    const to = c.req.query('to')
    const day = /^\d{4}-\d{2}-\d{2}$/
    const today = todayInIndia()
    const data = await attempt(c, 'billing.due', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const projects = await sql<{ id: string; name: string; client_name: string | null; total: number; received: number }[]>`
          select p.id, p.name, cl.name as client_name, p.total_cost::float8 as total,
                 coalesce((select sum(rp.amount) from received_payments rp where rp.project_id = p.id and rp.status = 'paid'), 0)::float8 as received
            from projects p
            left join clients cl on cl.id = p.client_id
           where p.status <> 'cancelled'`
        const invoices = await sql<{ id: string; project_id: string | null; label: string; balance: number; due_on: string | null; client_name: string | null; project_name: string | null }[]>`
          select i.id, i.project_id, i.invoice_number as label, i.balance_due::float8 as balance, i.due_date::text as due_on,
                 cl.name as client_name, pj.name as project_name
            from invoices i
            left join clients cl on cl.id = i.client_id
            left join projects pj on pj.id = i.project_id
           where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
           order by i.due_date nulls last, i.invoice_date`
        const promises = await sql<{ id: string; project_id: string; label: string; amount: number; due_on: string | null }[]>`
          select rp.id, rp.project_id, coalesce(nullif(rp.description, ''), 'Promised payment') as label, rp.amount::float8 as amount,
                 coalesce(rp.date_received, rp.paid_on)::text as due_on
            from received_payments rp
           where rp.status = 'pending' and rp.invoice_id is null and rp.project_id is not null
           order by coalesce(rp.date_received, rp.paid_on) nulls last`
        const plans = await sql<{ project_id: string; agreed_at: string | null; total_cost: number | null; payment_terms: unknown }[]>`
          select distinct on (d.project_id) d.project_id, d.acknowledged_at::text as agreed_at, d.total_cost::float8 as total_cost, d.payment_terms
            from project_terms_documents d
           where d.revoked_at is null and not d.is_draft
             and jsonb_typeof(d.payment_terms) = 'array' and jsonb_array_length(d.payment_terms) > 0
           order by d.project_id, (d.acknowledged_at is not null) desc, d.created_at desc`
        const shoots = await sql<{ project_id: string; name: string; shoot_date: string | null }[]>`
          select s.project_id, s.name, s.shoot_date::text as shoot_date from shoots s where s.status <> 'cancelled'`
        const [rec] = await sql<{ amount: number; count: number }[]>`
          select coalesce(sum(rp.amount), 0)::float8 as amount, count(*)::int as count
            from received_payments rp
           where rp.status = 'paid'
             and coalesce(rp.date_received, rp.paid_on) >= ${from && day.test(from) ? from : '2000-01-01'}::date
             and coalesce(rp.date_received, rp.paid_on) <= ${to && day.test(to) ? to : '2099-12-31'}::date`
        return { projects, invoices, promises, plans, shoots, received: rec ?? { amount: 0, count: 0 } }
      }),
    )
    if (!data) fail(400, 'We could not load what is due.')
    const lines: DueLineRow[] = []
    const byProject = <T extends { project_id: string | null }>(xs: readonly T[], id: string) => xs.filter((x) => x.project_id === id)
    for (const p of data.projects) {
      const outstanding = Math.max(0, p.total - p.received)
      if (outstanding <= 0.5) continue
      const plan = data.plans.find((x) => x.project_id === p.id)
      const parts = plan ? planInstalmentsFrom(plan.payment_terms) : []
      const total = p.total > 0 ? p.total : (plan?.total_cost ?? 0)
      const amounts = instalmentAmounts(parts, total)
      const shoots = byProject(data.shoots, p.id)
      const allocated = allocateDue({
        outstanding,
        received: p.received,
        invoices: byProject(data.invoices, p.id),
        promises: byProject(data.promises, p.id),
        plan: parts.map((part, i) => ({
          label: part.label,
          amount: amounts[i] ?? 0,
          due_on: planDueDate(part.due_trigger, { shoots, agreedOn: plan?.agreed_at ?? null })?.date ?? null,
        })),
        today,
      })
      for (const l of allocated) lines.push({ ...l, project_id: p.id, project_name: p.name, client_name: p.client_name })
    }
    // An invoice with no project still has to be collected.
    for (const i of data.invoices.filter((x) => !x.project_id)) {
      lines.push({ kind: 'invoice', label: i.label, amount: i.balance, due_on: i.due_on, bucket: dueBucket(i.due_on, today), invoice_id: i.id, project_id: null, project_name: null, client_name: i.client_name })
    }
    const tile = (b: DueLineRow['bucket']) => {
      const xs = lines.filter((l) => l.bucket === b)
      return { amount: Math.round(xs.reduce((n, l) => n + l.amount, 0) * 100) / 100, count: xs.length }
    }
    lines.sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999'))
    return c.json(billingDue.parse({ today, overdue: tile('overdue'), soon: tile('soon'), later: tile('later'), received: data.received, lines }))
  })

  /**
   * The Billing overview: what is still owed across every project, which
   * invoices are late or nearly due, and what came in lately. One request, so
   * the page opens on the answer instead of on filters.
   */

  .get('/overview', async (c) => {
    const data = await attempt(c, 'billing.overview', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [head] = await sql`
          select
            coalesce((
              select sum(greatest(p.total_cost - coalesce((
                select sum(rp.amount) from received_payments rp
                 where rp.project_id = p.id and rp.status = 'paid'), 0), 0))
                from projects p where p.status <> 'cancelled'), 0)::float as to_collect,
            (select count(*) from invoices i
              where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
                and i.due_date < current_date)::int as overdue_count,
            coalesce((select sum(i.balance_due) from invoices i
              where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
                and i.due_date < current_date), 0)::float as overdue_amount,
            (select count(*) from invoices i
              where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
                and i.due_date between current_date and current_date + 7)::int as due_soon_count,
            coalesce((select sum(i.balance_due) from invoices i
              where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
                and i.due_date between current_date and current_date + 7), 0)::float as due_soon_amount,
            coalesce((select sum(rp.amount) from received_payments rp
              where rp.status = 'paid' and rp.paid_on >= date_trunc('month', current_date)), 0)::float as received_this_month,
            coalesce((select sum(i.total) from invoices i
              where i.status not in ('cancelled', 'draft') and i.invoice_date >= date_trunc('month', current_date)), 0)::float as invoiced_this_month`
        const due = await sql`
          select i.id, i.invoice_number, i.invoice_date, i.due_date, i.total, i.balance_due, i.status,
                 cl.name as client_name, cl.phone as client_phone, i.project_id, pj.name as project_name
            from invoices i
            left join clients cl on cl.id = i.client_id
            left join projects pj on pj.id = i.project_id
           where i.balance_due > 0 and i.status not in ('cancelled', 'draft')
           order by i.due_date nulls last, i.invoice_date
           limit 25`
        const h = head as Record<string, number>
        return {
          to_collect: h.to_collect,
          overdue: { count: h.overdue_count, amount: h.overdue_amount },
          due_soon: { count: h.due_soon_count, amount: h.due_soon_amount },
          received_this_month: h.received_this_month,
          invoiced_this_month: h.invoiced_this_month,
          due_invoices: due,
        }
      }),
    )
    if (!data) fail(400, 'We could not load billing.')
    return c.json(billingOverview.parse(data))
  })
