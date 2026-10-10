import { Hono } from 'hono'
import {
  deliverableSet,
  saveDeliverableSetRequest,
  createProjectTemplateRequest,
  projectTemplateList,
  z,
} from '@ipc/contracts'
import { fillProjectDueDates } from '../../lib/due-fill'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

export const projectTemplateRoutes = new Hono<AppEnv>()
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
        select id, company_id, name, description, deliverables_json, shoots_json, tasks_json, is_sample, created_at
          from project_templates
         where company_id = ${c.get('auth').companyId}
         order by is_sample, created_at desc`),
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
                 tasks_json = ${sql.json(d.tasks_json)},
                 -- Edited, it is the studio's own now (0232).
                 is_sample = false
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
        // The template's deliverables arrive undated; date them as the wizard would.
        const created = result[0]?.create_project_from_template
        if (created) await fillProjectDueDates(sql, created)
        return result
      }),
      { onCode: (code) => (code === '23514' ? fail(422, 'Pick a client for this project.') : undefined) },
    )
    if (!rows?.[0]) fail(400, 'We could not create the project from this template.')
    await audit(c, { action: 'project_template.apply', entityType: 'project_template', entityId: templateId, after: { project_id: rows[0].create_project_from_template } })
    return c.json({ project_id: rows[0].create_project_from_template }, 201)
  })
