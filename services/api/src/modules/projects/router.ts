import { Hono } from 'hono'
import {
  createProjectRequest,
  deliverableInput,
  updateDeliverableRequest,
  setDeliverableStageRequest,
  myDeliverable,
  deliverableSet,
  paymentInput,
  updatePaymentRequest,
  projectDetail,
  projectListItem,
  projectListPage,
  projectTrackingRow,
  saveDeliverableSetRequest,
  updateProjectRequest,
  createProjectTemplateRequest,
  projectTemplateList,
  createShootTypeRequest,
  shootTypeItem,
  z,
} from '@ipc/contracts'
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
  return undefined
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
        const countRows = await sql<{ n: number }[]>`
          select count(*)::int as n from projects p
          left join clients cl on cl.id = p.client_id
          where ${status && status !== 'all' ? sql`p.status = ${status}` : sql`true`}
            and ${search ? sql`(p.name ilike ${'%' + search + '%'} or coalesce(cl.name,'') ilike ${'%' + search + '%'} or coalesce(cl.phone,'') ilike ${'%' + search + '%'})` : sql`true`}`
        const total = countRows[0]?.n ?? 0
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
        return { total, rows }
      }),
    )
    if (!result) fail(400, 'We could not load your projects.')
    return c.json(projectListPage.parse({ items: result.rows, total: result.total, page, page_size: pageSize }))
  })

  // Tracking: one aggregate row per project. Counting happens here — it is a
  // handful of indexed rollups the database does far better than N round trips
  // — but nothing is judged here. The scoring lives in @ipc/domain so the rules
  // are testable and the client can re-sort without asking again.
  //
  // `/tracking` must be declared before `/:id`, or Hono matches it as an id.
  .get('/tracking', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'projects.tracking', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select
            p.id, p.name, p.status, p.total_cost, cl.name as client_name,
            coalesce(t.total, 0)::int        as tasks_total,
            coalesce(t.done, 0)::int         as tasks_done,
            coalesce(t.overdue, 0)::int      as tasks_overdue,
            coalesce(d.total, 0)::int        as deliverables_total,
            coalesce(d.done, 0)::int         as deliverables_done,
            coalesce(d.late, 0)::int         as deliverables_late,
            coalesce(dr.total, 0)::int       as data_records_total,
            coalesce(dr.unverified, 0)::int  as data_records_unverified,
            coalesce(w.pending, 0)::int      as pending_reviews,
            coalesce(s.total, 0)::int        as shoots_total,
            coalesce(s.done, 0)::int         as shoots_done,
            s.next_shoot_date,
            greatest(p.updated_at, coalesce(t.last_touch, p.updated_at)) as last_activity_at
          from projects p
          left join clients cl on cl.id = p.client_id
          left join lateral (
            select count(*) as total,
                   count(*) filter (where status = 'completed') as done,
                   count(*) filter (
                     where status not in ('completed', 'cancelled')
                       and due_date is not null and due_date < current_date
                   ) as overdue,
                   max(updated_at) as last_touch
            from tasks where project_id = p.id
          ) t on true
          left join lateral (
            -- A dropped deliverable is no longer owed, so it neither counts
            -- toward the total nor holds the project short of 100%.
            select count(*) filter (where status <> 'cancelled') as total,
                   count(*) filter (where status = 'completed') as done,
                   count(*) filter (
                     where status not in ('completed', 'cancelled')
                       and estimated_date is not null and estimated_date < current_date
                   ) as late
            from deliverables where project_id = p.id
          ) d on true
          left join lateral (
            -- Shoot-linked records only: a loose record is not a custody risk
            -- against any particular shoot.
            select count(*) as total,
                   count(*) filter (
                     -- A backup declared not needed is not a missing backup.
                     where primary_status <> 'verified' or backup_status not in ('verified', 'not_required')
                   ) as unverified
            from shoot_data_records where project_id = p.id and shoot_id is not null
          ) dr on true
          left join lateral (
            select count(*) filter (where status = 'submitted') as pending
            from team_work_submissions where project_id = p.id
          ) w on true
          left join lateral (
            select count(*) as total,
                   count(*) filter (where status = 'completed') as done,
                   min(shoot_date) filter (where shoot_date >= current_date) as next_shoot_date
            from shoots where project_id = p.id and status <> 'cancelled'
          ) s on true
          where p.status <> 'cancelled'
          order by p.created_at desc`,
      ),
    )
    if (!rows) fail(400, 'We could not load project tracking.')
    return c.json(projectTrackingRow.array().parse(rows))
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
  .get('/board/deliverables', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'projects.board_deliverables', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select d.id, d.title, d.status, d.status as board_status,
               d.project_id, p.name as project_name, d.estimated_date as due_date,
               s.name as shoot_name, u.name as assignee_name
        from deliverables d
        join projects p on p.id = d.project_id
        left join shoots s on s.id = d.shoot_id
        left join users u on u.user_id = d.assignee_id
        -- Open work, plus what was delivered in the last fortnight: years of
        -- delivered history must not crowd today's work out of the limit.
        where d.status not in ('cancelled', 'completed')
           or (d.status = 'completed' and d.delivered_at > now() - interval '14 days')
        order by d.estimated_date nulls last, d.created_at desc limit 500`),
    )
    if (!rows) fail(400, 'We could not load board deliverables.')
    return c.json(rows)
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
   * What the caller is editing: every open deliverable they are the editor on,
   * soonest due first. Any member -- an editor need not see whole projects to
   * see their own work.
   */
  .get('/deliverables/mine', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'projects.deliverables_mine', () =>
      withUser(c.env, auth.userId, (sql) => sql`
        select d.id, d.project_id, p.name as project_name, cl.name as client_name,
               d.title, d.description, d.status, d.estimated_date, s.name as shoot_name,
               d.delivery_link, d.visibility_scope
        from deliverables d
        join projects p on p.id = d.project_id
        left join clients cl on cl.id = p.client_id
        left join shoots s on s.id = d.shoot_id
        where d.assignee_id = ${auth.userId} and d.status not in ('completed', 'cancelled')
        order by d.estimated_date nulls last, d.created_at
        limit 200`),
    )
    if (!rows) fail(400, 'We could not load your deliverables.')
    return c.json(myDeliverable.array().parse(rows))
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
        const patch: Record<string, unknown> = { status: parsed.data.status }
        if (parsed.data.delivery_link !== undefined) patch.delivery_link = parsed.data.delivery_link || null
        await sql`update deliverables set ${sql(patch)} where id = ${did}`
        return d.project_id
      }),
    )
    if (outcome === 'missing') fail(404, 'That deliverable was not found.')
    if (outcome === 'forbidden') fail(403, 'Only the editor on it, or a manager, can move this.')
    if (!outcome) fail(400, 'We could not update the deliverable.')
    await audit(c, {
      action: 'deliverable.stage',
      entityType: 'project',
      entityId: outcome,
      after: { deliverable_id: did, ...parsed.data },
    })
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
                       'assignee_name', (select u.name from users u where u.user_id = d.assignee_id)
                     )
                     order by d.created_at
                   )
                   from deliverables d where d.project_id = p.id
                 ), '[]'::jsonb) as deliverables,
                 coalesce((
                   select jsonb_agg(jsonb_build_object(
                     'id', rp.id, 'amount', rp.amount, 'paid_on', rp.paid_on,
                     'mode', rp.mode, 'reference', rp.reference,
                     'status', coalesce(rp.status,'paid'), 'description', rp.description,
                     'is_gst', coalesce(rp.is_gst,false), 'gst_number', rp.gst_number) order by rp.paid_on)
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
            client_id: owner[0]!.client_id,
            recorded_by: auth.userId,
          })}
          returning id`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not record the payment.')
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
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update received_payments set ${sql(patch)} where id = ${pid} and project_id = ${projectId} returning id`),
    )
    if (!rows) fail(400, 'We could not update this payment.')
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


