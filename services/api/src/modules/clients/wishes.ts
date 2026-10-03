import { Hono } from 'hono'
import { clientOccasion, projectWishes, saveOccasionRequest, updateOccasionRequest, upcomingWish } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { todayInIndia } from '../../lib/dates'

/**
 * Wishes (0243): a client's birthdays and anniversary. The project's Wishes
 * tab reads and edits them; the dashboard and Clients read what comes round
 * soon. Every read and write goes through the caller's RLS.
 */
const occasionCols = 'id, client_id, project_id, kind, person_name, month, day, year, wish, source'

const dayExists = (month: number, day: number) => {
  const d = new Date(Date.UTC(2000, month - 1, day))
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

export const wishesRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/project/:id', requireAction('clients', 'view'), async (c) => {
    const id = uuidParam(c)
    const data = await attempt(c, 'wishes.project', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [p] = await sql<{ client_id: string; name: string; phone: string | null; email: string | null; studio: string }[]>`
          select cl.id as client_id, cl.name, cl.phone, cl.email, coalesce(nullif(btrim(co.display_name), ''), co.name) as studio
            from projects p join clients cl on cl.id = p.client_id join companies co on co.id = p.company_id
           where p.id = ${id}`
        if (!p) return null
        const occasions = await sql`
          select ${sql.unsafe(occasionCols)} from client_occasions where client_id = ${p.client_id}
           order by kind desc, created_at`
        return {
          client: { id: p.client_id, name: p.name, phone: p.phone, email: p.email },
          studio_name: p.studio,
          occasions,
        }
      }),
    )
    if (!data) fail(404, 'That project was not found.')
    return c.json(projectWishes.parse(data))
  })

  .get('/client/:id', requireAction('clients', 'view'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'wishes.client', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select ${sql.unsafe(occasionCols)} from client_occasions where client_id = ${id} order by kind desc, created_at`),
    )
    if (!rows) fail(400, 'We could not load the dates.')
    return c.json(clientOccasion.array().parse(rows))
  })

  .get('/upcoming', requireAction('clients', 'view'), async (c) => {
    const days = Math.min(366, Math.max(1, Number(new URL(c.req.url).searchParams.get('days') ?? '30') || 30))
    const today = todayInIndia()
    const rows = await attempt(c, 'wishes.upcoming', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<Record<string, unknown>[]>`
        select ${sql.unsafe(occasionCols.split(', ').map((col) => `o.${col}`).join(', '))},
               cl.name as client_name, cl.phone as client_phone,
               occasion_next(o.month, o.day, ${today}::date)::text as on
          from client_occasions o join clients cl on cl.id = o.client_id
         where o.wish and occasion_next(o.month, o.day, ${today}::date) <= ${today}::date + ${days}::int
         order by occasion_next(o.month, o.day, ${today}::date), cl.name`),
    )
    if (!rows) fail(400, 'We could not load the dates.')
    return c.json(upcomingWish.array().parse(rows))
  })

  .post('/occasions', requireAction('clients', 'edit'), async (c) => {
    const parsed = saveOccasionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the date and try again.')
    const b = parsed.data
    if (!dayExists(b.month, b.day)) fail(422, 'That day does not exist in that month.')
    const row = await attempt(
      c,
      'wishes.occasion_create',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [r] = await sql`
            insert into client_occasions (company_id, client_id, project_id, kind, person_name, month, day, year, wish, created_by)
            select cl.company_id, cl.id, ${b.project_id ?? null}, ${b.kind}, ${b.person_name}, ${b.month}, ${b.day},
                   ${b.year ?? null}, ${b.wish ?? true}, ${c.get('auth').userId}
              from clients cl where cl.id = ${b.client_id}
            returning ${sql.unsafe(occasionCols)}`
          return r ?? null
        }),
      {
        onCode: (code) =>
          code === '23505'
            ? fail(409, b.kind === 'anniversary' ? 'This client already has an anniversary.' : `${b.person_name || 'This person'} already has a birthday here.`)
            : undefined,
      },
    )
    if (!row) fail(404, 'That client was not found.')
    await audit(c, { action: 'client.occasion_add', entityType: 'client', entityId: b.client_id, after: { kind: b.kind } })
    return c.json(clientOccasion.parse(row), 201)
  })

  .patch('/occasions/:id', requireAction('clients', 'edit'), async (c) => {
    const id = uuidParam(c)
    const parsed = updateOccasionRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success || Object.keys(parsed.data).length === 0) fail(422, 'Please check the date and try again.')
    const b = parsed.data
    const row = await attempt(
      c,
      'wishes.occasion_update',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const [cur] = await sql<{ month: number; day: number }[]>`select month, day from client_occasions where id = ${id}`
          if (!cur) return null
          if (!dayExists(b.month ?? cur.month, b.day ?? cur.day)) return 'bad_day' as const
          // A date the studio edits is the studio's now: the wedding day no longer moves it.
          const patch = { ...b, ...(b.month || b.day || b.year !== undefined ? { source: 'studio' } : {}) }
          const [r] = await sql`update client_occasions set ${sql(patch)} where id = ${id} returning ${sql.unsafe(occasionCols)}`
          return r ?? null
        }),
      { onCode: (code) => (code === '23505' ? fail(409, 'That person already has this date here.') : undefined) },
    )
    if (row === 'bad_day') fail(422, 'That day does not exist in that month.')
    if (!row) fail(404, 'That date was not found.')
    return c.json(clientOccasion.parse(row))
  })

  .delete('/occasions/:id', requireAction('clients', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'wishes.occasion_delete', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`delete from client_occasions where id = ${id} returning id`),
    )
    if (!rows?.length) fail(404, 'That date was not found.')
    return c.body(null, 204)
  })

