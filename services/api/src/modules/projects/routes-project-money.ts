import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  paymentInput,
  updatePaymentRequest,
  projectBilling,
  projectCostSheet,
  z,
  clientActivity,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { todayInIndia } from '../../lib/dates'
import { planInstalmentsFrom } from '../../lib/plan'
import { requireMoney, requireStudioWork } from '../../lib/scope'

/** A payment may settle an invoice of this project, or one not tied to any project. */
async function invoiceFitsProject(sql: TransactionSql, invoiceId: string, projectId: string): Promise<boolean> {
  const rows = await sql`select 1 from invoices where id = ${invoiceId} and (project_id = ${projectId} or project_id is null)`
  return rows.length > 0
}

/** A date column as YYYY-MM-DD, whether the driver handed back a Date or a string. */
function isoDay(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
}

export const projectMoneyRoutes = new Hono<AppEnv>()
  /**
   * The project's money beyond its payments: the plan the client agreed to in
   * the terms (the latest agreed version, else the latest sent), and -- for
   * those who can see Billing -- the invoices raised for it.
   */
  .get('/:id/billing', requireAction('projects', 'view'), requireStudioWork, requireMoney, async (c) => {
    const projectId = uuidParam(c)
    const canSeeBilling = c.get('auth').access.hasModule('billing')
    const data = await attempt(c, 'projects.billing', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const docs = await sql<{ id: string; title: string | null; acknowledged_at: string | null; total_cost: number | null; payment_terms: unknown }[]>`
          select d.id, d.title, d.acknowledged_at, d.total_cost::float as total_cost, d.payment_terms
            from project_terms_documents d
           where d.project_id = ${projectId} and d.revoked_at is null and not d.is_draft
             and jsonb_typeof(d.payment_terms) = 'array' and jsonb_array_length(d.payment_terms) > 0
           order by (d.acknowledged_at is not null) desc, d.created_at desc
           limit 1`
        const invoices = canSeeBilling
          ? await sql`
              select id, invoice_number, invoice_date, due_date, status,
                     total::float as total, taxable::float as taxable, balance_due::float as balance_due
                from invoices where project_id = ${projectId}
               order by invoice_date, created_at`
          : null
        const d = docs[0]
        return {
          plan: d
            ? {
                document_id: d.id,
                title: d.title,
                agreed_at: d.acknowledged_at,
                total_cost: d.total_cost,
                instalments: planInstalmentsFrom(d.payment_terms),
              }
            : null,
          invoices,
        }
      }),
    )
    if (!data) fail(400, 'We could not load the project billing.')
    return c.json(projectBilling.parse(data))
  })

  // What the client did with the documents (0235): the last few opens, and an
  // acceptance. For the Overview; never money.
  .get('/:id/client-activity', requireAction('projects', 'view'), requireStudioWork, async (c) => {
    const projectId = uuidParam(c)
    const data = await attempt(c, 'projects.client_activity', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const views = await sql<{ kind: string; subject_id: string; last_viewed_at: string; views: number }[]>`
          select kind, subject_id, last_viewed_at, views from client_activity(${projectId})`
        const [q] = await sql<{ accepted_at: string | null; accepted_by_name: string | null; declined_at: string | null }[]>`
          select q.accepted_at, q.accepted_by_name, q.declined_at
            from project_quotations q where q.project_id = ${projectId}
           order by coalesce(q.accepted_at, q.declined_at) desc nulls last, q.created_at desc limit 1`
        return {
          views: views.map((v) => ({ ...v, views: Number(v.views) })),
          accepted_at: q?.accepted_at ?? null,
          accepted_by: q?.accepted_by_name ?? null,
          declined_at: q?.declined_at ?? null,
        }
      }),
    )
    if (!data) fail(400, 'We could not read what the client did.')
    return c.json(clientActivity.parse(data))
  })

  /**
   * The cost sheet: every person booked on the project with what they are
   * paid and how much has gone out, every expense put against it, and what
   * is left of the project value. Crew costs are for people who plan crew
   * (projects: edit); expenses only for those who can see the studio's.
   */

  .get('/:id/costs', requireAction('projects', 'edit'), requireMoney, async (c) => {
    const projectId = uuidParam(c)
    const seeExpenses = c.get('auth').access.hasModule('company_expenses')
    const data = await attempt(c, 'projects.costs', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [p] = await sql<{ value: number }[]>`
          select coalesce(total_cost, package_cost, 0)::float8 as value from projects where id = ${projectId}`
        if (!p) return 'missing' as const
        const team = await sql`
          select t.id as slot_id, u.name as user_name, t.service_name as role, s.name as shoot_name, s.shoot_date::text as shoot_date,
                 coalesce(t.final_cost, t.estimated_cost, 0)::float8 as cost, t.cost_status,
                 coalesce((select sum(ss.amount_paid) from team_slot_settlements ss where ss.slot_id = t.id), 0)::float8 as paid
            from team_assignment_slots t
            join shoots s on s.id = t.shoot_id
            left join users u on u.user_id = t.user_id
           where s.project_id = ${projectId} and t.status not in ('cancelled', 'released')
           order by s.shoot_date nulls last, s.name, u.name`
        const expenses = seeExpenses
          ? await sql`
              select e.id, e.category, e.description, pa.name as party_name, e.expense_date::text as expense_date,
                     expense_cash_out(e)::float8 as amount
                from expenses e
                left join parties pa on pa.id = e.party_id
               where e.project_id = ${projectId}
               order by e.expense_date desc, e.created_at desc`
          : null
        return { value: p.value, team, expenses }
      }),
    )
    if (!data) fail(400, 'We could not load the costs.')
    if (data === 'missing') fail(404, 'That project was not found.')
    const team = (data.team as Record<string, unknown>[]).map(
      (r): Record<string, unknown> => ({ ...r, shoot_date: r['shoot_date'] ? isoDay(r['shoot_date']) : null }),
    )
    const expenses = data.expenses
      ? (data.expenses as Record<string, unknown>[]).map((r): Record<string, unknown> => ({ ...r, expense_date: isoDay(r['expense_date']) }))
      : null
    const round = (n: number) => Math.round(n * 100) / 100
    const teamTotal = round(team.reduce((a, r) => a + Number(r['cost'] ?? 0), 0))
    const teamPaid = round(team.reduce((a, r) => a + Number(r['paid'] ?? 0), 0))
    const expensesTotal = round((expenses ?? []).reduce((a, r) => a + Number(r['amount'] ?? 0), 0))
    const totalCost = round(teamTotal + expensesTotal)
    return c.json(
      projectCostSheet.parse({
        project_value: data.value,
        team,
        expenses,
        team_total: teamTotal,
        team_paid: teamPaid,
        expenses_total: expensesTotal,
        total_cost: totalCost,
        profit: round(data.value - totalCost),
      }),
    )
  })

  // Record a payment against a project.
  .post('/:id/payments', requireAction('projects', 'edit'), async (c) => {
    const parsed = paymentInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the payment details.')
    const auth = c.get('auth')
    const projectId = uuidParam(c)
    const paidOn = parsed.data.paid_on ?? todayInIndia()
    const row = await attempt(c, 'projects.payment_add', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // Tie it to the project's client too, so Billing's client ledger and
        // receipts find it without a second step.
        const owner = await sql<{ client_id: string | null }[]>`select client_id from projects where id = ${projectId}`
        if (!owner.length) return null
        if (parsed.data.invoice_id && !(await invoiceFitsProject(sql, parsed.data.invoice_id, projectId))) return 'bad_invoice' as const
        const rows = await sql<{ id: string }[]>`
          insert into received_payments ${sql({
            project_id: projectId,
            company_id: auth.companyId,
            amount: parsed.data.amount,
            paid_on: paidOn,
            // Billing reads coalesce(date_received, paid_on); keep the two together.
            date_received: paidOn,
            mode: parsed.data.mode ?? null,
            reference: parsed.data.reference ?? null,
            notes: parsed.data.notes ?? parsed.data.description ?? null,
            status: (parsed.data as { status?: string }).status ?? 'paid',
            description: (parsed.data as { description?: string }).description ?? null,
            is_gst: (parsed.data as { is_gst?: boolean }).is_gst ?? false,
            gst_number: (parsed.data as { gst_number?: string }).gst_number ?? null,
            invoice_id: parsed.data.invoice_id ?? null,
            client_id: owner[0]!.client_id,
            recorded_by: auth.userId,
          })}
          returning id`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not record the payment.')
    if (row === 'bad_invoice') fail(422, 'That invoice belongs to another project.')
    await audit(c, { action: 'project.payment', entityType: 'project', entityId: projectId, after: parsed.data })
    return c.json({ id: row.id }, 201)
  })

  /**
   * Change a payment: most often "promised" becoming "received", or a typo in
   * the amount. The project page had no way to do either short of deleting.
   */
  .patch('/:id/payments/:pid', requireAction('projects', 'edit'), async (c) => {
    const parsed = updatePaymentRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the payment details.')
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
    if (Object.keys(patch).length === 0) fail(422, 'Nothing to change.')
    // A row recorded from Billing carries date_received, which Billing reads
    // first; moving only paid_on would leave the old date showing there.
    if (patch.paid_on) patch.date_received = patch.paid_on
    const projectId = uuidParam(c)
    const pid = uuidParam(c, 'pid')
    const rows = await attempt(c, 'projects.payment_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        if (patch.invoice_id && !(await invoiceFitsProject(sql, patch.invoice_id as string, projectId))) return 'bad_invoice' as const
        return sql<{ id: string }[]>`
          update received_payments set ${sql(patch)} where id = ${pid} and project_id = ${projectId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update this payment.')
    if (rows === 'bad_invoice') fail(422, 'That invoice belongs to another project.')
    if (!rows.length) fail(404, 'That payment was not found.')
    await audit(c, { action: 'project.payment_update', entityType: 'project', entityId: projectId, after: { payment_id: pid, ...patch } })
    return c.body(null, 204)
  })

  // Delete a payment (Lovable parity: billing tab receipt management).
  .delete('/:id/payments/:pid', requireAction('projects', 'edit'), async (c) => {
    const projectId = uuidParam(c)
    const pid = uuidParam(c, 'pid')
    const rows = await attempt(c, 'projects.payment_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from received_payments where id = ${pid} and project_id = ${projectId} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this payment.')
    if (!rows.length) fail(404, 'That payment was not found.')
    await audit(c, { action: 'project.payment_delete', entityType: 'project', entityId: projectId, before: { payment_id: pid } })
    return c.body(null, 204)
  })

  // Quotation prefs + terms (persisted on projects; display prefs also cached locally).
  .patch('/:id/quotation', requireAction('projects', 'edit'), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = z.object({
      quotation_terms: z.string().max(10000).nullable().optional(),
      quotation_display_prefs: z.record(z.string(), z.boolean()).optional(),
      show_quotation: z.boolean().optional(),
    }).safeParse(body)
    if (!parsed.success) fail(422, 'Please check the quotation details.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(c, 'projects.quotation_update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update projects set ${sql(parsed.data)} where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not save the quotation.')
    if (!rows.length) fail(404, 'That project was not found.')
    await audit(c, { action: 'project.quotation_update', entityType: 'project', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })
