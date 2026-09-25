import { Hono } from 'hono'
import {
  createServiceRequest,
  createShootRequest,
  saveShootPresetRequest,
  serviceOption,
  shootListItem,
  myShoot,
  shootPreset,
  shootPresetKind,
  updateServiceRequest,
  updateShootRequest,
  type ShootRequirementInput,
} from '@ipc/contracts'
import { mergeServiceNeeds } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam, uuidQuery } from '../../lib/params'
import type { TransactionSql } from 'postgres'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = shootListItem.array()
const services = serviceOption.array()
const presets = shootPreset.array()

/**
 * Attach "who and what this day needs" to a shoot.
 *
 * Requirements arrive by name, not by id: the picker lets a studio type
 * "Drone pilot" the first time it books one. The service row is upserted on
 * the way past, which is why there is no services admin screen to visit first
 * — the list on the picker is simply what this company has asked for before.
 */
async function saveRequirements(
  sql: TransactionSql,
  companyId: string,
  shootId: string,
  requirements: ShootRequirementInput[],
) {
  for (const { name, quantity } of mergeServiceNeeds(requirements)) {
    // do update, not do nothing: `returning` is empty on a skipped insert, and
    // the id is the whole point of the round trip.
    const svc = await sql<{ id: string }[]>`
      insert into services (company_id, name) values (${companyId}, ${name})
      on conflict (company_id, name) do update set name = excluded.name
      returning id`
    await sql`
      insert into shoot_services ${sql({
        company_id: companyId,
        shoot_id: shootId,
        service_id: svc[0]!.id,
        quantity,
      })}`
  }
}

/** The shared projection, as a fragment the two list queries embed. */
const selectShoots = (sql: TransactionSql) => sql`
  select s.id, s.name, s.project_id, s.shoot_date, s.start_at, s.end_at, s.location, s.map_link, s.status,
         p.name as project_name, cl.name as client_name,
         -- The booking screen fills crew against these, so they travel with
         -- the shoot rather than costing a request per row.
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'service_id', ss.service_id, 'name', sv.name, 'quantity', ss.quantity)
                  order by sv.name)
           from shoot_services ss
           join services sv on sv.id = ss.service_id
           where ss.shoot_id = s.id
         ), '[]'::jsonb) as requirements
  from shoots s
  left join projects p on p.id = s.project_id
  left join clients cl on cl.id = p.client_id`

export const shootsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // The caller's own shoots: every shoot they hold a booking slot on. Needs no
  // module gate — RLS on the slots table already scopes what comes back.
  // Declared before '/' so a query-less GET does not swallow it.
  .get('/my', async (c) => {
    const auth = c.get('auth')
    const rows = await attempt(c, 'shoots.my', () =>
      withUser(
        c.env,
        auth.userId,
        (sql) => sql`
          ${selectShoots(sql)}
          where s.status <> 'cancelled'
            and exists (
              select 1 from team_assignment_slots t
              where t.shoot_id = s.id and t.user_id = ${auth.userId} and t.status <> 'cancelled'
            )
          order by s.shoot_date asc nulls last`,
      ),
    )
    if (!rows) fail(400, 'We could not load your shoots.')
    // Who else is on each shoot: names and roles, never payouts.
    const ids = rows.map((r) => (r as { id: string }).id)
    const crew = ids.length
      ? await attempt(c, 'shoots.my_crew', () =>
          withUser(c.env, auth.userId, (sql) => sql<{ shoot_id: string; user_id: string; name: string; service_name: string | null }[]>`
            select t.shoot_id, t.user_id, coalesce(u.name, 'Someone') as name, t.service_name
              from team_assignment_slots t
              left join users u on u.user_id = t.user_id
             where t.shoot_id = any(${ids}::uuid[]) and t.status = 'booked'
             order by t.start_at, u.name`),
        )
      : []
    return c.json(
      myShoot.array().parse(
        rows.map((r) => ({ ...r, crew: (crew ?? []).filter((m) => m.shoot_id === (r as { id: string }).id) })),
      ),
    )
  })

  .get('/', requireAction('projects', 'view'), async (c) => {
    const project = uuidQuery(c, 'project_id')
    const assignee = uuidQuery(c, 'assignee')
    const rows = await attempt(c, 'shoots.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          ${selectShoots(sql)}
          where ${project ? sql`s.project_id = ${project}` : sql`true`}
            and ${
              assignee
                ? sql`exists (
                    select 1 from team_assignment_slots t
                    where t.shoot_id = s.id and t.user_id = ${assignee} and t.status <> 'cancelled'
                  )`
                : sql`true`
            }
          order by s.shoot_date asc nulls last`,
      ),
    )
    if (!rows) fail(400, 'We could not load shoots.')
    return c.json(list.parse(rows))
  })

  // Declared above /:id-shaped routes so "services" is never read as an id.
  .get('/services', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'shoots.services', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select id, name from services order by name asc`,
      ),
    )
    if (!rows) fail(400, 'We could not load services.')
    return c.json(services.parse(rows))
  })

  .post('/services', requireAction('projects', 'edit'), async (c) => {
    const parsed = createServiceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the service.')
    const auth = c.get('auth')
    const row = await attempt(
      c,
      'shoots.services.create',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const rows = await sql`
            insert into services ${sql({ company_id: auth.companyId, name: parsed.data.name })}
            returning id, name`
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (row === 'taken') fail(409, 'A service with this name already exists.')
    if (!row) fail(400, 'We could not add this service.')
    await audit(c, { action: 'service.create', entityType: 'service', entityId: row.id, after: parsed.data })
    return c.json(serviceOption.parse(row), 201)
  })

  .patch('/services/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateServiceRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the service.')
    const id = uuidParam(c)
    const row = await attempt(
      c,
      'shoots.services.update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql`update services set name = ${parsed.data.name} where id = ${id} returning id, name`
          return rows[0] ?? null
        }),
      { onCode: (code) => (code === '23505' ? 'taken' : undefined) },
    )
    if (row === 'taken') fail(409, 'A service with this name already exists.')
    if (!row) fail(404, 'That service was not found.')
    await audit(c, { action: 'service.update', entityType: 'service', entityId: id, after: parsed.data })
    return c.json(serviceOption.parse(row))
  })

  .delete('/services/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'shoots.services.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from services where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this service.')
    if (!rows.length) fail(404, 'That service was not found.')
    await audit(c, { action: 'service.delete', entityType: 'service', entityId: id })
    return c.body(null, 204)
  })

  .get('/presets', requireAction('projects', 'view'), async (c) => {
    const kind = shootPresetKind.safeParse(c.req.query('kind'))
    const rows = await attempt(c, 'shoots.presets.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, kind, name, payload from shoot_presets
          where ${kind.success ? sql`kind = ${kind.data}` : sql`true`}
          order by name asc`,
      ),
    )
    if (!rows) fail(400, 'We could not load presets.')
    return c.json(presets.parse(rows))
  })

  .post('/presets', requireAction('projects', 'edit'), async (c) => {
    const parsed = saveShootPresetRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please name the preset.')
    const auth = c.get('auth')
    const row = await attempt(c, 'shoots.presets.save', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // Saving over a name that exists is what "save preset" means to the
        // person pressing it — not a second entry with the same label.
        const rows = await sql`
          insert into shoot_presets ${sql({
            company_id: auth.companyId,
            kind: parsed.data.kind,
            name: parsed.data.name,
            payload: sql.json(parsed.data.payload),
          })}
          on conflict (company_id, kind, name) do update set payload = excluded.payload
          returning id, kind, name, payload`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not save the preset.')
    return c.json(shootPreset.parse(row), 201)
  })

  .delete('/presets/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'shoots.presets.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from shoot_presets where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete the preset.')
    if (!rows.length) fail(404, 'That preset was not found.')
    return c.body(null, 204)
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    const auth = c.get('auth')
    // Requirements live in their own table, so they must come off the row
    // before it is spread into the insert.
    const { requirements = [], ...fields } = parsed.data
    const row = await attempt(c, 'shoots.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          insert into shoots ${sql({ ...fields, company_id: auth.companyId })} returning id`
        const shoot = rows[0]
        if (!shoot) return null
        await saveRequirements(sql, auth.companyId, shoot.id, requirements)
        return shoot
      }),
    )
    if (!row) fail(400, 'We could not create the shoot.')
    await audit(c, { action: 'shoot.create', entityType: 'shoot', entityId: row.id, after: parsed.data })
    return c.json({ id: row.id }, 201)
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateShootRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the shoot details.')
    if (Object.keys(parsed.data).length === 0) return c.body(null, 204)
    const id = uuidParam(c)
    // Requirements live in their own table: when supplied they replace the
    // set outright (same dedupe as create), never merge silently.
    const { requirements, ...fields } = parsed.data
    const rows = await attempt(c, 'shoots.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        // requirements-only patch: no scalar columns to SET, but the row must
        // still exist (and belong to this studio) before its crew is replaced.
        const updated =
          Object.keys(fields).length > 0
            ? await sql<{ id: string }[]>`
                update shoots set ${sql(fields)} where id = ${id} returning id`
            : await sql<{ id: string }[]>`select id from shoots where id = ${id}`
        if (!updated.length) return updated
        if (requirements !== undefined) {
          await sql`delete from shoot_services where shoot_id = ${id}`
          await saveRequirements(sql, c.get('auth').companyId, id, requirements)
        }
        return updated
      }),
    )
    if (!rows) fail(400, 'We could not update the shoot.')
    if (!rows.length) fail(404, 'That shoot was not found.')
    await audit(c, { action: 'shoot.update', entityType: 'shoot', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  // Delete a shoot outright. Bookings release (their shoot link is set null)
  // rather than vanish; requirements go with the shoot.
  .delete('/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'shoots.delete', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        // A booking for a shoot that no longer exists is not a booking: it
        // is released (and says when), then unlinked.
        await sql`
          update team_assignment_slots set status = 'released', released_at = now()
           where shoot_id = ${id} and status = 'booked'`
        await sql`update team_assignment_slots set shoot_id = null where shoot_id = ${id}`
        return sql<{ id: string }[]>`delete from shoots where id = ${id} returning id`
      }),
    )
    if (!rows) fail(400, 'We could not delete this shoot.')
    if (!rows.length) fail(404, 'That shoot was not found.')
    await audit(c, { action: 'shoot.delete', entityType: 'shoot', entityId: id })
    return c.body(null, 204)
  })
