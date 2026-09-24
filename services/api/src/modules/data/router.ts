import { Hono } from 'hono'
import {
  createDataRecordRequest,
  updateDataRecordRequest,
  dataRecord,
  verifyDataRequest,
  storageLocation,
  createStorageLocationRequest,
  updateStorageLocationRequest,
  setDataTrackRequest,
} from '@ipc/contracts'
import type { PendingQuery, Row, Sql, TransactionSql } from 'postgres'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam, uuidQuery } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

const list = dataRecord.array()
const locationList = storageLocation.array()

/**
 * The one shape a record is read in: with whose data it is, who copied it,
 * which shoot, and where both copies went. It was copy-pasted into three
 * routes before, and the copies had already drifted.
 */
const selectRecords = (sql: Sql | TransactionSql, where: PendingQuery<Row[]>) => sql`
  select d.id, d.data_label, d.data_type, d.project_id, p.name as project_name, d.shoot_id,
         d.primary_status, d.backup_status,
         d.primary_location_id, pl.name as primary_location_name,
         d.backup_location_id, bl.name as backup_location_name,
         d.card_count, d.size_gb, d.verified_at, d.created_at,
         d.folder_path, d.cloud_link, coalesce(d.file_count, 0) as file_count,
         d.date_received, d.received_by_name, d.notes, d.data_status,
         coalesce(d.issue_found, false) as issue_found, coalesce(d.is_not_required, false) as is_not_required,
         d.team_member_name, d.requirement_name,
         d.slot_id, d.user_id, coalesce(su.name, d.team_member_name) as user_name,
         d.copied_by_uid, coalesce(cu.name, d.copied_by_name) as copied_by_name,
         sh.name as shoot_name, sh.shoot_date,
         d.backup_folder_path, d.backup_cloud_link
    from shoot_data_records d
    left join projects p on p.id = d.project_id
    left join shoots sh on sh.id = d.shoot_id
    left join users su on su.user_id = d.user_id
    left join users cu on cu.user_id = d.copied_by_uid
    left join storage_locations pl on pl.id = d.primary_location_id
    left join storage_locations bl on bl.id = d.backup_location_id
   where ${where}
   order by d.created_at desc`

export const dataRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', requireAction('projects', 'view'), async (c) => {
    const shoot = uuidQuery(c, 'shoot_id')
    const project = uuidQuery(c, 'project_id')
    const slot = uuidQuery(c, 'slot_id')
    const rows = await attempt(c, 'data.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) =>
        selectRecords(
          sql,
          sql`${shoot ? sql`d.shoot_id = ${shoot}` : sql`true`}
            and ${project ? sql`d.project_id = ${project}` : sql`true`}
            and ${slot ? sql`d.slot_id = ${slot}` : sql`true`}`,
        ),
      ),
    )
    if (!rows) fail(400, 'We could not load data records.')
    return c.json(list.parse(rows))
  })

  .get('/locations', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'data.locations.list', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`select id, name, kind, location_type, capacity_gb, owner, notes, coalesce(is_active,true) as is_active from storage_locations order by name`,
      ),
    )
    if (!rows) fail(400, 'We could not load storage locations.')
    return c.json(locationList.parse(rows))
  })

  .post('/locations', requireAction('projects', 'edit'), async (c) => {
    const parsed = createStorageLocationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the location details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'data.locations.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const rows = await sql`
          insert into storage_locations ${sql({ ...parsed.data, company_id: auth.companyId })}
          returning id, name, kind, location_type, capacity_gb, owner, notes, is_active`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'A location with that name may already exist.')
    const created = storageLocation.parse(row)
    await audit(c, { action: 'storage_location.create', entityType: 'storage_location', entityId: created.id, after: parsed.data })
    return c.json(created, 201)
  })

  .patch('/locations/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateStorageLocationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the location details.')
    if (Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'data.locations.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`
          update storage_locations set ${sql(parsed.data)} where id = ${id}
          returning id, name, kind, location_type, capacity_gb, owner, notes, is_active`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That location was not found.')
    const updated = storageLocation.parse(row)
    await audit(c, { action: 'storage_location.update', entityType: 'storage_location', entityId: id, after: parsed.data })
    return c.json(updated)
  })

  .delete('/locations/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'data.locations.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from storage_locations where id = ${id} returning id`),
    )
    if (!rows) fail(400, 'We could not delete this location.')
    if (!rows.length) fail(404, 'That location was not found.')
    await audit(c, { action: 'storage_location.delete', entityType: 'storage_location', entityId: id })
    return c.body(null, 204)
  })

  .post('/', requireAction('projects', 'edit'), async (c) => {
    const parsed = createDataRecordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the record details.')
    const auth = c.get('auth')
    // The stage is derived by the database (0160); a caller's is ignored.
    const { data_status: _stage, ...body } = parsed.data
    const row = await attempt(c, 'data.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // A record for a booking takes its shoot, project, person and role
        // from the booking, so the row on the shoot card always finds it.
        let fromSlot: Record<string, unknown> = {}
        if (body.slot_id) {
          const [s] = await sql<
            { user_id: string; user_name: string | null; service_name: string | null; shoot_id: string | null; project_id: string | null }[]
          >`
            select t.user_id, u.name as user_name, t.service_name, t.shoot_id, sh.project_id
              from team_assignment_slots t
              left join users u on u.user_id = t.user_id
              left join shoots sh on sh.id = t.shoot_id
             where t.id = ${body.slot_id}`
          if (!s) return 'no_slot' as const
          fromSlot = {
            user_id: body.user_id ?? s.user_id,
            team_member_name: body.team_member_name ?? s.user_name,
            requirement_name: body.requirement_name ?? s.service_name,
            shoot_id: body.shoot_id ?? s.shoot_id,
            project_id: body.project_id ?? s.project_id,
          }
        }
        // Who copied it: whoever the caller named (null meaning "not
        // recorded"), else nobody when a typed name is given, else whoever is
        // logging it -- the old behaviour, kept for callers that say nothing.
        const copiedBy =
          body.copied_by_uid !== undefined ? body.copied_by_uid : body.copied_by_name ? null : auth.userId
        const inserted = await sql<{ id: string }[]>`
          insert into shoot_data_records ${sql({
            ...body,
            ...fromSlot,
            company_id: auth.companyId,
            copied_by_uid: copiedBy,
          })}
          returning id`
        if (!inserted[0]) return null
        const rows = await selectRecords(sql, sql`d.id = ${inserted[0].id}`)
        return rows[0] ?? null
      }),
    )
    if (row === 'no_slot') fail(404, 'We could not find that booking.')
    if (!row) fail(400, 'We could not create the record.')
    const created = dataRecord.parse(row)
    await audit(c, { action: 'data_record.create', entityType: 'shoot_data_record', entityId: created.id, after: body })
    return c.json(created, 201)
  })

  .patch('/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = updateDataRecordRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the record details.')
    const { data_status: _stage, ...patch } = parsed.data
    if (Object.keys(patch).length === 0) {
      // Nothing but a stage, which is derived: nothing to write.
      if (_stage === undefined) fail(422, 'Nothing to change.')
    }
    const id = uuidParam(c)
    const row = await attempt(c, 'data.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        if (Object.keys(patch).length > 0) await sql`update shoot_data_records set ${sql(patch)} where id = ${id}`
        const rows = await selectRecords(sql, sql`d.id = ${id}`)
        return rows[0] ?? null
      }),
    )
    if (!row) fail(404, 'That record was not found.')
    const updated = dataRecord.parse(row)
    await audit(c, { action: 'data_record.update', entityType: 'shoot_data_record', entityId: id, after: patch })
    return c.json(updated)
  })

  // Move one copy along (pending → copied → verified, or issue / not needed).
  .post('/:id/track', requireAction('projects', 'edit'), async (c) => {
    const parsed = setDataTrackRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please pick a status for that copy.')
    // Only the backup can be skipped; the main copy is the whole point.
    if (parsed.data.track === 'primary' && parsed.data.status === 'not_required') {
      fail(422, 'The main copy cannot be marked as not needed.')
    }
    const id = uuidParam(c)
    const row = await attempt(c, 'data.track', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select set_data_track(p_record_id => ${id}, p_track => ${parsed.data.track}, p_status => ${parsed.data.status})`
        const rows = await selectRecords(sql, sql`d.id = ${id}`)
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not update that copy.')
    await audit(c, { action: 'data_record.track', entityType: 'shoot_data_record', entityId: id, after: parsed.data })
    return c.json(dataRecord.parse(row))
  })

  // A verified record has already stood in for a real backup being confirmed
  // in hand -- deleting it would erase that custody trail, so only an
  // unverified record (still pending on both tracks) can be removed outright.
  .delete('/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'data.delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ id: string }[]>`
        delete from shoot_data_records
        where id = ${id} and primary_status = 'pending' and backup_status in ('pending', 'not_required')
        returning id`),
    )
    if (!rows) fail(400, 'We could not delete this record.')
    if (!rows.length) fail(404, 'That record was not found, or already has copies confirmed.')
    await audit(c, { action: 'data_record.delete', entityType: 'shoot_data_record', entityId: id })
    return c.body(null, 204)
  })

  .post('/:id/verify', requireAction('projects', 'edit'), async (c) => {
    const parsed = verifyDataRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid track.')
    const id = uuidParam(c)
    const ok = await attempt(c, 'data.verify', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select verify_data_record(p_record_id => ${id}, p_track => ${parsed.data.track})`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not verify the record.')
    await audit(c, { action: 'data_record.verify', entityType: 'shoot_data_record', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })
