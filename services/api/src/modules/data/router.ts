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
  dataBoard,
  bulkDataRequest,
  bulkDataResult,
  handoverRequest,
  dataPerson,
  upsertDataPersonRequest,
  type DataBoardRow,
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
         d.copied_by_uid, coalesce(cu.name, dp.name, d.copied_by_name) as copied_by_name,
         d.copied_by_person_id,
         sh.name as shoot_name, sh.shoot_date,
         d.backup_folder_path, d.backup_cloud_link,
         d.received_by_uid, d.verified_by, vu.name as verified_by_name,
         d.handed_to_editor_at, d.archived_at, d.archive_location_id, al.name as archive_location_name
    from shoot_data_records d
    left join projects p on p.id = d.project_id
    left join shoots sh on sh.id = d.shoot_id
    left join users su on su.user_id = d.user_id
    left join users cu on cu.user_id = d.copied_by_uid
    left join storage_locations pl on pl.id = d.primary_location_id
    left join storage_locations bl on bl.id = d.backup_location_id
    left join storage_locations al on al.id = d.archive_location_id
    left join data_people dp on dp.id = d.copied_by_person_id
    left join users vu on vu.user_id = d.verified_by
   where ${where}
   order by d.created_at desc`

/**
 * The database's own words for a refused change ("say where the backup is
 * first", "pick a location"), as a sentence -- they are written for people.
 */
function explain(code: string, err: unknown): undefined {
  const msg = String((err as { message?: string })?.message ?? '')
  if (code === 'P0002') fail(404, msg ? `${msg[0]!.toUpperCase()}${msg.slice(1)}.` : 'Not found.')
  if (code === '22023' && msg) fail(422, `${msg[0]!.toUpperCase()}${msg.slice(1)}.`)
  return undefined
}

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
        (sql) => sql`
          select l.id, l.name, l.kind, l.location_type, l.capacity_gb, l.owner, l.notes, coalesce(l.is_active, true) as is_active,
                 coalesce(u.used_gb, 0)::float8 as used_gb, coalesce(u.n, 0)::int as record_count
            from storage_locations l
            left join lateral (
              select sum(d.size_gb) as used_gb, count(*) as n
                from shoot_data_records d
               where d.primary_location_id = l.id or d.backup_location_id = l.id or d.archive_location_id = l.id
            ) u on true
           order by coalesce(l.is_active, true) desc, l.name`,
      ),
    )
    if (!rows) fail(400, 'We could not load storage locations.')
    return c.json(locationList.parse(rows))
  })

  // Adding a name that is already there (any case) hands back that one --
  // brought back if it was archived -- instead of failing on the unique name.
  .post('/locations', requireAction('projects', 'edit'), async (c) => {
    const parsed = createStorageLocationRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the location details.')
    const auth = c.get('auth')
    const row = await attempt(c, 'data.locations.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [same] = await sql<{ id: string }[]>`
          select id from storage_locations where lower(btrim(name)) = lower(${parsed.data.name}) limit 1`
        const rows = same
          ? await sql`
              update storage_locations set is_active = true where id = ${same.id}
              returning id, name, kind, location_type, capacity_gb, owner, notes, is_active`
          : await sql`
              insert into storage_locations ${sql({ ...parsed.data, company_id: auth.companyId })}
              returning id, name, kind, location_type, capacity_gb, owner, notes, is_active`
        return rows[0] ? { row: rows[0], existed: !!same } : null
      }),
    )
    if (!row) fail(400, 'We could not add that location.')
    const created = storageLocation.parse(row.row)
    await audit(c, { action: 'storage_location.create', entityType: 'storage_location', entityId: created.id, after: parsed.data })
    return c.json(created, row.existed ? 200 : 201)
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

  // A location records point at is archived, not deleted: the records keep
  // saying where their copies went. An unused one goes for good.
  .delete('/locations/:id', requireAction('projects', 'edit'), async (c) => {
    const id = uuidParam(c)
    const result = await attempt(c, 'data.locations.delete', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [used] = await sql<{ n: number }[]>`
          select count(*)::int as n from shoot_data_records
           where primary_location_id = ${id} or backup_location_id = ${id} or archive_location_id = ${id}`
        const rows = (used?.n ?? 0) > 0
          ? await sql<{ id: string }[]>`update storage_locations set is_active = false where id = ${id} returning id`
          : await sql<{ id: string }[]>`delete from storage_locations where id = ${id} returning id`
        return { found: rows.length > 0, archived: (used?.n ?? 0) > 0 }
      }),
    )
    if (!result) fail(400, 'We could not remove this location.')
    if (!result.found) fail(404, 'That location was not found.')
    await audit(c, {
      action: result.archived ? 'storage_location.archive' : 'storage_location.delete',
      entityType: 'storage_location',
      entityId: id,
    })
    return c.json({ archived: result.archived })
  })

  // ── outside helpers who copy data ──────────────────────────────
  .get('/people', requireAction('projects', 'view'), async (c) => {
    const rows = await attempt(c, 'data.people.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, name, role, phone, coalesce(is_active, true) as is_active
          from data_people order by coalesce(is_active, true) desc, name`),
    )
    if (!rows) fail(400, 'We could not load helpers.')
    return c.json(dataPerson.array().parse(rows))
  })

  .post('/people', requireAction('projects', 'edit'), async (c) => {
    const parsed = upsertDataPersonRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please give the helper a name.')
    const auth = c.get('auth')
    const row = await attempt(c, 'data.people.create', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [same] = await sql<{ id: string }[]>`
          select id from data_people where lower(btrim(name)) = lower(${parsed.data.name}) limit 1`
        const fields = {
          name: parsed.data.name,
          role: parsed.data.role ?? null,
          phone: parsed.data.phone ?? null,
          is_active: true,
        }
        const rows = same
          ? await sql`
              update data_people
                 set is_active = true,
                     role = coalesce(${fields.role}, role),
                     phone = coalesce(${fields.phone}, phone)
               where id = ${same.id}
              returning id, name, role, phone, is_active`
          : await sql`insert into data_people ${sql({ ...fields, company_id: auth.companyId })} returning id, name, role, phone, is_active`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not add that helper.')
    return c.json(dataPerson.parse(row), 201)
  })

  .patch('/people/:id', requireAction('projects', 'edit'), async (c) => {
    const parsed = upsertDataPersonRequest.partial().safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success || Object.keys(parsed.data).length === 0) fail(422, 'Nothing to change.')
    const id = uuidParam(c)
    const row = await attempt(c, 'data.people.update', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`update data_people set ${sql(parsed.data)} where id = ${id} returning id, name, role, phone, is_active`
        return rows[0] ?? null
      }),
    { onCode: (code) => (code === '23505' ? fail(409, 'A helper with that name already exists.') : undefined) })
    if (!row) fail(404, 'That helper was not found.')
    return c.json(dataPerson.parse(row))
  })

  // ── the board: every booked person whose shoot day has come ────
  .get('/board', requireAction('projects', 'edit'), async (c) => {
    const project = uuidQuery(c, 'project_id')
    const LIMIT = 3000
    const result = await attempt(c, 'data.board', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const today = sql`(now() at time zone 'Asia/Kolkata')::date`
        const rows = await sql<(Omit<DataBoardRow, 'record' | 'stage'> & { record_id: string | null })[]>`
          with slots as (
            select 's:' || t.id as key, t.id as slot_id, d.id as record_id, t.shoot_id,
                   s.name as shoot_name, s.shoot_date, s.project_id, p.name as project_name, cl.name as client_name,
                   t.user_id, u.name as user_name, u.phone, t.service_name as role, t.start_at, t.end_at,
                   ${today} - coalesce(s.shoot_date, (t.start_at at time zone 'Asia/Kolkata')::date) as age_days
              from team_assignment_slots t
              join shoots s on s.id = t.shoot_id
              left join projects p on p.id = s.project_id
              left join clients cl on cl.id = p.client_id
              left join users u on u.user_id = t.user_id
              left join lateral (
                select id from shoot_data_records d where d.slot_id = t.id order by d.created_at limit 1
              ) d on true
             where t.status = 'booked'
               and s.status <> 'cancelled'
               and coalesce(s.shoot_date, (t.start_at at time zone 'Asia/Kolkata')::date) <= ${today}
               and (d.id is not null or (
                     coalesce(s.shoot_date, (t.start_at at time zone 'Asia/Kolkata')::date) >= ${today} - 180
                     and not (not t.data_required and nullif(btrim(t.data_not_required_reason), '') is not null)))
               and ${project ? sql`s.project_id = ${project}` : sql`true`}
          ), loose as (
            select 'r:' || d.id as key, null::uuid as slot_id, d.id as record_id, d.shoot_id,
                   s.name as shoot_name, s.shoot_date, d.project_id, p.name as project_name, cl.name as client_name,
                   d.user_id, coalesce(u.name, d.team_member_name) as user_name, u.phone, d.requirement_name as role,
                   null::timestamptz as start_at, null::timestamptz as end_at,
                   ${today} - coalesce(s.shoot_date, d.date_received, (d.created_at at time zone 'Asia/Kolkata')::date) as age_days
              from shoot_data_records d
              left join shoots s on s.id = d.shoot_id
              left join projects p on p.id = d.project_id
              left join clients cl on cl.id = p.client_id
              left join users u on u.user_id = d.user_id
             where not exists (select 1 from slots x where x.record_id = d.id)
               and ${project ? sql`d.project_id = ${project}` : sql`true`}
          )
          select * from slots union all select * from loose
          order by age_days desc, shoot_name, user_name
          limit ${LIMIT + 1}`
        const ids = rows.map((r) => r.record_id).filter((x): x is string => !!x)
        const records = ids.length ? await selectRecords(sql, sql`d.id = any(${ids}::uuid[])`) : []
        return { rows, records }
      }),
    )
    if (!result) fail(400, 'We could not load the data board.')
    const byId = new Map(list.parse(result.records).map((r) => [r.id, r]))
    const rows = result.rows.slice(0, LIMIT).map(({ record_id, ...r }) => {
      const record = record_id ? (byId.get(record_id) ?? null) : null
      return { ...r, age_days: Math.max(0, Number(r.age_days) || 0), record, stage: record ? record.data_status : 'missing' }
    })
    return c.json(dataBoard.parse({ rows, truncated: result.rows.length > LIMIT }))
  })

  // One change across many rows; a row it does not fit is skipped and counted.
  .post('/bulk', requireAction('projects', 'edit'), async (c) => {
    const parsed = bulkDataRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the change.')
    const b = parsed.data
    const row = await attempt(c, 'data.bulk', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ r: unknown }[]>`
          select bulk_data_update(
            p_slot_ids => ${b.slot_ids}::uuid[], p_record_ids => ${b.record_ids}::uuid[],
            p_action => ${b.action}, p_location_id => ${b.location_id ?? null}, p_folder => ${b.folder ?? null}) as r`
        return r?.r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not apply that change.')
    const out = bulkDataResult.parse(row)
    await audit(c, { action: 'data_record.bulk', entityType: 'shoot_data_record', entityId: null, after: { ...b, ...out } })
    return c.json(out)
  })

  // ── crew: their own records, and handing cards over ────────────
  .get('/mine', async (c) => {
    const me = c.get('auth').userId
    const rows = await attempt(c, 'data.mine', () =>
      withUser(c.env, me, (sql) => selectRecords(sql, sql`d.user_id = ${me}`)),
    )
    if (!rows) fail(400, 'We could not load your data.')
    return c.json(list.parse(rows))
  })

  .post('/mine/:slotId', async (c) => {
    const parsed = handoverRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the cards and size.')
    const slotId = uuidParam(c, 'slotId')
    const me = c.get('auth').userId
    const h = parsed.data
    const row = await attempt(c, 'data.handover', () =>
      withUser(c.env, me, async (sql) => {
        const [r] = await sql<{ id: string }[]>`
          select handover_slot_data(
            p_slot_id => ${slotId}, p_card_count => ${h.card_count}, p_size_gb => ${h.size_gb},
            p_handed_to_uid => ${h.handed_to_uid ?? null}, p_handed_to_name => ${h.handed_to_name ?? null},
            p_notes => ${h.notes ?? null}) as id`
        if (!r) return null
        const rows = await selectRecords(sql, sql`d.id = ${r.id}`)
        return rows[0] ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not save your handover.')
    const saved = dataRecord.parse(row)
    await audit(c, { action: 'data_record.handover', entityType: 'shoot_data_record', entityId: saved.id, after: h })
    return c.json(saved)
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
    { onCode: explain })
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
    { onCode: explain })
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
    { onCode: explain })
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
    { onCode: explain })
    if (!ok) fail(400, 'We could not verify the record.')
    await audit(c, { action: 'data_record.verify', entityType: 'shoot_data_record', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })
