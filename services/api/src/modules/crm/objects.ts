import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  contactsQuery,
  createCrmCompanyRequest,
  createContactRequest,
  createLostReasonRequest,
  createPipelineRequest,
  createStageRequest,
  crmCompany,
  crmContact,
  crmForecast,
  crmStatsQuery,
  crmTag,
  createTagRequest,
  lostReason,
  setLeadTagsRequest,
  tagLeadsRequest,
  moveStageRequest,
  moveStageResponse,
  pipeline,
  reorderStagesRequest,
  updateCrmCompanyRequest,
  updateContactRequest,
  updateLostReasonRequest,
  updatePipelineRequest,
  updateStageRequest,
  updateTagRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { claimRule } from './rules'

/**
 * The CRM's objects around the deal: pipelines with their stages, contacts,
 * companies, lost reasons, and the forecast over them. Mounted under the
 * same /crm prefix and the same auth + module guard as the leads router.
 *
 * crm_move_stage() raises P0001 with a sentence meant for the person ("Fill
 * in deal_value before moving to Proposal sent."); that message is safe to
 * show, so it is surfaced as the 422 body instead of attempt()'s generic one.
 */
const edit = requireAction('crm', 'edit')
const create = requireAction('crm', 'create')
const remove = requireAction('crm', 'delete')

const selectPipelines = (sql: TransactionSql) => sql`
  select p.id, p.name, p.is_default, p.position, p.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', s.id, 'pipeline_id', s.pipeline_id, 'name', s.name, 'key', s.key, 'position', s.position,
             'kind', s.kind, 'probability_default', s.probability_default, 'wip_limit', s.wip_limit,
             'required_fields', to_jsonb(s.required_fields),
             'deal_count', (select count(*) from crm_leads l where l.stage_id = s.id and l.is_archived = false)
           ) order by s.position, s.created_at)
           from crm_pipeline_stages s where s.pipeline_id = p.id
         ), '[]'::jsonb) as stages
  from crm_pipelines p`

const selectContacts = (sql: TransactionSql) => sql`
  select c.id, c.name, c.phone, c.email, c.lifecycle, c.owner_id, u.name as owner_name, c.source,
         c.crm_company_id, co.name as crm_company_name, c.notes, c.is_archived, c.created_at,
         (select count(*) from crm_leads l where l.contact_id = c.id and l.is_archived = false)::int as deal_count,
         (select count(*) from crm_leads l where l.contact_id = c.id and l.is_archived = false and l.status not in ('converted', 'lost'))::int as open_deal_count,
         (select max(l.last_contacted_at) from crm_leads l where l.contact_id = c.id) as last_contacted_at
  from crm_contacts c
  left join users u on u.user_id = c.owner_id
  left join crm_companies co on co.id = c.crm_company_id`

const selectCompanies = (sql: TransactionSql) => sql`
  select co.id, co.name, co.domain, co.phone, co.city, co.notes, co.owner_id, u.name as owner_name, co.is_archived, co.created_at,
         (select count(*) from crm_contacts c where c.crm_company_id = co.id and c.is_archived = false)::int as contact_count,
         (select count(*) from crm_leads l where l.crm_company_id = co.id and l.is_archived = false)::int as deal_count,
         (select coalesce(sum(l.deal_value), 0) from crm_leads l
           where l.crm_company_id = co.id and l.is_archived = false and l.status not in ('converted', 'lost')) as open_value
  from crm_companies co
  left join users u on u.user_id = co.owner_id`

export const crmObjectsRouter = new Hono<AppEnv>()
  // ── Pipelines & stages ──────────────────────────────────────
  .get('/pipelines', async (c) => {
    const rows = await attempt(c, 'crm.pipelines', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`${selectPipelines(sql)} order by p.is_default desc, p.position, p.created_at`),
    )
    if (!rows) fail(400, 'We could not load the pipelines.')
    return c.json(pipeline.array().parse(rows))
  })

  .post('/pipelines', create, async (c) => {
    const parsed = createPipelineRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Name the pipeline.')
    const v = parsed.data
    const auth = c.get('auth')
    if (!auth.isOwner) fail(403, 'Only the studio owner can add pipelines.')
    const row = await attempt(c, 'crm.pipeline_create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [p] = await sql<{ id: string }[]>`
          insert into crm_pipelines (company_id, name, position)
          values (get_current_company_id(), ${v.name}, (select coalesce(max(position), 0) + 1 from crm_pipelines))
          returning id`
        if (!p) return null
        // A pipeline is unusable without a won and a lost stage, so every new
        // one starts with the same six the default has.
        await sql`
          insert into crm_pipeline_stages (pipeline_id, company_id, name, key, position, kind, probability_default) values
            (${p.id}, get_current_company_id(), 'New', 'new', 0, 'open', 10),
            (${p.id}, get_current_company_id(), 'Contacted', 'contacted', 1, 'open', 25),
            (${p.id}, get_current_company_id(), 'Qualified', 'qualified', 2, 'open', 50),
            (${p.id}, get_current_company_id(), 'Proposal sent', 'proposal_sent', 3, 'open', 75),
            (${p.id}, get_current_company_id(), 'Won', 'converted', 4, 'won', 100),
            (${p.id}, get_current_company_id(), 'Lost', 'lost', 5, 'lost', 0)`
        if (v.is_default) {
          await sql`update crm_pipelines set is_default = false where is_default`
          await sql`update crm_pipelines set is_default = true where id = ${p.id}`
        }
        const [full] = await sql`${selectPipelines(sql)} where p.id = ${p.id}`
        return full ?? null
      }),
    )
    if (!row) fail(400, 'We could not create the pipeline.')
    const created = pipeline.parse(row)
    await audit(c, { action: 'pipeline.create', entityType: 'crm_pipeline', entityId: created.id, after: v })
    return c.json(created, 201)
  })

  .patch('/pipelines/:id', edit, async (c) => {
    const parsed = updatePipelineRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const auth = c.get('auth')
    if (!auth.isOwner) fail(403, 'Only the studio owner can change pipelines.')
    const { is_default, ...rest } = parsed.data
    const rows = await attempt(c, 'crm.pipeline_update', () =>
      withUser(c.env, auth.userId, async (sql) => {
        if (is_default) await sql`update crm_pipelines set is_default = false where is_default and id <> ${id}`
        const patch = { ...rest, ...(is_default ? { is_default: true } : {}) }
        return sql<{ id: string }[]>`update crm_pipelines set ${sql(patch)} where id = ${id} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update the pipeline.')
    if (!rows.length) fail(404, 'That pipeline was not found.')
    await audit(c, { action: 'pipeline.update', entityType: 'crm_pipeline', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  // Deleting a pipeline moves its deals to the default one, stage by status.
  .delete('/pipelines/:id', remove, async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    if (!auth.isOwner) fail(403, 'Only the studio owner can delete pipelines.')
    const result = await attempt(c, 'crm.pipeline_delete', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [p] = await sql<{ is_default: boolean }[]>`select is_default from crm_pipelines where id = ${id}`
        if (!p) return 'missing' as const
        if (p.is_default) return 'default' as const
        const [d] = await sql<{ id: string }[]>`select id from crm_pipelines where is_default`
        if (!d) return null
        await sql`update crm_leads set pipeline_id = ${d.id}, stage_id = crm_stage_for_status(${d.id}, status) where pipeline_id = ${id}`
        await sql`delete from crm_pipelines where id = ${id}`
        return 'ok' as const
      }),
    )
    if (result === 'missing') fail(404, 'That pipeline was not found.')
    if (result === 'default') fail(422, 'Make another pipeline the default before deleting this one.')
    if (!result) fail(400, 'We could not delete the pipeline.')
    await audit(c, { action: 'pipeline.delete', entityType: 'crm_pipeline', entityId: id })
    return c.body(null, 204)
  })

  .post('/pipelines/:id/stages', edit, async (c) => {
    const parsed = createStageRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the stage.')
    const pipelineId = uuidParam(c)
    const v = parsed.data
    const key = v.key ?? (v.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'stage')
    const row = await attempt(
      c,
      'crm.stage_create',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [s] = await sql`
            insert into crm_pipeline_stages (pipeline_id, company_id, name, key, position, kind, probability_default, wip_limit, required_fields)
            select ${pipelineId}, get_current_company_id(), ${v.name}, ${key},
                   ${v.position ?? null}::int,
                   ${v.kind}, ${v.probability_default ?? (v.kind === 'won' ? 100 : v.kind === 'lost' ? 0 : 10)},
                   ${v.wip_limit ?? null}, ${sql.array(v.required_fields)}::text[]
            where exists (select 1 from crm_pipelines p where p.id = ${pipelineId})
            returning id`
          if (!s) return null
          if (v.position === undefined) {
            await sql`
              update crm_pipeline_stages set position = (select coalesce(max(position), -1) + 1 from crm_pipeline_stages where pipeline_id = ${pipelineId} and id <> ${s.id})
              where id = ${s.id}`
          }
          const [full] = await sql`${selectPipelines(sql)} where p.id = ${pipelineId}`
          return full ?? null
        }),
      { onCode: (code) => (code === '23505' ? ('taken' as const) : undefined) },
    )
    if (row === 'taken') fail(409, 'A stage with that key already exists in this pipeline.')
    if (!row) fail(404, 'That pipeline was not found.')
    await audit(c, { action: 'stage.create', entityType: 'crm_pipeline_stage', entityId: pipelineId, after: { ...v, key } })
    return c.json(pipeline.parse(row), 201)
  })

  .patch('/stages/:id', edit, async (c) => {
    const parsed = updateStageRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const { required_fields, ...rest } = parsed.data
    // Changing what a stage MEANS can strand a pipeline with no way to win
    // or lose, which crm_stage_for_status() then cannot resolve.
    if (rest.kind) {
      const blocked = await attempt(c, 'crm.stage_kind_check', () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [s] = await sql<{ kind: string; pipeline_id: string }[]>`
            select kind, pipeline_id from crm_pipeline_stages where id = ${id}`
          if (!s || s.kind === rest.kind || s.kind === 'open') return null
          const [others] = await sql<{ n: number }[]>`
            select count(*)::int as n from crm_pipeline_stages
            where pipeline_id = ${s.pipeline_id} and kind = ${s.kind} and id <> ${id}`
          return (others?.n ?? 0) === 0 ? s.kind : null
        }),
      )
      if (blocked) fail(422, `This is the pipeline's only ${blocked === 'won' ? 'won' : 'lost'} stage. Add another before changing it.`)
    }
    const rows = await attempt(c, 'crm.stage_update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        if (required_fields) {
          await sql`update crm_pipeline_stages set required_fields = ${sql.array(required_fields)}::text[] where id = ${id}`
        }
        if (Object.keys(rest).length === 0) return sql<{ id: string }[]>`select id from crm_pipeline_stages where id = ${id}`
        return sql<{ id: string }[]>`update crm_pipeline_stages set ${sql(rest)} where id = ${id} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not update the stage.')
    if (!rows.length) fail(404, 'That stage was not found.')
    await audit(c, { action: 'stage.update', entityType: 'crm_pipeline_stage', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .post('/pipelines/:id/stages/reorder', edit, async (c) => {
    const parsed = reorderStagesRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Send the stages in order.')
    const pipelineId = uuidParam(c)
    const ids = parsed.data.stage_ids
    const rows = await attempt(c, 'crm.stages_reorder', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        for (const [i, sid] of ids.entries()) {
          await sql`update crm_pipeline_stages set position = ${i} where id = ${sid} and pipeline_id = ${pipelineId}`
        }
        return sql<{ id: string }[]>`select id from crm_pipeline_stages where pipeline_id = ${pipelineId}`
      }),
    )
    if (!rows) fail(400, 'We could not reorder the stages.')
    if (!rows.length) fail(404, 'That pipeline was not found.')
    await audit(c, { action: 'stage.reorder', entityType: 'crm_pipeline', entityId: pipelineId, after: { stage_ids: ids } })
    return c.body(null, 204)
  })

  // A stage with deals in it cannot go; move them first.
  .delete('/stages/:id', remove, async (c) => {
    const id = uuidParam(c)
    const result = await attempt(c, 'crm.stage_delete', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [s] = await sql<{ kind: string; pipeline_id: string; deals: number }[]>`
          select kind, pipeline_id, (select count(*) from crm_leads l where l.stage_id = s.id)::int as deals
          from crm_pipeline_stages s where id = ${id}`
        if (!s) return 'missing' as const
        if (s.deals > 0) return 'in_use' as const
        const [others] = await sql<{ n: number }[]>`
          select count(*)::int as n from crm_pipeline_stages where pipeline_id = ${s.pipeline_id} and kind = ${s.kind} and id <> ${id}`
        if (s.kind !== 'open' && (others?.n ?? 0) === 0) return 'last' as const
        await sql`delete from crm_pipeline_stages where id = ${id}`
        return 'ok' as const
      }),
    )
    if (result === 'missing') fail(404, 'That stage was not found.')
    if (result === 'in_use') fail(409, 'Move the deals out of this stage first.')
    if (result === 'last') fail(422, 'A pipeline needs at least one won and one lost stage.')
    if (!result) fail(400, 'We could not delete the stage.')
    await audit(c, { action: 'stage.delete', entityType: 'crm_pipeline_stage', entityId: id })
    return c.body(null, 204)
  })

  // ── Moving a deal ───────────────────────────────────────────
  .post('/leads/:id/stage', edit, async (c) => {
    const parsed = moveStageRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Pick a stage.')
    const leadId = uuidParam(c)
    const v = parsed.data
    const result = await attempt(
      c,
      'crm.move_stage',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [r] = await sql<{ status: string }[]>`
            select crm_move_stage(${leadId}, ${v.stage_id}, ${v.lost_reason ?? null}, ${v.lost_competitor ?? null}) as status`
          return r ?? null
        }),
      { onCode: claimRule },
    )
    if (result && 'rule' in result) fail(422, result.rule)
    if (!result) fail(400, 'We could not move this deal.')
    await audit(c, { action: 'lead.move_stage', entityType: 'crm_lead', entityId: leadId, after: v })
    return c.json(moveStageResponse.parse({ status: result.status, stage_id: v.stage_id }))
  })

  // ── Lost reasons ────────────────────────────────────────────
  .get('/lost-reasons', async (c) => {
    const rows = await attempt(c, 'crm.lost_reasons', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select id, label, position, is_active from crm_lost_reasons order by position, label`),
    )
    if (!rows) fail(400, 'We could not load the lost reasons.')
    return c.json(lostReason.array().parse(rows))
  })

  .post('/lost-reasons', edit, async (c) => {
    const parsed = createLostReasonRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A reason needs at least 3 characters.')
    const row = await attempt(c, 'crm.lost_reason_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql`
          insert into crm_lost_reasons (company_id, label, position)
          values (get_current_company_id(), ${parsed.data.label}, (select coalesce(max(position), -1) + 1 from crm_lost_reasons))
          returning id, label, position, is_active`
        return r ?? null
      }),
    )
    if (!row) fail(400, 'We could not add that reason.')
    const created = lostReason.parse(row)
    await audit(c, { action: 'lost_reason.create', entityType: 'crm_lost_reason', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  .patch('/lost-reasons/:id', edit, async (c) => {
    const parsed = updateLostReasonRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.lost_reason_update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update crm_lost_reasons set ${sql(parsed.data)} where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not update that reason.')
    if (!rows.length) fail(404, 'That reason was not found.')
    await audit(c, { action: 'lost_reason.update', entityType: 'crm_lost_reason', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  .delete('/lost-reasons/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.lost_reason_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`delete from crm_lost_reasons where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete that reason.')
    if (!rows.length) fail(404, 'That reason was not found.')
    await audit(c, { action: 'lost_reason.delete', entityType: 'crm_lost_reason', entityId: id })
    return c.body(null, 204)
  })

  // ── Tags ────────────────────────────────────────────────────
  // One shared list per studio, replacing the single free-text group_name box
  // whose filter was never wired up (0197).
  .get('/tags', async (c) => {
    const rows = await attempt(c, 'crm.tags', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select t.id, t.name, t.color, t.is_active,
               (select count(*) from crm_lead_tags lt where lt.tag_id = t.id)::int as lead_count
          from crm_tags t
         order by t.is_active desc, lower(t.name)`),
    )
    if (!rows) fail(400, 'We could not load the tags.')
    return c.json(crmTag.array().parse(rows))
  })

  .post('/tags', edit, async (c) => {
    const parsed = createTagRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A tag needs a name of 1 to 40 characters.')
    const { name, color } = parsed.data
    const row = await attempt(c, 'crm.tag_create', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        // Typing a tag that already exists means "use that one", not "fail".
        // Anything else and the picker would refuse a name the studio can see.
        const [existing] = await sql<{ id: string }[]>`
          select id from crm_tags where lower(trim(name)) = lower(trim(${name}))`
        if (existing) {
          const [back] = await sql`
            update crm_tags set is_active = true where id = ${existing.id}
            returning id, name, color, is_active,
                      (select count(*) from crm_lead_tags lt where lt.tag_id = crm_tags.id)::int as lead_count`
          return back ?? null
        }
        const [r] = await sql`
          insert into crm_tags (company_id, name, color)
          values (get_current_company_id(), ${name}, ${color})
          returning id, name, color, is_active, 0 as lead_count`
        return r ?? null
      }),
    )
    if (!row) fail(400, 'We could not add that tag.')
    const created = crmTag.parse(row)
    await audit(c, { action: 'crm.tag_create', entityType: 'crm_tag', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  .patch('/tags/:id', edit, async (c) => {
    const parsed = updateTagRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.tag_update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        update crm_tags set ${sql(parsed.data)} where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not update that tag. A tag by that name may already exist.')
    if (!rows.length) fail(404, 'That tag was not found.')
    await audit(c, { action: 'crm.tag_update', entityType: 'crm_tag', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  // Deleting takes the tag off every lead that carried it, which is why the
  // picker offers "retire" first and this asks for the delete permission.
  .delete('/tags/:id', remove, async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.tag_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from crm_tags where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete that tag.')
    if (!rows.length) fail(404, 'That tag was not found.')
    await audit(c, { action: 'crm.tag_delete', entityType: 'crm_tag', entityId: id })
    return c.body(null, 204)
  })

  // The drawer sends the set it wants, not a diff, so adding one tag and
  // removing another are the same request.
  .put('/leads/:id/tags', edit, async (c) => {
    const parsed = setLeadTagsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Send up to 50 tag ids.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'crm.lead_tags_set', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select crm_set_lead_tags(${id}, ${parsed.data.tag_ids}::uuid[])`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not save those tags.')
    await audit(c, { action: 'crm.lead_tags_set', entityType: 'crm_lead', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  // Bulk, from the selection toolbar.
  .post('/leads/tags', edit, async (c) => {
    const parsed = tagLeadsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a tag and at least one lead.')
    const { ids, tag_id, attach } = parsed.data
    const row = await attempt(c, 'crm.leads_tag', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ n: number }[]>`select crm_tag_leads(${ids}::uuid[], ${tag_id}, ${attach}) as n`
        return r ?? null
      }),
    )
    if (!row) fail(400, 'We could not tag those leads.')
    await audit(c, { action: 'crm.leads_tag', entityType: 'crm_tag', entityId: tag_id, after: { count: ids.length, attach } })
    return c.json({ changed: row.n })
  })

  // ── Contacts ────────────────────────────────────────────────
  .get('/contacts', async (c) => {
    const q = contactsQuery.safeParse({
      q: c.req.query('q'),
      include_archived: c.req.query('include_archived'),
      crm_company_id: c.req.query('crm_company_id'),
      limit: c.req.query('limit'),
    })
    if (!q.success) fail(422, 'Invalid query.')
    const { q: text, include_archived, crm_company_id, limit } = q.data
    const needle = text ? `%${text.replace(/[%_]/g, '')}%` : null
    const rows = await attempt(c, 'crm.contacts', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          ${selectContacts(sql)}
          where ${include_archived ? sql`true` : sql`c.is_archived = false`}
            and ${crm_company_id ? sql`c.crm_company_id = ${crm_company_id}` : sql`true`}
            and ${needle ? sql`(c.name ilike ${needle} or c.phone ilike ${needle} or c.email ilike ${needle} or co.name ilike ${needle})` : sql`true`}
          order by c.created_at desc
          limit ${limit}`,
      ),
    )
    if (!rows) fail(400, 'We could not load contacts.')
    return c.json(crmContact.array().parse(rows))
  })

  .get('/contacts/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.contact', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`${selectContacts(sql)} where c.id = ${id}`),
    )
    if (!rows) fail(400, 'We could not load this contact.')
    if (!rows[0]) fail(404, 'That contact was not found.')
    return c.json(crmContact.parse(rows[0]))
  })

  .post('/contacts', create, async (c) => {
    const parsed = createContactRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the contact.')
    const v = parsed.data
    const auth = c.get('auth')
    const row = await attempt(
      c,
      'crm.contact_create',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const [r] = await sql<{ id: string }[]>`
            insert into crm_contacts (company_id, name, phone, email, lifecycle, owner_id, crm_company_id, notes, source, created_by)
            values (get_current_company_id(), ${v.name}, ${v.phone ?? null}, ${v.email ?? null}, ${v.lifecycle},
                    ${v.owner_id ?? null}, ${v.crm_company_id ?? null}, ${v.notes ?? null}, 'manual', ${auth.userId})
            returning id`
          if (!r) return null
          const [full] = await sql`${selectContacts(sql)} where c.id = ${r.id}`
          return full ?? null
        }),
      { onCode: (code) => (code === '23505' ? ('known' as const) : undefined) },
    )
    if (row === 'known') fail(409, 'A contact with that number already exists.')
    if (!row) fail(400, 'We could not add this contact.')
    const created = crmContact.parse(row)
    await audit(c, { action: 'contact.create', entityType: 'crm_contact', entityId: created.id, after: { name: v.name, phone: v.phone ?? null } })
    return c.json(created, 201)
  })

  .patch('/contacts/:id', edit, async (c) => {
    const parsed = updateContactRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(
      c,
      'crm.contact_update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const out = await sql<{ id: string }[]>`update crm_contacts set ${sql(parsed.data)} where id = ${id} returning id`
          // The deals on this person show the same name and number.
          if (out.length && (parsed.data.name !== undefined || parsed.data.phone !== undefined || parsed.data.email !== undefined || parsed.data.crm_company_id !== undefined)) {
            const sync: Record<string, unknown> = {}
            if (parsed.data.name !== undefined) sync.name = parsed.data.name
            if (parsed.data.phone !== undefined) sync.phone = parsed.data.phone
            if (parsed.data.email !== undefined) sync.email = parsed.data.email
            if (parsed.data.crm_company_id !== undefined) sync.crm_company_id = parsed.data.crm_company_id
            await sql`update crm_leads set ${sql(sync)} where contact_id = ${id}`
          }
          return out
        }),
      { onCode: (code) => (code === '23505' ? ('known' as const) : undefined) },
    )
    if (rows === 'known') fail(409, 'Another contact already has that number.')
    if (!rows) fail(400, 'We could not update this contact.')
    if (!rows.length) fail(404, 'That contact was not found.')
    await audit(c, { action: 'contact.update', entityType: 'crm_contact', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  // ── Companies ───────────────────────────────────────────────
  .get('/companies', async (c) => {
    const includeArchived = ['1', 'true'].includes(c.req.query('include_archived') ?? '')
    const rows = await attempt(c, 'crm.companies', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          ${selectCompanies(sql)}
          where ${includeArchived ? sql`true` : sql`co.is_archived = false`}
          order by co.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load companies.')
    return c.json(crmCompany.array().parse(rows))
  })

  .get('/companies/:id', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'crm.company', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`${selectCompanies(sql)} where co.id = ${id}`),
    )
    if (!rows) fail(400, 'We could not load this company.')
    if (!rows[0]) fail(404, 'That company was not found.')
    return c.json(crmCompany.parse(rows[0]))
  })

  .post('/companies', create, async (c) => {
    const parsed = createCrmCompanyRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the company.')
    const v = parsed.data
    const auth = c.get('auth')
    const row = await attempt(
      c,
      'crm.company_create',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const [r] = await sql<{ id: string }[]>`
            insert into crm_companies (company_id, name, domain, phone, city, notes, owner_id, created_by)
            values (get_current_company_id(), ${v.name}, ${v.domain ?? null}, ${v.phone ?? null}, ${v.city ?? null},
                    ${v.notes ?? null}, ${v.owner_id ?? null}, ${auth.userId})
            returning id`
          if (!r) return null
          const [full] = await sql`${selectCompanies(sql)} where co.id = ${r.id}`
          return full ?? null
        }),
      { onCode: (code) => (code === '23505' ? ('known' as const) : undefined) },
    )
    if (row === 'known') fail(409, 'A company with that name already exists.')
    if (!row) fail(400, 'We could not add this company.')
    const created = crmCompany.parse(row)
    await audit(c, { action: 'company.create', entityType: 'crm_company', entityId: created.id, after: { name: v.name } })
    return c.json(created, 201)
  })

  .patch('/companies/:id', edit, async (c) => {
    const parsed = updateCrmCompanyRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid update.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    const rows = await attempt(
      c,
      'crm.company_update',
      () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
          update crm_companies set ${sql(parsed.data)} where id = ${id} returning id`),
      { onCode: (code) => (code === '23505' ? ('known' as const) : undefined) },
    )
    if (rows === 'known') fail(409, 'Another company already has that name.')
    if (!rows) fail(400, 'We could not update this company.')
    if (!rows.length) fail(404, 'That company was not found.')
    await audit(c, { action: 'company.update', entityType: 'crm_company', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  // ── Forecast ────────────────────────────────────────────────
  .get('/forecast', async (c) => {
    const today = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const from = new Date(today)
    from.setDate(from.getDate() - 29)
    const to = new Date(today)
    to.setDate(to.getDate() + 90)
    const parsed = crmStatsQuery.safeParse({ from: c.req.query('from') ?? iso(from), to: c.req.query('to') ?? iso(to) })
    if (!parsed.success || parsed.data.to < parsed.data.from) fail(422, 'Pick a valid date range.')
    const range = parsed.data
    const rows = await attempt(c, 'crm.forecast', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ f: unknown }[]>`select crm_forecast(${range.from}::date, ${range.to}::date) as f`),
    )
    if (!rows) fail(400, 'We could not build the forecast.')
    return c.json(crmForecast.parse(rows[0]?.f ?? {}))
  })
