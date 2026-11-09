import { Hono } from 'hono'
import { createDesignRequest, designCreated, designDeleted, designDetail, designSaved, designSummary, updateDesignRequest, type DesignDoc } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { requireStudioWork } from '../../lib/scope'

/**
 * Quotation Designer (0295): the studio's premium quotation designs, each a
 * JSON document of pages made from a project and edited in place. Starter
 * makes 30 a plan year (enforce_plan_limit -> 54000 -> 402 by attempt()).
 */

const iso = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

interface Row {
  id: string
  title: string
  template: string
  project_id: string | null
  project_name: string | null
  doc: DesignDoc
  created_at: string
  updated_at: string
}

/** The first photo with a picture on the first page shown: the card's thumbnail. */
function coverOf(doc: DesignDoc | null | undefined): string | null {
  const page = doc?.pages?.find((p) => !p.hidden)
  const url = page?.data?.photo?.url || page?.data?.photos?.find((p) => p.url)?.url
  return url || null
}

const summary = (r: Row) =>
  designSummary.parse({
    id: r.id,
    title: r.title,
    template: r.template,
    project_id: r.project_id,
    project_name: r.project_name,
    cover_url: coverOf(r.doc),
    pages: r.doc?.pages?.length ?? 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  })

const SELECT = `d.id, d.title, d.template, d.project_id, p.name as project_name, d.doc,
  ${iso('d.created_at')} as created_at, ${iso('d.updated_at')} as updated_at`

export const designsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .use('*', requireStudioWork)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const projectId = c.req.query('project_id') || null
    const rows = await attempt(c, 'designs.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<Row[]>`
        select ${sql.unsafe(SELECT)}
          from quotation_designs d
          left join projects p on p.id = d.project_id
         where (${projectId}::uuid is null or d.project_id = ${projectId}::uuid)
         order by d.updated_at desc
         limit 300`),
    )
    if (!rows) fail(400, 'We could not load the designs.')
    return c.json(rows.map(summary))
  })

  .get('/:id', requireAction('projects', 'view'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'designs.get', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<Row[]>`
        select ${sql.unsafe(SELECT)}
          from quotation_designs d
          left join projects p on p.id = d.project_id
         where d.id = ${id}`),
    )
    const r = rows?.[0]
    if (!r) fail(404, 'This design is not here any more.')
    return c.json(designDetail.parse({ ...summary(r), doc: r.doc }))
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createDesignRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the design.')
    const v = parsed.data
    const rows = await attempt(c, 'designs.create', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        insert into quotation_designs (title, template, project_id, doc)
        values (${v.title}, ${v.template}, ${v.project_id ?? null}, ${sql.json(v.doc as never)})
        returning id`),
    )
    const id = rows?.[0]?.id
    if (!id) fail(400, 'We could not make this design.')
    await audit(c, { action: 'design.create', entityType: 'quotation_design', entityId: id, after: { title: v.title, template: v.template, project_id: v.project_id ?? null } })
    return c.json(designCreated.parse({ id }), 201)
  })

  /** Autosave: whatever changed, the document whole. */
  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = updateDesignRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the design.')
    const v = parsed.data
    const rows = await attempt(c, 'designs.update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ updated_at: string }[]>`
        update quotation_designs set
          title = coalesce(${v.title ?? null}, title),
          template = coalesce(${v.template ?? null}, template),
          project_id = case when ${v.project_id !== undefined} then ${v.project_id ?? null}::uuid else project_id end,
          doc = coalesce(${v.doc ? sql.json(v.doc as never) : null}::jsonb, doc)
         where id = ${id}
        returning ${sql.unsafe(iso('updated_at'))} as updated_at`),
    )
    const r = rows?.[0]
    if (!r) fail(404, 'This design is not here any more.')
    return c.json(designSaved.parse({ ok: true, updated_at: r.updated_at }))
  })

  .post('/:id/duplicate', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'designs.duplicate', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        insert into quotation_designs (title, template, project_id, doc)
        select left(title || ' (copy)', 160), template, project_id, doc from quotation_designs where id = ${id}
        returning id`),
    )
    const copy = rows?.[0]?.id
    if (!copy) fail(404, 'This design is not here any more.')
    await audit(c, { action: 'design.duplicate', entityType: 'quotation_design', entityId: copy, before: { from: id } })
    return c.json(designCreated.parse({ id: copy }), 201)
  })

  .delete('/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'designs.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ title: string }[]>`
        delete from quotation_designs where id = ${id} returning title`),
    )
    if (!rows?.[0]) fail(404, 'This design is not here any more.')
    await audit(c, { action: 'design.delete', entityType: 'quotation_design', entityId: id, before: rows[0] })
    return c.json(designDeleted.parse({ ok: true }))
  })
