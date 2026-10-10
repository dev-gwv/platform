import { Hono } from 'hono'
import {
  deliverableStage,
  createDeliverableStageRequest,
  updateDeliverableStageRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { withoutUndefined } from './shared'

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

export const deliverableStageRoutes = new Hono<AppEnv>()
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
