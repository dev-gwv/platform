import { Hono } from 'hono'
import {
  createShootTypeRequest,
  shootTypeItem,
  deliverableType,
  upsertDeliverableTypeRequest,
  updateDeliverableTypeRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { withoutUndefined } from './shared'

/** A deliverable type as the API names it; the table still says delivery_days (0109). */
const DELIVERABLE_TYPE_COLUMNS = 'id, title, delivery_days as due_days, due_basis, work_days, is_archived'

export const projectCatalogRoutes = new Hono<AppEnv>()
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
