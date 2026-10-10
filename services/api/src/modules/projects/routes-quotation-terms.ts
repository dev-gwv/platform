import { Hono } from 'hono'
import { quotationTermsPreset, saveQuotationTermsPresetRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { withoutUndefined } from './shared'

/** A terms preset write the database refused. */
function presetRefused(code: string): never | undefined {
  if (code === '23505') fail(409, 'A preset with that name already exists.')
  if (code === '42501') fail(403, 'Only an owner or a manager can change the terms presets.')
  if (code === 'P0002') fail(404, 'That preset was not found.')
  return undefined
}

export const quotationTermsRoutes = new Hono<AppEnv>()
  /**
   * The studio's own quotation terms presets (0227), shared by everyone who
   * writes a quotation. One can be the default, used where a project has no
   * terms of its own. Owners and managers keep the list (RLS).
   */
  .get('/quotation-terms', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'projects.terms_presets', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, title, body, is_default from quotation_terms_presets order by is_default desc, lower(title)`),
    )
    if (!rows) fail(400, 'We could not load the terms presets.')
    return c.json(quotationTermsPreset.array().parse(rows))
  })

  .post('/quotation-terms', requireAction('projects', 'edit'), async (c) => {
    const parsed = saveQuotationTermsPresetRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Give the preset a name and some terms.')
    const { is_default, ...data } = parsed.data
    const row = await attempt(
      c,
      'projects.terms_preset_create',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [r] = await sql<{ id: string }[]>`insert into quotation_terms_presets ${sql(data)} returning id`
          if (r && is_default) await sql`select set_default_quotation_terms(${r.id})`
          return r ? (await sql`select id, title, body, is_default from quotation_terms_presets where id = ${r.id}`)[0] ?? null : null
        }),
      { onCode: presetRefused },
    )
    if (!row) fail(400, 'We could not save the preset.')
    return c.json(quotationTermsPreset.parse(row), 201)
  })

  .patch('/quotation-terms/:pid', requireAction('projects', 'edit'), async (c) => {
    const parsed = saveQuotationTermsPresetRequest.partial().safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success || Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c, 'pid')
    const { is_default, ...data } = parsed.data
    const row = await attempt(
      c,
      'projects.terms_preset_update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          if (Object.keys(data).length) {
            const r = await sql`update quotation_terms_presets set ${sql(withoutUndefined(data))} where id = ${id} returning id`
            if (!r.length) return null
          }
          if (is_default === true) await sql`select set_default_quotation_terms(${id})`
          if (is_default === false) await sql`update quotation_terms_presets set is_default = false where id = ${id}`
          return (await sql`select id, title, body, is_default from quotation_terms_presets where id = ${id}`)[0] ?? null
        }),
      { onCode: presetRefused },
    )
    if (!row) fail(404, 'That preset was not found.')
    return c.json(quotationTermsPreset.parse(row))
  })

  .delete('/quotation-terms/:pid', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c, 'pid')
    const rows = await attempt(
      c,
      'projects.terms_preset_delete',
      () => withUser(c.env, c.get('auth').userId, (sql) => sql`delete from quotation_terms_presets where id = ${id} returning id`),
      { onCode: presetRefused },
    )
    if (!rows) fail(400, 'We could not delete the preset.')
    if (!rows.length) fail(404, 'That preset was not found.')
    return c.body(null, 204)
  })
