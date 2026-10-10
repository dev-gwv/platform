import { Hono } from 'hono'
import {
  createProjectRequest,
  projectListItem,
  projectListPage,
  projectTrackingRow,
  trackingBreakdown,
} from '@ipc/contracts'
import { projectHealth, type ProjectCounters } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { requireStudioWork, seesMoney, studioWork, worksOn } from '../../lib/scope'

export const projectListRoutes = new Hono<AppEnv>()
  .get('/', requireAction('projects', 'view'), async (c) => {
    const url = new URL(c.req.url)
    const hasPaging = url.searchParams.has('page') || url.searchParams.has('page_size') || url.searchParams.has('search') || url.searchParams.has('status') || url.searchParams.has('sort')
    // Staff get the projects they work on, without money or the client's phone.
    const mine = !studioWork(c)
    const me = c.get('auth').userId
    const noMoney = !seesMoney(c)
    const hide = <T extends Record<string, unknown>>(r: T): T =>
      mine
        ? { ...r, package_cost: 0, total_cost: 0, received: 0, client_phone: null }
        : noMoney
          ? { ...r, package_cost: 0, total_cost: 0, received: 0 }
          : r
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
          where ${mine ? worksOn(sql, me) : sql`true`}
          order by p.created_at desc`,
        ),
      )
      if (!rows) fail(400, 'We could not load your projects.')
      return c.json(projectListItem.array().parse(rows.map(hide)))
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
             and ${mine ? worksOn(sql, me) : sql`true`}
           group by p.status`
        const inFilter = countRows.filter((r) => !status || status === 'all' || r.status === status)
        const total = inFilter.reduce((n, r) => n + r.n, 0)
        const value = inFilter.reduce((n, r) => n + Number(r.value), 0)
        const received = inFilter.reduce((n, r) => n + Number(r.received), 0)
        const summary = mine || noMoney ? { value: 0, received: 0, due: 0 } : { value, received, due: Math.max(0, value - received) }
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
            and ${mine ? worksOn(sql, me) : sql`true`}
          order by ${sql.unsafe(orderBy)}
          limit ${pageSize} offset ${offset}`
        return { total, rows, summary, statusCounts }
      }),
    )
    if (!result) fail(400, 'We could not load your projects.')
    return c.json(projectListPage.parse({ items: result.rows.map(hide), total: result.total, page, page_size: pageSize, summary: result.summary, status_counts: result.statusCounts }))
  })

  // Tracking: one aggregate row per project, counted here and judged by
  // @ipc/domain projectHealth -- on the server, so the page, the dashboard and
  // anything else read one answer. "Today" is the studio's day (India).
  //
  // `/tracking` must be declared before `/:id`, or Hono matches it as an id.
  .get('/tracking', requireAction('projects', 'view'), requireStudioWork, async (c) => {
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
  .get('/tracking/:id', requireAction('projects', 'view'), requireStudioWork, async (c) => {
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
