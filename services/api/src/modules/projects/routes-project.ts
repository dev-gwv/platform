import { Hono } from 'hono'
import {
  deliverableInput,
  updateDeliverableRequest,
  projectDetail,
  updateProjectRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { requireStudioWork, seesMoney } from '../../lib/scope'
import { withoutUndefined, deliverableRuleBroken } from './shared'

export const projectRoutes = new Hono<AppEnv>()
  .get('/:id', requireAction('projects', 'view'), requireStudioWork, async (c) => {
    const id = uuidParam(c)
    const row = await attempt(c, 'projects.get', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          select p.id, p.name, p.status, p.client_id, p.package_cost,
                 p.additional_deliverables_cost, p.total_cost, p.show_quotation, p.created_at,
                 p.quotation_terms, coalesce(p.quotation_display_prefs,'{}'::jsonb) as quotation_display_prefs,
                 qa.accepted_at as quotation_accepted_at, qa.accepted_by_name as quotation_accepted_by,
                 (select max(pq.created_at) from project_quotations pq where pq.project_id = p.id) as quotation_issued_at,
                 cl.name as client_name, cl.phone as client_phone,
                 cl.email as client_email, cl.address as client_address,
                 coalesce((
                   select jsonb_agg(
                     to_jsonb(d) || jsonb_build_object(
                       'shoot_name', (select s.name from shoots s where s.id = d.shoot_id),
                       'shoot_date', (select s.shoot_date from shoots s where s.id = d.shoot_id),
                       -- Several shoots live in the links (0227); one is just shoot_id.
                       'shoot_ids', coalesce(
                         (select jsonb_agg(l.shoot_id order by s.shoot_date nulls last, s.created_at)
                            from deliverable_shoot_links l join shoots s on s.id = l.shoot_id
                           where l.deliverable_id = d.id),
                         case when d.shoot_id is null then '[]'::jsonb else jsonb_build_array(d.shoot_id) end),
                       'shoot_names', coalesce(
                         (select jsonb_agg(s.name order by s.shoot_date nulls last, s.created_at)
                            from deliverable_shoot_links l join shoots s on s.id = l.shoot_id
                           where l.deliverable_id = d.id),
                         (select jsonb_build_array(s.name) from shoots s where s.id = d.shoot_id),
                         '[]'::jsonb),
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
          -- The client's latest yes on a quotation link, for the studio's banner.
          left join lateral (
            select q.accepted_at, q.accepted_by_name from project_quotations q
             where q.project_id = p.id and q.accepted_at is not null
             order by q.accepted_at desc limit 1
          ) qa on true
          where p.id = ${id}`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That project was not found.')
    const detail = projectDetail.parse(row)
    // Running a project is not seeing its money: without billing or money
    // access the figures go out as nothing.
    if (seesMoney(c)) return c.json(detail)
    return c.json({
      ...detail,
      package_cost: 0,
      additional_deliverables_cost: 0,
      total_cost: 0,
      payments: [],
      deliverables: detail.deliverables.map((d) => ({ ...d, additional_charge_amount: 0 })),
    })
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
          const { shoot_ids, ...data } = parsed.data
          const rows = await sql<{ id: string }[]>`
            insert into deliverables ${sql(withoutUndefined({ ...data, project_id: projectId, company_id: auth.companyId }))}
            returning id`
          if (rows[0] && shoot_ids) await sql`select set_deliverable_shoots(${rows[0].id}, ${shoot_ids}::uuid[])`
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
    const { shoot_ids, ...rest } = parsed.data
    // The list decides the shoot; a shoot_id beside it would only be undone.
    const patch = withoutUndefined(shoot_ids ? { ...rest, shoot_id: undefined } : rest)
    if (Object.keys(patch).length === 0 && !shoot_ids) fail(422, 'Nothing to change.')
    const projectId = uuidParam(c)
    const did = uuidParam(c, 'did')
    const rows = await attempt(
      c,
      'projects.deliverable_update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const found = Object.keys(patch).length
            ? await sql<{ id: string }[]>`
                update deliverables set ${sql(patch)} where id = ${did} and project_id = ${projectId} returning id`
            : await sql<{ id: string }[]>`select id from deliverables where id = ${did} and project_id = ${projectId}`
          if (found.length && shoot_ids) await sql`select set_deliverable_shoots(${did}, ${shoot_ids}::uuid[])`
          return found
        }),
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
