import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import { pauseRoutineRequest, routineDoneRequest, saveRoutineRequest, taskRoutine, type SaveRoutineRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { todayInIndia } from '../../lib/dates'

/**
 * Daily tasks (0305, owner 14 Nov): a task that comes back by itself for the
 * people it is set for, every day or on the days picked. The database makes
 * each day's copy and rings when one is not done; this is where a routine is
 * set, changed, paused or taken off, and where a person ticks a copy done.
 *
 * Reads and writes go through the service connection with the caller's
 * company named in every statement: a routine's copies belong to other
 * people, and the tasks policies would hide them from a delegate who sets them.
 */

const routines = taskRoutine.array()

interface RawRoutine {
  id: string
  title: string
  description: string | null
  priority: string
  repeat: string
  weekdays: number[]
  month_day: number | null
  due_time: string | null
  starts_on: string
  ends_on: string | null
  paused: boolean
  project_id: string | null
  project_name: string | null
  created_by_name: string | null
  people: unknown
}

/** Every routine of a studio (or only the caller's), with each person's today and last week. */
function selectRoutines(sql: TransactionSql, company: string, opts: { mine?: string; id?: string } = {}) {
  const today = todayInIndia()
  return sql<RawRoutine[]>`
    select r.id, r.title, r.description, r.priority, r.repeat, r.weekdays::int[] as weekdays,
           r.month_day::int as month_day, to_char(r.due_time, 'HH24:MI') as due_time,
           to_char(r.starts_on, 'YYYY-MM-DD') as starts_on, to_char(r.ends_on, 'YYYY-MM-DD') as ends_on,
           r.paused, r.project_id, p.name as project_name, cu.name as created_by_name,
           coalesce((
             select json_agg(json_build_object(
                      'user_id', u.user_id,
                      'name', u.name,
                      'task_id', tk.id,
                      'today', case
                                 when tk.id is null then 'none'
                                 when tk.status::text = 'completed' then 'done'
                                 when ${today}::date + coalesce(r.due_time, time '19:00') <= (now() at time zone 'Asia/Kolkata') then 'late'
                                 else 'open'
                               end,
                      'done_7', (select count(*) from tasks h
                                  where h.routine_id = r.id and h.routine_for = u.user_id
                                    and h.due_date between ${today}::date - 7 and ${today}::date - 1
                                    and h.status::text = 'completed'),
                      'missed_7', (select count(*) from tasks h
                                    where h.routine_id = r.id and h.routine_for = u.user_id
                                      and h.due_date between ${today}::date - 7 and ${today}::date - 1
                                      and h.routine_missed))
                    order by u.name)
               from task_routine_people rp
               join users u on u.user_id = rp.user_id and u.deleted_at is null
               left join tasks tk on tk.routine_id = r.id and tk.routine_for = u.user_id and tk.due_date = ${today}::date
              where rp.routine_id = r.id
           ), '[]'::json) as people
      from task_routines r
      left join projects p on p.id = r.project_id
      left join users cu on cu.user_id = r.created_by
     where r.company_id = ${company}
       and ${opts.id ? sql`r.id = ${opts.id}` : sql`true`}
       and ${opts.mine ? sql`exists (select 1 from task_routine_people x where x.routine_id = r.id and x.user_id = ${opts.mine})` : sql`true`}
     order by r.paused, r.created_at desc`
}

/** The people picked must be working members of this studio. */
async function checkPeople(sql: TransactionSql, company: string, people: string[]): Promise<boolean> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from users
     where company_id = ${company} and user_id = any(${people}::uuid[])
       and deleted_at is null and status = 'active'`
  return (rows[0]?.n ?? 0) === new Set(people).size
}

function columns(d: SaveRoutineRequest) {
  return {
    title: d.title,
    description: d.description ?? null,
    priority: d.priority,
    repeat: d.repeat,
    weekdays: d.repeat === 'days' ? [...new Set(d.weekdays)].sort() : [1, 2, 3, 4, 5, 6, 7],
    month_day: d.repeat === 'monthly' ? (d.month_day ?? null) : null,
    due_time: d.due_time ?? null,
    ends_on: d.ends_on ?? null,
    paused: d.paused ?? false,
    project_id: d.project_id ?? null,
    ...(d.starts_on ? { starts_on: d.starts_on } : {}),
  }
}

/**
 * After a change: today's copies that no longer belong (a person taken off,
 * paused, today no longer one of its days) go if they were not done; the open
 * ones take the new wording; and today's missing copies are made.
 */
async function settleToday(sql: TransactionSql, id: string) {
  const today = todayInIndia()
  await sql`select set_config('ipc.task_quiet', '1', true)`
  await sql`
    delete from tasks t
     using task_routines r
     where r.id = ${id} and t.routine_id = r.id and t.due_date >= ${today}::date
       and t.status::text <> 'completed'
       and (not task_routine_due_on(r, t.due_date)
            or not exists (select 1 from task_routine_people p where p.routine_id = r.id and p.user_id = t.routine_for))`
  await sql`
    update tasks t
       set title = r.title, description = r.description, priority = r.priority, project_id = r.project_id
      from task_routines r
     where r.id = ${id} and t.routine_id = r.id and t.due_date >= ${today}::date and t.status::text <> 'completed'`
  await sql`select set_config('ipc.task_quiet', '', true)`
  await sql`select generate_routine_tasks(${today}::date, ${id}::uuid)`
}

export const routineRoutes = new Hono<AppEnv>()
  // Whoever manages tasks sees every routine; anyone else, the ones they are on.
  .get('/routines', async (c) => {
    const auth = c.get('auth')
    const all = auth.access.hasAction('tasks', 'view') && c.req.query('mine') !== '1'
    const rows = await attempt(c, 'tasks.routines.list', () =>
      withService(c.env, (sql) => selectRoutines(sql, auth.companyId, all ? {} : { mine: auth.userId })),
    )
    if (!rows) fail(400, 'We could not load the daily tasks.')
    return c.json(routines.parse(rows))
  })

  .post('/routines', requireAction('tasks', 'create'), async (c) => {
    const parsed = saveRoutineRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the daily task.')
    const d = parsed.data
    const auth = c.get('auth')
    const out = await attempt(c, 'tasks.routines.create', () =>
      withService(c.env, async (sql) => {
        if (!(await checkPeople(sql, auth.companyId, d.people))) return 'people' as const
        const [r] = await sql<{ id: string }[]>`
          insert into task_routines ${sql({ ...columns(d), company_id: auth.companyId, created_by: auth.userId })}
          returning id`
        if (!r) return null
        await sql`
          insert into task_routine_people (routine_id, user_id, company_id)
          select ${r.id}, u, ${auth.companyId} from unnest(${d.people}::uuid[]) u
          on conflict do nothing`
        await settleToday(sql, r.id)
        return (await selectRoutines(sql, auth.companyId, { id: r.id }))[0] ?? null
      }),
    )
    if (out === 'people') fail(422, 'Pick people who work in your studio.')
    if (!out) fail(400, 'We could not save the daily task.')
    await audit(c, { action: 'task_routine.create', entityType: 'task_routine', entityId: out.id, after: { title: d.title, people: d.people } })
    return c.json(taskRoutine.parse(out), 201)
  })

  .patch('/routines/:id', requireAction('tasks', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = saveRoutineRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the daily task.')
    const d = parsed.data
    const auth = c.get('auth')
    const out = await attempt(c, 'tasks.routines.update', () =>
      withService(c.env, async (sql) => {
        if (!(await checkPeople(sql, auth.companyId, d.people))) return 'people' as const
        const rows = await sql`
          update task_routines set ${sql(columns(d))}
           where id = ${id} and company_id = ${auth.companyId} returning id`
        if (!rows.length) return 'missing' as const
        await sql`delete from task_routine_people where routine_id = ${id} and user_id <> all(${d.people}::uuid[])`
        await sql`
          insert into task_routine_people (routine_id, user_id, company_id)
          select ${id}, u, ${auth.companyId} from unnest(${d.people}::uuid[]) u
          on conflict do nothing`
        await settleToday(sql, id)
        return (await selectRoutines(sql, auth.companyId, { id }))[0] ?? null
      }),
    )
    if (out === 'people') fail(422, 'Pick people who work in your studio.')
    if (out === 'missing') fail(404, 'That daily task was not found.')
    if (!out) fail(400, 'We could not save the daily task.')
    await audit(c, { action: 'task_routine.update', entityType: 'task_routine', entityId: id, after: { title: d.title, people: d.people } })
    return c.json(taskRoutine.parse(out))
  })

  .post('/routines/:id/pause', requireAction('tasks', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = pauseRoutineRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid request.')
    const auth = c.get('auth')
    const out = await attempt(c, 'tasks.routines.pause', () =>
      withService(c.env, async (sql) => {
        const rows = await sql`
          update task_routines set paused = ${parsed.data.paused}
           where id = ${id} and company_id = ${auth.companyId} returning id`
        if (!rows.length) return null
        await settleToday(sql, id)
        return (await selectRoutines(sql, auth.companyId, { id }))[0] ?? null
      }),
    )
    if (!out) fail(404, 'That daily task was not found.')
    await audit(c, { action: parsed.data.paused ? 'task_routine.pause' : 'task_routine.resume', entityType: 'task_routine', entityId: id })
    return c.json(taskRoutine.parse(out))
  })

  // Taken off: today's and later copies not yet done go with it; the days
  // already done stay in each person's history as ordinary finished tasks.
  .delete('/routines/:id', requireAction('tasks', 'delete'), async (c) => {
    const id = uuidParam(c)
    const auth = c.get('auth')
    const today = todayInIndia()
    const gone = await attempt(c, 'tasks.routines.delete', () =>
      withService(c.env, async (sql) => {
        await sql`select set_config('ipc.task_quiet', '1', true)`
        await sql`
          delete from tasks
           where routine_id = ${id} and company_id = ${auth.companyId}
             and due_date >= ${today}::date and status::text <> 'completed'`
        const rows = await sql`delete from task_routines where id = ${id} and company_id = ${auth.companyId} returning id`
        return rows.length > 0
      }),
    )
    if (!gone) fail(404, 'That daily task was not found.')
    await audit(c, { action: 'task_routine.delete', entityType: 'task_routine', entityId: id })
    return c.body(null, 204)
  })

  // The person on today's copy ticks it done in one tap (or takes it back).
  .post('/daily/:id/done', async (c) => {
    const id = uuidParam(c)
    const parsed = routineDoneRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid request.')
    const auth = c.get('auth')
    const status = await attempt(
      c,
      'tasks.daily_done',
      () =>
        withUser(c.env, auth.userId, async (sql) =>
          (await sql<{ s: string }[]>`select routine_task_done(${id}, ${parsed.data.done}) as s`)[0]?.s ?? null,
        ),
      {
        onCode: (code, err) => {
          if ((code === '22023' || code === 'P0002' || code === '42501') && err instanceof Error) {
            fail(code === 'P0002' ? 404 : code === '42501' ? 403 : 422, err.message)
          }
          return undefined
        },
      },
    )
    if (!status) fail(400, 'We could not update that daily task.')
    await audit(c, { action: parsed.data.done ? 'task.daily_done' : 'task.daily_undone', entityType: 'task', entityId: id })
    return c.json({ status })
  })
