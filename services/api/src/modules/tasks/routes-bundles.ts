import { Hono } from 'hono'
import { applyBundleRequest, createBundleRequest, updateBundleRequest, taskBundle } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/** Task bundles: the checklists a studio repeats. */
export const bundleRoutes = new Hono<AppEnv>()
  // ── Task bundles ────────────────────────────────────────────
  // The checklists a studio repeats. These tables existed from Phase 5 but had
  // RLS on with no policy, so nothing could read them until 0031.
  .get('/bundles', requireAction('tasks', 'view'), async (c) => {
    const rows = await attempt(c, 'tasks.bundles', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select b.id, b.name,
                 coalesce(
                   jsonb_agg(
                     jsonb_build_object(
                       'id', i.id, 'title', i.title,
                       'priority', i.priority, 'sort_order', i.sort_order
                     ) order by i.sort_order, i.title
                   ) filter (where i.id is not null),
                   '[]'::jsonb
                 ) as items
          from task_bundles b
          left join task_bundle_items i on i.bundle_id = b.id
          group by b.id
          order by b.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load task bundles.')
    return c.json(taskBundle.array().parse(rows))
  })

  .post('/bundles', requireAction('tasks', 'create'), async (c) => {
    const parsed = createBundleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A bundle needs a name and at least one task.')
    const { name, items } = parsed.data
    const companyId = c.get('auth').companyId

    const id = await attempt(c, 'tasks.bundle_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [bundle] = await sql<{ id: string }[]>`
          insert into task_bundles (company_id, name) values (${companyId}, ${name}) returning id`
        if (!bundle) return null
        for (const [index, item] of items.entries()) {
          await sql`
            insert into task_bundle_items (bundle_id, company_id, title, priority, sort_order)
            values (${bundle.id}, ${companyId}, ${item.title}, ${item.priority}, ${index})`
        }
        return bundle.id
      }),
    )
    if (!id) fail(400, 'We could not create this bundle.')
    await audit(c, { action: 'task_bundle.create', entityType: 'task_bundle', entityId: id, after: { name, items: items.length } })
    return c.json({ id }, 201)
  })

  .patch('/bundles/:id', requireAction('tasks', 'edit'), async (c) => {
    const parsed = updateBundleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A bundle needs a name and at least one task.')
    const { name, items } = parsed.data
    const id = uuidParam(c)
    const companyId = c.get('auth').companyId
    const ok = await attempt(c, 'tasks.bundle_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`update task_bundles set name = ${name} where id = ${id} returning id`
        if (!rows.length) return false
        await sql`delete from task_bundle_items where bundle_id = ${id}`
        for (const [index, item] of items.entries()) {
          await sql`
            insert into task_bundle_items (bundle_id, company_id, title, priority, sort_order)
            values (${id}, ${companyId}, ${item.title}, ${item.priority}, ${index})`
        }
        return true
      }),
    )
    if (!ok) fail(404, 'We could not find that bundle.')
    await audit(c, { action: 'task_bundle.update', entityType: 'task_bundle', entityId: id, after: { name, items: items.length } })
    return c.body(null, 204)
  })

  .delete('/bundles/:id', requireAction('tasks', 'delete'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'tasks.bundle_delete', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`delete from task_bundles where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not delete this bundle.')
    if (!rows.length) fail(404, 'We could not find that bundle.')
    await audit(c, { action: 'task_bundle.delete', entityType: 'task_bundle', entityId: id })
    return c.body(null, 204)
  })

  // Stamp the checklist out as real tasks.
  .post('/bundles/:id/apply', requireAction('tasks', 'create'), async (c) => {
    const parsed = applyBundleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the project and assignees.')
    const d = parsed.data
    const id = uuidParam(c)

    const created = await attempt(c, 'tasks.bundle_apply', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ count: number }[]>`
          select apply_task_bundle(
            ${id}::uuid, ${d.project_id}, ${d.assignees}::uuid[]
          ) as count`
        return rows[0]?.count ?? null
      }),
    )
    if (created === null) fail(400, 'We could not apply this bundle.')
    await audit(c, { action: 'task_bundle.apply', entityType: 'task_bundle', entityId: id, after: { ...d, created } })
    return c.json({ created }, 201)
  })
