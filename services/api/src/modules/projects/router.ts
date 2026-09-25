import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  createProjectRequest,
  deliverableInput,
  updateDeliverableRequest,
  setDeliverableStageRequest,
  myDeliverable,
  deliverableNote,
  createDeliverableNoteRequest,
  deliverableSet,
  paymentInput,
  updatePaymentRequest,
  projectDetail,
  projectBilling,
  type PlanInstalment,
  projectListItem,
  projectListPage,
  projectTrackingRow,
  trackingBreakdown,
  saveDeliverableSetRequest,
  updateProjectRequest,
  createProjectTemplateRequest,
  projectTemplateList,
  createShootTypeRequest,
  shootTypeItem,
  deliverableType,
  upsertDeliverableTypeRequest,
  updateDeliverableTypeRequest,
  deliverableStage,
  createDeliverableStageRequest,
  updateDeliverableStageRequest,
  productionBoard,
  bulkDeliverableRequest,
  z,
} from '@ipc/contracts'
import { projectHealth, type ProjectCounters } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/** postgres.js writes `undefined` as a column; leave those out instead. */
function withoutUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** The deliverable trigger's own refusals (0161), said plainly. */
function deliverableRuleBroken(code: string, err: unknown): never | undefined {
  if (code !== '23514') return undefined
  const msg = err instanceof Error ? err.message : ''
  if (msg.includes('shoot')) fail(422, 'That shoot is not part of this project.')
  if (msg.includes('team')) fail(422, 'That person is not on your team.')
  if (msg.includes('stage')) fail(422, 'That stage does not belong to this step. Pick one from the list.')
  return undefined
}

/** A deliverable type as the API names it; the table still says delivery_days (0109). */
const DELIVERABLE_TYPE_COLUMNS = 'id, title, delivery_days as due_days, due_basis, work_days, is_archived'

/** "Colour grading" -> "colour_grading", for a stage's stored code. */
function stageCode(label: string): string {
  const base = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
  return base || 'stage'
}

export const projectsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const url = new URL(c.req.url)
    const hasPaging = url.searchParams.has('page') || url.searchParams.has('page_size') || url.searchParams.has('search') || url.searchParams.has('status') || url.searchParams.has('sort')
    if (!hasPaging) {
      const rows = await attempt(c, 'projects.list', () =>
        withUser(
          c.env,
          c.get('auth').userId,
          // The money is rolled up here rather than fetched per row: the list
          // shows received and pending on every project, and doing that from the
          // client would be one request per project.
          (sql) => sql`
          select p.id, p.name, p.status, p.client_id, p.package_cost, p.total_cost, p.created_at,
                 cl.name as client_name, cl.phone as client_phone,
                 coalesce(
                   (select sum(rp.amount) from received_payments rp where rp.project_id = p.id and coalesce(rp.status, 'paid') = 'paid'),
                   0
                 ) as received,
                 (select min(shoot_date) from shoots where project_id = p.id and shoot_date >= current_date and status <> 'cancelled') as next_shoot_date,
                 coalesce((select count(*)::int from tasks where project_id = p.id and status not in ('completed','cancelled') and due_date is not null and due_date < current_date), 0) as tasks_overdue
          from projects p
          left join clients cl on cl.id = p.client_id
          order by p.created_at desc`,
        ),
      )
      if (!rows) fail(400, 'We could not load your projects.')
      return c.json(projectListItem.array().parse(rows))
    }
    // Paginated + filtered list (Lovable parity): page/page_size + search/status + sort.
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1)
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size') ?? '20') || 20))
    const status = (url.searchParams.get('status') ?? '').trim()
    const search = (url.searchParams.get('search') ?? '').trim()
    const sort = (url.searchParams.get('sort') ?? 'recent').trim()
    const orderBy = (() => {
      switch (sort) {
        case 'oldest': return 'p.created_at asc'
        case 'value_desc': return 'p.total_cost desc'
        case 'pending_desc':
        case 'risk':
        case 'overdue': return '(p.total_cost - coalesce((select sum(rp.amount) from received_payments rp where rp.project_id = p.id and coalesce(rp.status, \'paid\') = \'paid\'),0)) desc'
        case 'received_desc': return 'coalesce((select sum(rp.amount) from received_payments rp where rp.project_id = p.id and coalesce(rp.status, \'paid\') = \'paid\'),0) desc'
        case 'name': return 'p.name asc'
        case 'completion': return 'coalesce((select sum(rp.amount) from received_payments rp where rp.project_id = p.id and coalesce(rp.status, \'paid\') = \'paid\'),0) / nullif(p.total_cost,0) asc'
        case 'upcoming': return '(select min(shoot_date) from shoots where project_id = p.id and shoot_date >= current_date and status <> \'cancelled\') asc nulls last'
        default: return 'p.created_at desc'
      }
    })()
    const offset = (page - 1) * pageSize
    const result = await attempt(c, 'projects.list.page', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        // One pass over everything the search matches: the count and money
        // for the chosen status, and a count per status for the tabs.
        const countRows = await sql<{ status: string; n: number; value: number; received: number }[]>`
          select p.status, count(*)::int as n, coalesce(sum(p.total_cost), 0)::float8 as value,
                 coalesce(sum((select sum(rp.amount) from received_payments rp
                                where rp.project_id = p.id and coalesce(rp.status, 'paid') = 'paid')), 0)::float8 as received
            from projects p
            left join clients cl on cl.id = p.client_id
           where ${search ? sql`(p.name ilike ${'%' + search + '%'} or coalesce(cl.name,'') ilike ${'%' + search + '%'} or coalesce(cl.phone,'') ilike ${'%' + search + '%'})` : sql`true`}
           group by p.status`
        const inFilter = countRows.filter((r) => !status || status === 'all' || r.status === status)
        const total = inFilter.reduce((n, r) => n + r.n, 0)
        const value = inFilter.reduce((n, r) => n + Number(r.value), 0)
        const received = inFilter.reduce((n, r) => n + Number(r.received), 0)
        const summary = { value, received, due: Math.max(0, value - received) }
        const statusCounts = Object.fromEntries(countRows.map((r) => [r.status, r.n]))
        // orderBy is an allow-listed fragment (see switch above), never user input.
        const rows = await sql`
          select p.id, p.name, p.status, p.client_id, p.package_cost, p.total_cost, p.created_at,
                 cl.name as client_name, cl.phone as client_phone,
                 coalesce((select sum(rp.amount) from received_payments rp where rp.project_id = p.id and coalesce(rp.status, 'paid') = 'paid'),0) as received,
                 (select min(shoot_date) from shoots where project_id = p.id and shoot_date >= current_date and status <> 'cancelled') as next_shoot_date,
                 coalesce((select count(*)::int from tasks where project_id = p.id and status not in ('completed','cancelled') and due_date is not null and due_date < current_date),0) as tasks_overdue
          from projects p
          left join clients cl on cl.id = p.client_id
          where ${status && status !== 'all' ? sql`p.status = ${status}` : sql`true`}
            and ${search ? sql`(p.name ilike ${'%' + search + '%'} or coalesce(cl.name,'') ilike ${'%' + search + '%'} or coalesce(cl.phone,'') ilike ${'%' + search + '%'})` : sql`true`}
          order by ${sql.unsafe(orderBy)}
          limit ${pageSize} offset ${offset}`
        return { total, rows, summary, statusCounts }
      }),
    )
    if (!result) fail(400, 'We could not load your projects.')
    return c.json(projectListPage.parse({ items: result.rows, total: result.total, page, page_size: pageSize, summary: result.summary, status_counts: result.statusCounts }))
  })

  // Tracking: one aggregate row per project, counted here and judged by
  // @ipc/domain projectHealth -- on the server, so the page, the dashboard and
  // anything else read one answer. "Today" is the studio's day (India).
  //
  // `/tracking` must be declared before `/:id`, or Hono matches it as an id.
  .get('/tracking', requireAction('projects', 'view'), async (c) => {
    const seesMoney = c.get('auth').access.hasModule('billing')
    const rows = await attempt(c, 'projects.tracking', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<(ProjectCounters & Record<string, unknown>)[]>`
          with today as (select (now() at time zone 'Asia/Kolkata')::date as d)
          select
            p.id, p.name, p.status, p.total_cost, cl.name as client_name,
            coalesce(t.total, 0)::int        as tasks_total,
            coalesce(t.done, 0)::int         as tasks_done,
            coalesce(t.overdue, 0)::int      as tasks_overdue,
            coalesce(d.total, 0)::int        as deliverables_total,
            coalesce(d.done, 0)::int         as deliverables_done,
            coalesce(d.late, 0)::int         as deliverables_late,
            coalesce(d.with_client, 0)::int  as deliverables_with_client,
            d.next_due                       as next_due_date,
            coalesce((select sum(rp.amount) from received_payments rp
                       where rp.project_id = p.id and coalesce(rp.status, 'paid') = 'paid'), 0) as received,
            coalesce(inv.n, 0)::int          as invoices_overdue,
            coalesce(inv.amount, 0)          as overdue_amount,
            coalesce(dr.total, 0)::int       as data_records_total,
            coalesce(dr.unsafe, 0)::int      as data_records_unverified,
            coalesce(dr.issues, 0)::int      as data_issues,
            coalesce(dm.n, 0)::int           as data_missing,
            coalesce(w.pending, 0)::int      as pending_reviews,
            coalesce(sh.total, 0)::int       as shoots_total,
            coalesce(sh.done, 0)::int        as shoots_done,
            coalesce(short.n, 0)::int        as shoots_short,
            sh.next_shoot_date,
            greatest(p.updated_at, t.last_touch, d.last_touch, sh.last_touch, dr.last_touch) as last_activity_at
          from projects p
          cross join today
          left join clients cl on cl.id = p.client_id
          left join lateral (
            -- A task done for a deliverable is part of that deliverable, not
            -- more work on top: counting both would count it twice.
            select count(*) filter (where status <> 'cancelled') as total,
                   count(*) filter (where status = 'completed') as done,
                   count(*) filter (
                     where status not in ('completed', 'cancelled')
                       and due_date is not null and due_date < today.d
                   ) as overdue,
                   max(updated_at) as last_touch
            from tasks where project_id = p.id and deliverable_id is null
          ) t on true
          left join lateral (
            select count(*) filter (where status <> 'cancelled') as total,
                   count(*) filter (where status = 'completed') as done,
                   count(*) filter (
                     where status not in ('completed', 'cancelled', 'review')
                       and estimated_date is not null and estimated_date < today.d
                   ) as late,
                   -- Sent to the client and waiting on them: not late on us.
                   count(*) filter (where status = 'review') as with_client,
                   min(estimated_date) filter (where status not in ('completed', 'cancelled')) as next_due,
                   max(updated_at) as last_touch
            from deliverables where project_id = p.id
          ) d on true
          left join lateral (
            -- The data board's words: not in two places yet, or with a problem.
            -- A record marked not needed is not owed.
            select count(*) as total,
                   count(*) filter (where data_status in ('with_shooter', 'received', 'copied')) as unsafe,
                   count(*) filter (where data_status = 'issue') as issues,
                   max(updated_at) as last_touch
            from shoot_data_records where project_id = p.id and shoot_id is not null
          ) dr on true
          left join lateral (
            -- Crew who owe data and handed in none -- invisible to a count of records.
            select count(*) as n
              from team_assignment_slots ts
              join shoots s2 on s2.id = ts.shoot_id
             where s2.project_id = p.id and ts.status = 'booked' and s2.status <> 'cancelled'
               and coalesce(s2.shoot_date, (ts.start_at at time zone 'Asia/Kolkata')::date) < today.d
               and not (not ts.data_required and nullif(btrim(ts.data_not_required_reason), '') is not null)
               and not exists (select 1 from shoot_data_records r where r.slot_id = ts.id)
          ) dm on true
          left join lateral (
            select count(*) filter (where status = 'submitted') as pending
            from team_work_submissions where project_id = p.id
          ) w on true
          left join lateral (
            select count(*) as total,
                   count(*) filter (where status = 'completed') as done,
                   min(shoot_date) filter (where shoot_date >= today.d) as next_shoot_date,
                   max(updated_at) as last_touch
            from shoots where project_id = p.id and status <> 'cancelled'
          ) sh on true
          left join lateral (
            -- Upcoming shoots with fewer people booked than their roles need.
            select count(*) as n
              from shoots s3
             where s3.project_id = p.id and s3.status not in ('cancelled', 'completed')
               and s3.shoot_date >= today.d
               and coalesce((select sum(quantity) from shoot_services ss where ss.shoot_id = s3.id), 0)
                   > (select count(*) from team_assignment_slots ts where ts.shoot_id = s3.id and ts.status = 'booked')
          ) short on true
          left join lateral (
            select count(*) as n, sum(balance_due) as amount
              from invoices i
             where i.project_id = p.id and i.status not in ('draft', 'paid', 'cancelled')
               and i.balance_due > 0 and i.due_date is not null and i.due_date < today.d
          ) inv on true
          where p.status <> 'cancelled'
          order by p.created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load project tracking.')
    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
    const out = rows.map((r) => {
      const counters = { ...r, total_cost: Number(r.total_cost ?? 0), received: Number(r.received ?? 0) }
      const health = projectHealth(counters as ProjectCounters, today)
      // Money only for someone who can see Billing -- the invoice count stays,
      // since "an invoice is overdue" is a reason, not an amount.
      return {
        ...counters,
        total_cost: seesMoney ? counters.total_cost : null,
        received: seesMoney ? counters.received : null,
        overdue_amount: seesMoney ? Number(r.overdue_amount ?? 0) : null,
        health,
      }
    })
    return c.json(projectTrackingRow.array().parse(out))
  })

  // One project opened up: what is late or waiting, on whom, the shoots and
  // their crew and data, and (for Billing) the money.
  .get('/tracking/:id', requireAction('projects', 'view'), async (c) => {
    const id = uuidParam(c)
    const seesMoney = c.get('auth').access.hasModule('billing')
    const result = await attempt(c, 'projects.tracking.one', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const today = sql`(now() at time zone 'Asia/Kolkata')::date`
        const [project] = await sql<{ id: string; total_cost: number }[]>`select id, total_cost from projects where id = ${id}`
        if (!project) return null
        const deliverables = await sql`
          select d.id, d.title,
                 coalesce(cs.label, initcap(replace(d.status::text, '_', ' '))) as stage,
                 u.name as assignee_name, d.estimated_date,
                 greatest(0, ${today} - d.estimated_date)::int as days_late
            from deliverables d
            left join company_deliverable_statuses cs on cs.company_id = d.company_id and cs.code = d.custom_status_code
            left join users u on u.user_id = d.assignee_id
           where d.project_id = ${id} and d.status not in ('completed', 'cancelled')
           order by d.estimated_date nulls last, d.title
           limit 50`
        const tasks = await sql`
          select t.id, t.title, t.due_date, greatest(0, ${today} - t.due_date)::int as days_late,
                 coalesce(array_agg(u.name order by u.name) filter (where u.user_id is not null), '{}') as assignee_names
            from tasks t
            left join task_assignees a on a.task_id = t.id
            left join users u on u.user_id = a.user_id
           where t.project_id = ${id} and t.status not in ('completed', 'cancelled')
             and t.due_date is not null and t.due_date < ${today}
           group by t.id
           order by t.due_date
           limit 50`
        const submissions = await sql`
          select w.id, coalesce(w.title, d.title) as title, u.name as submitted_by_name, w.created_at
            from team_work_submissions w
            left join deliverables d on d.id = w.deliverable_id
            left join users u on u.user_id = w.submitted_by
           where w.project_id = ${id} and w.status = 'submitted'
           order by w.created_at
           limit 50`
        const shoots = await sql`
          select s.id, s.name, s.shoot_date,
                 coalesce((select sum(quantity) from shoot_services ss where ss.shoot_id = s.id), 0)::int as needed,
                 (select count(*) from team_assignment_slots ts where ts.shoot_id = s.id and ts.status = 'booked')::int as booked,
                 (select count(*) from team_assignment_slots ts
                   where ts.shoot_id = s.id and ts.status = 'booked'
                     and coalesce(s.shoot_date, (ts.start_at at time zone 'Asia/Kolkata')::date) < ${today}
                     and not (not ts.data_required and nullif(btrim(ts.data_not_required_reason), '') is not null)
                     and not exists (select 1 from shoot_data_records r where r.slot_id = ts.id))::int as data_missing,
                 (select count(*) from shoot_data_records r
                   where r.shoot_id = s.id and r.data_status in ('with_shooter', 'received', 'copied', 'issue'))::int as data_unsafe
            from shoots s
           where s.project_id = ${id} and s.status <> 'cancelled'
           order by s.shoot_date nulls last, s.name`
        let money = null
        if (seesMoney) {
          const [m] = await sql<{ received: number }[]>`
            select coalesce(sum(amount), 0) as received from received_payments
             where project_id = ${id} and coalesce(status, 'paid') = 'paid'`
          const overdue = await sql`
            select id, invoice_number, due_date, balance_due from invoices
             where project_id = ${id} and status not in ('draft', 'paid', 'cancelled')
               and balance_due > 0 and due_date is not null and due_date < ${today}
             order by due_date`
          const total = Number(project.total_cost ?? 0)
          const received = Number(m?.received ?? 0)
          money = { total_cost: total, received, balance: Math.max(0, total - received), invoices_overdue: overdue }
        }
        return { deliverables, tasks, submissions, shoots, money }
      }),
    )
    if (result === null) fail(404, 'That project was not found.')
    if (!result) fail(400, 'We could not load this project.')
    return c.json(trackingBreakdown.parse(result))
  })

  .post('/', requireAction('projects', 'create'), async (c) => {
    const parsed = createProjectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project details and try again.')
    const d = parsed.data
    const id = await attempt(c, 'projects.create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          select create_project_with_details(
            p_client_id => ${d.client_id},
            p_name => ${d.name},
            p_package_cost => ${d.package_cost},
            p_status => ${d.status},
            p_show_quotation => ${d.show_quotation},
            p_deliverables => ${sql.json(d.deliverables)},
            p_payments => ${sql.json(d.payments)}
          ) as id`
        return rows[0]?.id ?? null
      }),
    )
    if (!id) fail(400, 'We could not create this project.')
    await audit(c, {
      action: 'project.create',
      entityType: 'project',
      entityId: id,
      after: { name: d.name, client_id: d.client_id, package_cost: d.package_cost, status: d.status },
    })
    return c.json({ id }, 201)
  })

  // Declared above /:id so "deliverable-sets" is never read as a project id.
  .get('/deliverable-sets', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'projects.sets.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select id, name, items from deliverable_sets order by name asc`,
      ),
    )
    if (!rows) fail(400, 'We could not load your saved sets.')
    return c.json(deliverableSet.array().parse(rows))
  })

  .post('/deliverable-sets', requireAction('projects', 'edit'), async (c) => {
    const parsed = saveDeliverableSetRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the set and give it at least one item.')
    const auth = c.get('auth')
    const row = await attempt(c, 'projects.sets.save', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // Saving under a name that exists replaces it — a studio revising
        // "Premium" means the package changed, not that there are two of them.
        const rows = await sql`
          insert into deliverable_sets ${sql({
            company_id: auth.companyId,
            name: parsed.data.name,
            items: sql.json(parsed.data.items),
          })}
          on conflict (company_id, name) do update set items = excluded.items
          returning id, name, items`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save the set.')
    return c.json(deliverableSet.parse(row), 201)
  })

  .delete('/deliverable-sets/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'projects.sets.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from deliverable_sets where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete the set.')
    if (!rows.length) fail(404, 'That set was not found.')
    return c.body(null, 204)
  })

  // ── Project Templates (declared before /:id so static path is not captured as an id)
  .get('/templates', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'projects.templates_list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, company_id, name, description, deliverables_json, shoots_json, tasks_json, created_at
          from project_templates
         where company_id = ${c.get('auth').companyId}
         order by created_at desc`),
    )
    if (!rows) fail(400, 'We could not load templates.')
    return c.json(projectTemplateList.parse({ items: rows }))
  })

  .post('/templates', requireAction('projects', 'edit'), async (c) => {
    const parsed = createProjectTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'projects.template_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const made = await sql<{ id: string }[]>`
          insert into project_templates (company_id, name, description, deliverables_json, shoots_json, tasks_json, created_by)
          values (${auth.companyId}, ${d.name}, ${d.description ?? null},
                  ${sql.json(d.deliverables_json)},
                  ${sql.json(d.shoots_json)},
                  ${sql.json(d.tasks_json)},
                  ${auth.userId})
          returning id`
        return made
      }),
    )
    if (!rows?.[0]) fail(400, 'We could not create this template.')
    await audit(c, { action: 'project_template.create', entityType: 'project_template', entityId: rows[0].id, after: { name: d.name } })
    return c.json({ id: rows[0].id }, 201)
  })

  .patch('/templates/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = createProjectTemplateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the template details.')
    const auth = c.get('auth')
    const d = parsed.data
    const rows = await attempt(c, 'projects.template_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          update project_templates
             set name = ${d.name}, description = ${d.description ?? null},
                 deliverables_json = ${sql.json(d.deliverables_json)},
                 shoots_json = ${sql.json(d.shoots_json)},
                 tasks_json = ${sql.json(d.tasks_json)}
           where id = ${id} and company_id = ${auth.companyId}
           returning id`
      }),
    )
    if (!rows) fail(400, 'We could not save this template.')
    if (!rows.length) fail(404, 'We could not find that template.')
    await audit(c, { action: 'project_template.update', entityType: 'project_template', entityId: id, after: d })
    return c.json({ ok: true })
  })

  .delete('/templates/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const rows = await attempt(c, 'projects.template_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        return sql<{ id: string }[]>`
          delete from project_templates where id = ${id} and company_id = ${auth.companyId} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this template.')
    if (!rows.length) fail(404, 'We could not find that template.')
    await audit(c, { action: 'project_template.delete', entityType: 'project_template', entityId: id })
    return c.json({ ok: true })
  })

  .post('/templates/:id/apply', requireAction('projects', 'edit'), async (c) => {
    const templateId = uuidParam(c)
    const body = await c.req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) fail(422, 'Project name is required.')
    // Validate optional client_id/start_date rather than letting Postgres throw 22P02
    if (body.client_id != null) {
      const uc = z.string().uuid().safeParse(body.client_id)
      if (!uc.success) fail(422, 'Invalid client ID.')
    }
    if (body.start_date != null) {
      const dc = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(body.start_date)
      if (!dc.success) fail(422, 'Invalid start date.')
    }
    const auth = c.get('auth')
    if (body.client_id == null) fail(422, 'Pick a client for this project.')
    const rows = await attempt(
      c,
      'projects.template_apply',
      () => withUser(c.env, auth.userId, async (sql) => {
        const result = await sql<{ create_project_from_template: string }[]>`
          select create_project_from_template(
            p_template_id => ${templateId}::uuid,
            p_name => ${name},
            p_client_id => ${body.client_id ?? null}::uuid,
            p_start_date => ${body.start_date ?? null}::date
          ) as create_project_from_template`
        return result
      }),
      { onCode: (code) => (code === '23514' ? fail(422, 'Pick a client for this project.') : undefined) },
    )
    if (!rows?.[0]) fail(400, 'We could not create the project from this template.')
    await audit(c, { action: 'project_template.apply', entityType: 'project_template', entityId: templateId, after: { project_id: rows[0].create_project_from_template } })
    return c.json({ project_id: rows[0].create_project_from_template }, 201)
  })

  // Board deliverables: every deliverable with project context (for the production board).
  // Declared before /:id so "board" is never read as a project id.
  /**
   * The production board: every deliverable in flight across the studio, the
   * stages it moves through, and the people who carry it. Open work plus what
   * was delivered in the last fortnight; the counts cover all open work even
   * when the list is capped.
   */
  .get('/board', requireAction('projects', 'view'), async (c) => {
    const data = await attempt(c, 'projects.board', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const stages = await sql`
          select id, code, label, stage, color, team_allowed, sort_order
            from company_deliverable_statuses
           where stage is not null and scope in ('deliverable', 'both')
           order by array_position(array['pending','in_progress','review','completed'], stage), sort_order, label`
        const items = await sql`
          select d.id, d.project_id, p.name as project_name, cl.name as client_name,
                 d.title, d.description, d.status, d.custom_status_code, d.estimated_date,
                 d.delivered_at, d.delivery_link, d.visibility_scope,
                 d.shoot_id, s.name as shoot_name, s.shoot_date,
                 d.assignee_id, u.name as assignee_name,
                 (select count(*)::int from deliverable_notes n where n.deliverable_id = d.id and n.kind <> 'event') as notes_count,
                 (select count(*)::int from deliverable_notes n where n.deliverable_id = d.id and n.kind = 'voice') as voice_count,
                 la.created_at as last_activity_at, la.author_name as last_activity_by,
                 la.kind as last_activity_kind, la.body as last_activity_body
            from deliverables d
            join projects p on p.id = d.project_id
            left join clients cl on cl.id = p.client_id
            left join shoots s on s.id = d.shoot_id
            left join users u on u.user_id = d.assignee_id
            left join lateral (
              select n.created_at, n.kind, n.body, a.name as author_name
                from deliverable_notes n left join users a on a.user_id = n.author_id
               where n.deliverable_id = d.id
               order by n.created_at desc limit 1
            ) la on true
           where p.status <> 'cancelled'
             and (d.status not in ('cancelled', 'completed')
                  -- Delivered in the last fortnight: years of history must
                  -- not crowd today's work out of the limit.
                  or (d.status = 'completed' and d.delivered_at > now() - interval '14 days'))
           order by (d.status = 'completed'), d.estimated_date nulls last, d.created_at
           limit 1000`
        const counts = await sql<{ open: number; late: number; due_today: number; in_review: number; unassigned: number; dropped: number }[]>`
          select count(*) filter (where d.status not in ('completed', 'cancelled'))::int as open,
                 count(*) filter (where d.status not in ('completed', 'cancelled') and d.estimated_date < current_date)::int as late,
                 count(*) filter (where d.status not in ('completed', 'cancelled') and d.estimated_date = current_date)::int as due_today,
                 count(*) filter (where d.status = 'review')::int as in_review,
                 count(*) filter (where d.status not in ('completed', 'cancelled') and d.assignee_id is null)::int as unassigned,
                 count(*) filter (where d.status = 'cancelled' and d.updated_at > now() - interval '14 days')::int as dropped
            from deliverables d
            join projects p on p.id = d.project_id
           where p.status <> 'cancelled'`
        const people = await sql`
          select u.user_id, u.name, u.role,
                 exists (
                   select 1 from team_assignment_slots t
                    where t.user_id = u.user_id and t.status = 'booked'
                      and t.start_at < (current_date + 1)::timestamptz and t.end_at > current_date::timestamptz
                 ) as on_shoot_today,
                 (select count(*)::int from task_assignees ta join tasks tk on tk.id = ta.task_id
                   where ta.user_id = u.user_id and tk.status in ('to_do', 'in_progress')) as open_tasks
            from users u
           where u.deleted_at is null and u.status = 'active' and u.role <> 'super_admin'
           order by u.name`
        const c0 = counts[0]!
        const openListed = items.filter((i) => i.status !== 'completed').length
        return { stages, items, people, counts: { ...c0, truncated: openListed < c0.open } }
      }),
    )
    if (!data) fail(400, 'We could not load the production board.')
    return c.json(productionBoard.parse(data))
  })

  /**
   * One change to many deliverables: hand them to an editor, move them to a
   * stage, or give them a due date. The same rules as one at a time -- the
   * database checks each row as it is written.
   */
  .post('/deliverables/bulk', requireAction('projects', 'edit'), async (c) => {
    const parsed = bulkDeliverableRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check what to change.')
    const { ids, assignee_id, stage, estimated_date } = parsed.data
    const outcome = await attempt(
      c,
      'projects.deliverables_bulk',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          let patch: Record<string, unknown>
          if (stage) {
            const code = stage.custom_status_code || null
            if (code) {
              const st = await sql<{ stage: string | null }[]>`
                select stage from company_deliverable_statuses where code = ${code}`
              if (!st[0] || st[0].stage !== stage.status) return 'bad_stage' as const
            }
            patch = { status: stage.status, custom_status_code: code }
          } else if (assignee_id !== undefined) {
            patch = { assignee_id }
          } else {
            patch = { estimated_date: estimated_date ?? null }
          }
          const rows = await sql<{ id: string }[]>`
            update deliverables set ${sql(patch)} where id = any(${ids}::uuid[]) returning id`
          return rows.length
        }),
      { onCode: deliverableRuleBroken },
    )
    if (outcome === 'bad_stage') fail(422, 'That stage does not belong to this step. Pick one from the list.')
    if (outcome === null || outcome === undefined) fail(400, 'We could not update the deliverables.')
    await audit(c, { action: 'deliverable.bulk', entityType: 'deliverable', entityId: ids[0]!, after: parsed.data })
    return c.json({ updated: outcome })
  })

  // Granular catalog: shoot types / deliverable templates / workflow presets.
  // Kept separate from generic project_templates (which stays as apply-with-start-date).
  .get('/catalog/shoot-types', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'projects.catalog.shoot_types.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, name, category, usage_count, is_archived from shoot_types order by usage_count desc, name asc`),
    )
    if (!rows) fail(400, 'We could not load shoot types.')
    return c.json(shootTypeItem.array().parse(rows))
  })

  .post('/catalog/shoot-types', requireAction('projects', 'edit'), async (c) => {
    const parsed = createShootTypeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the shoot type.')
    const auth = c.get('auth')
    const row = await attempt(c, 'projects.catalog.shoot_types.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`insert into shoot_types ${sql({ company_id: auth.companyId, name: parsed.data.name, category: parsed.data.category ?? null })} returning id, name, category, usage_count, is_archived`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not add this shoot type.')
    await audit(c, { action: 'shoot_type.create', entityType: 'shoot_type', entityId: row.id, after: parsed.data })
    return c.json(shootTypeItem.parse(row), 201)
  })

  /**
   * The studio's deliverable types: what it delivers, when the client gets
   * it, and how many days the work needs. Archived ones come back too, last,
   * so a screen can offer to bring one back.
   */
  .get('/catalog/deliverable-types', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'projects.catalog.deliverable_types.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select ${sql.unsafe(DELIVERABLE_TYPE_COLUMNS)} from deliverable_templates
         order by is_archived, lower(btrim(title))`),
    )
    if (!rows) fail(400, 'We could not load your deliverable types.')
    return c.json(deliverableType.array().parse(rows))
  })

  // Adding a name that is already on the list (any case) hands back that one
  // rather than a second "Album". An archived one is brought back with what
  // was just typed; a live one is left as it is -- adding is not editing.
  .post('/catalog/deliverable-types', requireAction('projects', 'edit'), async (c) => {
    const parsed = upsertDeliverableTypeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the deliverable type.')
    const auth = c.get('auth')
    const d = parsed.data
    // Only what was typed: a blank box bringing an archived type back must not
    // wipe the number it had.
    const fields = Object.fromEntries(
      Object.entries({ delivery_days: d.due_days, due_basis: d.due_basis, work_days: d.work_days }).filter(
        ([, v]) => v !== null && v !== undefined,
      ),
    )
    const result = await attempt(
      c,
      'projects.catalog.deliverable_types.add',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const [same] = await sql<{ id: string; is_archived: boolean }[]>`
            select id, is_archived from deliverable_templates
             where lower(btrim(title)) = lower(btrim(${d.title}))
             order by is_archived, created_at desc
             limit 1`
          if (same && !same.is_archived) {
            const rows = await sql`
              select ${sql.unsafe(DELIVERABLE_TYPE_COLUMNS)} from deliverable_templates where id = ${same.id}`
            return rows[0] ? { row: rows[0], existed: true } : null
          }
          const rows = same
            ? await sql`
                update deliverable_templates set ${sql({ ...fields, is_archived: false })}
                 where id = ${same.id}
                 returning ${sql.unsafe(DELIVERABLE_TYPE_COLUMNS)}`
            : await sql`
                insert into deliverable_templates ${sql({ ...fields, company_id: auth.companyId, title: d.title })}
                returning ${sql.unsafe(DELIVERABLE_TYPE_COLUMNS)}`
          return rows[0] ? { row: rows[0], existed: !!same } : null
        }),
      { onCode: (code) => (code === '23505' ? fail(409, 'That deliverable is already on your list.') : undefined) },
    )
    if (!result) fail(400, 'We could not add that deliverable type.')
    const saved = deliverableType.parse(result.row)
    await audit(c, { action: 'deliverable_type.create', entityType: 'deliverable_type', entityId: saved.id, after: d })
    return c.json(saved, result.existed ? 200 : 201)
  })

  .patch('/catalog/deliverable-types/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = updateDeliverableTypeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the deliverable type.')
    const { due_days, ...rest } = parsed.data
    // The API says due_days, the table says delivery_days (0109). Null clears.
    const patch = withoutUndefined({ ...rest, delivery_days: due_days })
    if (!Object.keys(patch).length) fail(422, 'Nothing to change.')
    const rows = await attempt(
      c,
      'projects.catalog.deliverable_types.update',
      () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql`
          update deliverable_templates set ${sql(patch)} where id = ${id}
          returning ${sql.unsafe(DELIVERABLE_TYPE_COLUMNS)}`),
      { onCode: (code) => (code === '23505' ? fail(409, 'You already have a deliverable type with that name.') : undefined) },
    )
    if (!rows) fail(400, 'We could not save that change.')
    if (!rows.length) fail(404, 'That deliverable type was not found.')
    await audit(c, { action: 'deliverable_type.update', entityType: 'deliverable_type', entityId: id, after: parsed.data })
    return c.json(deliverableType.parse(rows[0]))
  })

  // Archived, never deleted: adding the name again brings it back with its numbers.
  .delete('/catalog/deliverable-types/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'projects.catalog.deliverable_types.archive', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update deliverable_templates set is_archived = true where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not archive that deliverable type.')
    if (!rows.length) fail(404, 'That deliverable type was not found.')
    await audit(c, { action: 'deliverable_type.archive', entityType: 'deliverable_type', entityId: id })
    return c.body(null, 204)
  })

  /**
   * The studio's named stages, step by step. Anyone in the studio reads them:
   * an editor's own list shows them too.
   */
  .get('/stages', async (c) => {
    const rows = await attempt(c, 'projects.stages', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, code, label, stage, color, team_allowed, sort_order
          from company_deliverable_statuses
         where stage is not null and scope in ('deliverable', 'both')
         order by array_position(array['pending','in_progress','review','completed'], stage), sort_order, label`),
    )
    if (!rows) fail(400, 'We could not load the stages.')
    return c.json(deliverableStage.array().parse(rows))
  })

  .post('/stages', requireAction('projects', 'edit'), async (c) => {
    const parsed = createDeliverableStageRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the stage.')
    const s = parsed.data
    const category = s.stage === 'pending' ? 'to_do' : s.stage === 'completed' ? 'completed' : 'in_progress'
    const row = await attempt(c, 'projects.stage_add', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const taken = await sql<{ code: string }[]>`select code from company_deliverable_statuses`
        const have = new Set(taken.map((t) => t.code))
        let code = stageCode(s.label)
        for (let n = 2; have.has(code); n++) code = `${stageCode(s.label).slice(0, 27)}_${n}`
        const [next] = await sql<{ n: number }[]>`
          select coalesce(max(sort_order), 0)::int + 10 as n
            from company_deliverable_statuses where stage = ${s.stage}`
        const rows = await sql`
          insert into company_deliverable_statuses
            (company_id, code, label, scope, category, stage, color, team_allowed, sort_order)
          values (get_current_company_id(), ${code}, ${s.label}, 'deliverable', ${category}::task_status,
                  ${s.stage}, ${s.color}, ${s.team_allowed}, ${next?.n ?? 10})
          returning id, code, label, stage, color, team_allowed, sort_order`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not add that stage.')
    await audit(c, { action: 'deliverable_stage.create', entityType: 'deliverable_stage', entityId: String(row.id), after: s })
    return c.json(deliverableStage.parse(row), 201)
  })

  .patch('/stages/:sid', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateDeliverableStageRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the stage.')
    const sid = uuidParam(c, 'sid')
    const patch = withoutUndefined(parsed.data)
    if (!Object.keys(patch).length) fail(422, 'Nothing to change.')
    const rows = await attempt(c, 'projects.stage_update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        update company_deliverable_statuses set ${sql(patch)}
         where id = ${sid} and stage is not null
         returning id, code, label, stage, color, team_allowed, sort_order`),
    )
    if (!rows) fail(400, 'We could not change that stage.')
    if (!rows.length) fail(404, 'That stage was not found.')
    return c.json(deliverableStage.parse(rows[0]))
  })

  /** Remove a stage. Deliverables on it stay in their step, unnamed. */
  .delete('/stages/:sid', requireAction('projects', 'edit'), async (c) => {
    const sid = uuidParam(c, 'sid')
    const rows = await attempt(c, 'projects.stage_delete', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const found = await sql<{ code: string }[]>`
          select code from company_deliverable_statuses where id = ${sid} and stage is not null`
        const code = found[0]?.code
        if (!code) return []
        await sql`update deliverables set custom_status_code = null where custom_status_code = ${code}`
        return sql`delete from company_deliverable_statuses where id = ${sid} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not remove that stage.')
    if (!rows.length) fail(404, 'That stage was not found.')
    await audit(c, { action: 'deliverable_stage.delete', entityType: 'deliverable_stage', entityId: sid })
    return c.body(null, 204)
  })

  /**
   * What the caller is editing: every open deliverable they are the editor on,
   * soonest due first. Any member -- an editor need not see whole projects to
   * see their own work. Each says whether it was sent back, what the reviewer
   * said and the last version handed in (0180), so a revision is one tap.
   */
  .get('/deliverables/mine', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'projects.deliverables_mine', () =>
      withUser(c.env, auth.userId, (sql) => sql`
        select d.id, d.project_id, p.name as project_name, cl.name as client_name,
               d.title, d.description, d.status, d.estimated_date, s.name as shoot_name,
               d.delivery_link, d.visibility_scope, d.custom_status_code,
               (select count(*)::int from deliverable_notes n where n.deliverable_id = d.id and n.kind <> 'event') as notes_count,
               (select count(*)::int from deliverable_notes n where n.deliverable_id = d.id and n.kind = 'voice') as voice_count,
               -- The studio's own work days for this name, when it has set them (0179).
               company_start_by(${auth.companyId}::uuid, d.estimated_date, d.title, d.delivery_days_after_start) as start_by,
               company_work_days(${auth.companyId}::uuid, d.title, d.delivery_days_after_start) as work_days,
               d.started_at,
               coalesce(rv.changes_requested, false) as changes_requested, rv.review_note, rv.last_version
        from deliverables d
        join projects p on p.id = d.project_id
        left join clients cl on cl.id = p.client_id
        left join shoots s on s.id = d.shoot_id
        left join lateral deliverable_revision_state(d.id) rv on true
        where d.assignee_id = ${auth.userId} and d.status not in ('completed', 'cancelled')
        order by d.estimated_date nulls last, d.created_at
        limit 200`),
    )
    if (!rows) fail(400, 'We could not load your deliverables.')
    return c.json(myDeliverable.array().parse(rows))
  })

  // The editor on it says "I've started" -- which stops the start reminders.
  .post('/deliverables/:did/start', async (c) => {
    const id = uuidParam(c, 'did')
    const ok = await attempt(
      c,
      'projects.deliverables_start',
      () => withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select start_deliverable(${id})`
        return true
      }),
      { onCode: (code) => (code === 'P0002' ? fail(404, 'That deliverable was not found.') : undefined) },
    )
    if (!ok) fail(400, 'We could not start that.')
    await audit(c, { action: 'deliverable.start', entityType: 'deliverable', entityId: id })
    return c.body(null, 204)
  })

  /**
   * Move a deliverable to a stage, with the link that was sent. The editor on
   * it may do this as well as anyone who can edit projects.
   */
  .post('/deliverables/:did/stage', async (c) => {
    const parsed = setDeliverableStageRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please pick a stage.')
    const did = uuidParam(c, 'did')
    const auth = c.get('auth')
    const canEdit = auth.access.hasAction('projects', 'edit')
    const outcome = await attempt(c, 'projects.deliverable_stage', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const found = await sql<{ project_id: string; assignee_id: string | null }[]>`
          select project_id, assignee_id from deliverables where id = ${did}`
        const d = found[0]
        if (!d) return 'missing' as const
        if (!canEdit && d.assignee_id !== auth.userId) return 'forbidden' as const
        const code = parsed.data.custom_status_code || null
        if (code) {
          const st = await sql<{ stage: string | null; team_allowed: boolean }[]>`
            select stage, team_allowed from company_deliverable_statuses where code = ${code}`
          if (!st[0] || st[0].stage !== parsed.data.status) return 'bad_stage' as const
          // The editor picks from the stages the studio lets the team use;
          // "Approved" and the like are for whoever reviews.
          if (!canEdit && !st[0].team_allowed) return 'not_team' as const
        }
        const patch: Record<string, unknown> = { status: parsed.data.status, custom_status_code: code }
        if (parsed.data.delivery_link !== undefined) patch.delivery_link = parsed.data.delivery_link || null
        await sql`update deliverables set ${sql(patch)} where id = ${did}`
        return d.project_id
      }),
    )
    if (outcome === 'missing') fail(404, 'That deliverable was not found.')
    if (outcome === 'forbidden') fail(403, 'Only the editor on it, or a manager, can move this.')
    if (outcome === 'bad_stage') fail(422, 'That stage does not belong to this step. Pick one from the list.')
    if (outcome === 'not_team') fail(403, 'A manager moves it to that stage.')
    if (!outcome) fail(400, 'We could not update the deliverable.')
    await audit(c, {
      action: 'deliverable.stage',
      entityType: 'project',
      entityId: outcome,
      after: { deliverable_id: did, ...parsed.data },
    })
    return c.body(null, 204)
  })

  /**
   * A deliverable's timeline: notes, voice notes and stage changes, oldest
   * first, read like a conversation. Anyone in the studio who can see the
   * deliverable can read it; RLS keeps it to the studio.
   */
  .get('/deliverables/:did/notes', async (c) => {
    const did = uuidParam(c, 'did')
    const rows = await attempt(c, 'projects.deliverable_notes', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const found = await sql`select 1 from deliverables where id = ${did}`
        if (!found.length) return null
        return sql`
          select n.id, n.deliverable_id, n.kind, n.body, n.file_id, n.duration_seconds,
                 n.author_id, u.name as author_name, n.created_at, w.submission_link as link
            from deliverable_notes n
            left join users u on u.user_id = n.author_id
            -- submitted:<id>, approved:<id>, sent_back:<id>: the work's link.
            left join team_work_submissions w
              on n.kind = 'event'
             and n.body ~ '^(submitted|resubmitted|approved|sent_back|sent_to_client):[0-9a-f-]{36}$'
             and w.id = split_part(n.body, ':', 2)::uuid
           where n.deliverable_id = ${did}
           order by n.created_at, n.id`
      }),
    )
    if (rows === null) fail(404, 'That deliverable was not found.')
    if (!rows) fail(400, 'We could not load the notes.')
    return c.json(deliverableNote.array().parse(rows))
  })

  /**
   * Leave a written or voice note. Same rule as moving the stage: the editor
   * on it, or anyone who can edit projects. The database tells the other side.
   */
  .post('/deliverables/:did/notes', async (c) => {
    const parsed = createDeliverableNoteRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the note.')
    const did = uuidParam(c, 'did')
    const auth = c.get('auth')
    const canEdit = auth.access.hasAction('projects', 'edit')
    const n = parsed.data
    const outcome = await attempt(
      c,
      'projects.deliverable_note_add',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const found = await sql<{ assignee_id: string | null }[]>`
            select assignee_id from deliverables where id = ${did}`
          const d = found[0]
          if (!d) return 'missing' as const
          if (!canEdit && d.assignee_id !== auth.userId) return 'forbidden' as const
          const rows = await sql`
            insert into deliverable_notes (deliverable_id, kind, body, file_id, duration_seconds, author_id)
            values (${did}, ${n.kind}, ${n.body ?? null},
                    ${n.kind === 'voice' ? n.file_id : null},
                    ${n.kind === 'voice' ? (n.duration_seconds ?? null) : null}, ${auth.userId})
            returning id, deliverable_id, kind, body, file_id, duration_seconds, author_id, created_at`
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '42501' ? fail(403, 'That recording is not one of this studio’s files.') : undefined) },
    )
    if (outcome === 'missing') fail(404, 'That deliverable was not found.')
    if (outcome === 'forbidden') fail(403, 'Only the editor on it, or a manager, can leave notes here.')
    if (!outcome) fail(400, 'We could not save the note.')
    await audit(c, { action: `deliverable.note.${n.kind}`, entityType: 'deliverable', entityId: did })
    return c.json(deliverableNote.parse({ ...outcome, author_name: null }), 201)
  })

  /** Take a note back: its author, or an admin or manager. Stage events stay. */
  .delete('/deliverables/notes/:nid', async (c) => {
    const nid = uuidParam(c, 'nid')
    const rows = await attempt(c, 'projects.deliverable_note_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`delete from deliverable_notes where id = ${nid} returning id`),
    )
    if (!rows) fail(400, 'We could not delete the note.')
    if (!rows.length) fail(404, 'That note was not found, or it is not yours to delete.')
    return c.body(null, 204)
  })

  .get('/:id', requireAction('projects', 'view'), async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'projects.get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          select p.id, p.name, p.status, p.client_id, p.package_cost,
                 p.additional_deliverables_cost, p.total_cost, p.show_quotation, p.created_at,
                 p.quotation_terms, coalesce(p.quotation_display_prefs,'{}'::jsonb) as quotation_display_prefs,
                 cl.name as client_name, cl.phone as client_phone,
                 cl.email as client_email, cl.address as client_address,
                 coalesce((
                   select jsonb_agg(
                     to_jsonb(d) || jsonb_build_object(
                       'shoot_name', (select s.name from shoots s where s.id = d.shoot_id),
                       'shoot_date', (select s.shoot_date from shoots s where s.id = d.shoot_id),
                       'assignee_name', (select u.name from users u where u.user_id = d.assignee_id),
                       'notes_count', (select count(*) from deliverable_notes n where n.deliverable_id = d.id and n.kind <> 'event'),
                       'voice_count', (select count(*) from deliverable_notes n where n.deliverable_id = d.id and n.kind = 'voice'),
                       'last_activity_at', la.created_at,
                       'last_activity_by', la.author_name,
                       'last_activity_kind', la.kind,
                       'last_activity_body', la.body
                     )
                     order by d.created_at
                   )
                   from deliverables d
                   -- The latest thing that happened on it, for the card's activity line.
                   left join lateral (
                     select n.created_at, n.kind, n.body, u.name as author_name
                       from deliverable_notes n left join users u on u.user_id = n.author_id
                      where n.deliverable_id = d.id
                      order by n.created_at desc limit 1
                   ) la on true
                   where d.project_id = p.id
                 ), '[]'::jsonb) as deliverables,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', rp.id, 'amount', rp.amount, 'paid_on', rp.paid_on,
                     'mode', rp.mode, 'reference', rp.reference,
                     'status', coalesce(rp.status,'paid'), 'description', rp.description,
                     'is_gst', coalesce(rp.is_gst,false), 'gst_number', rp.gst_number,
                     'invoice_id', rp.invoice_id,
                     'invoice_number', (select i.invoice_number from invoices i where i.id = rp.invoice_id)) order by rp.paid_on)
                   from received_payments rp where rp.project_id = p.id
                 ), '[]'::jsonb) as payments
          from projects p
          left join clients cl on cl.id = p.client_id
          where p.id = ${id}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That project was not found.')
    return c.json(projectDetail.parse(row))
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateProjectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project details.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(c, 'projects.update', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`update projects set ${sql(parsed.data)} where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not update the project.')
    if (!rows.length) fail(404, 'That project was not found.')
    await audit(c, { action: 'project.update', entityType: 'project', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

    /**
     * Delete a project outright — shoots, deliverables and tasks go with it.
     *
     * Refused once money has been recorded against it, and once a quotation
     * has gone to the client. Both are records of what the studio agreed to,
     * and a studio that wants either off the board wants the project
     * cancelled, not erased; the UI says so and offers that instead.
     */
  .delete('/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const outcome = await attempt(c, 'projects.delete', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
          const paid = await sql<{ n: number }[]>`
            select count(*)::int as n from received_payments where project_id = ${id}`
          if ((paid[0]?.n ?? 0) > 0) return 'has_payments' as const
          // Quotations are snapshots the client may already hold; deleting
          // the project would cascade-erase agreed evidence.
          const quoted = await sql<{ n: number }[]>`
            select count(*)::int as n from project_quotations where project_id = ${id}`
          if ((quoted[0]?.n ?? 0) > 0) return 'has_quotations' as const
          const rows = await sql<{ id: string }[]>`
            delete from projects where id = ${id} returning id`
          return rows.length ? ('deleted' as const) : ('missing' as const)
        }),
      )
      if (!outcome) fail(400, 'We could not delete this project.')
      if (outcome === 'has_payments') {
        fail(409, 'This project has payments recorded against it. Cancel it instead of deleting.')
      }
      if (outcome === 'has_quotations') {
        fail(409, 'This project has quotations the client has seen. Cancel it instead of deleting.')
      }
    if (outcome === 'missing') fail(404, 'That project was not found.')
    await audit(c, { action: 'project.delete', entityType: 'project', entityId: id })
    return c.body(null, 204)
  })

  // Add a deliverable to an existing project; the DB trigger recomputes totals.
  .post('/:id/deliverables', requireAction('projects', 'edit'), async (c) => {
    const parsed = deliverableInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the deliverable details.')
    const auth = c.get('auth')
    const projectId = uuidParam(c)
    const row = await attempt(
      c,
      'projects.deliverable_add',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          // The project must be this studio's -- RLS hides others, and the
          // row's trigger refuses them too, but a plain 404 is the answer.
          const owns = await sql`select 1 from projects where id = ${projectId}`
          if (!owns.length) return 'missing' as const
          const rows = await sql<{ id: string }[]>`
            insert into deliverables ${sql(withoutUndefined({ ...parsed.data, project_id: projectId, company_id: auth.companyId }))}
            returning id`
          return rows[0] ?? null
        }),
      { onCode: deliverableRuleBroken },
    )
    if (row === 'missing') fail(404, 'That project was not found.')
    if (!row) fail(400, 'We could not add the deliverable.')
    await audit(c, { action: 'deliverable.add', entityType: 'project', entityId: projectId, after: parsed.data })
    return c.json({ id: row.id }, 201)
  })

  .patch('/:id/deliverables/:did', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateDeliverableRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the deliverable details.')
    const patch = withoutUndefined(parsed.data)
    if (Object.keys(patch).length === 0) fail(422, 'Nothing to change.')
    const projectId = uuidParam(c)
    const did = uuidParam(c, 'did')
    const rows = await attempt(
      c,
      'projects.deliverable_update',
      () =>
        withUser(
          c.env,
          c.get('auth').userId,
          (sql) => sql<{ id: string }[]>`
            update deliverables set ${sql(patch)} where id = ${did} and project_id = ${projectId} returning id`,
        ),
      { onCode: deliverableRuleBroken },
    )
    if (!rows) fail(400, 'We could not update the deliverable.')
    if (!rows.length) fail(404, 'That deliverable was not found.')
    await audit(c, { action: 'deliverable.update', entityType: 'project', entityId: projectId, after: { deliverable_id: did, ...parsed.data } })
    return c.body(null, 204)
  })

  .delete('/:id/deliverables/:did', requireAction('projects', 'edit'), async (c) => {
    const projectId = uuidParam(c)
    const did = uuidParam(c, 'did')
    const rows = await attempt(c, 'projects.deliverable_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          delete from deliverables where id = ${did} and project_id = ${projectId} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not remove the deliverable.')
    if (!rows.length) fail(404, 'That deliverable was not found.')
    await audit(c, { action: 'deliverable.remove', entityType: 'project', entityId: projectId, before: { deliverable_id: did } })
    return c.body(null, 204)
  })

  /**
   * The project's money beyond its payments: the plan the client agreed to in
   * the terms (the latest agreed version, else the latest sent), and -- for
   * those who can see Billing -- the invoices raised for it.
   */
  .get('/:id/billing', requireAction('projects', 'view'), async (c) => {
    const projectId = uuidParam(c)
    const canSeeBilling = c.get('auth').access.hasModule('billing')
    const data = await attempt(c, 'projects.billing', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const docs = await sql<{ id: string; title: string | null; acknowledged_at: string | null; total_cost: number | null; payment_terms: unknown }[]>`
          select d.id, d.title, d.acknowledged_at, d.total_cost::float as total_cost, d.payment_terms
            from project_terms_documents d
           where d.project_id = ${projectId} and d.revoked_at is null
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

  // Record a payment against a project.
  .post('/:id/payments', requireAction('projects', 'edit'), async (c) => {
    const parsed = paymentInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the payment details.')
    const auth = c.get('auth')
    const projectId = uuidParam(c)
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
            paid_on: parsed.data.paid_on ?? new Date().toISOString().slice(0, 10),
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
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
    if (Object.keys(patch).length === 0) fail(422, 'Nothing to change.')
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



/** A payment may settle an invoice of this project, or one not tied to any project. */
async function invoiceFitsProject(sql: TransactionSql, invoiceId: string, projectId: string): Promise<boolean> {
  const rows = await sql`select 1 from invoices where id = ${invoiceId} and (project_id = ${projectId} or project_id is null)`
  return rows.length > 0
}

/** The terms' payment rows, read defensively: they were typed in by people, over several versions. */
function planInstalmentsFrom(raw: unknown): PlanInstalment[] {
  if (!Array.isArray(raw)) return []
  const out: PlanInstalment[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const value = Number(r?.value)
    if (!Number.isFinite(value) || value <= 0) continue
    out.push({
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : `Instalment ${out.length + 1}`,
      mode: r.mode === 'amount' ? 'amount' : 'percent',
      value,
      due_trigger: typeof r.due_trigger === 'string' && r.due_trigger.trim() ? r.due_trigger.trim() : null,
    })
  }
  return out
}
