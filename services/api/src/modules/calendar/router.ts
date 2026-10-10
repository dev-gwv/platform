import { randomBytes } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { buildIcsFeed } from '@ipc/domain'
import { calendarLink, calendarScope, type CalendarScope } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { mineEvents, studioEvents, type MineRow, type StudioRow } from '../../lib/calendar-feed'

/**
 * Shoots in Google Calendar (0257). The signed-in side hands a person their
 * link and makes a new one; the public side is the link itself, which
 * Google reads every few hours. Tokens are service-only, so every query here
 * runs as the service, scoped by hand to the caller's own studio and self.
 */

const newToken = () => randomBytes(24).toString('base64url')
const TOKEN = /^[A-Za-z0-9_-]{24,64}$/

/** The address Google is given: this API's own origin, as /public/files is. */
const feedUrl = (c: Context<AppEnv>, token: string) => `${new URL(c.req.url).origin}/public/calendar/${token}.ics`

/** Only the people who plan the shoots get the studio's whole calendar. */
function mayHave(c: Context<AppEnv>, scope: CalendarScope): boolean {
  return scope === 'mine' || c.get('auth').access.hasAction('projects', 'edit')
}

function scopeOf(raw: unknown): CalendarScope {
  const parsed = calendarScope.safeParse(raw ?? 'mine')
  if (!parsed.success) fail(422, 'Pick your shoots or the studio’s.')
  return parsed.data
}

export const calendarRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  /** The person's live link, made the first time it is asked for. */
  .get('/link', async (c) => {
    const scope = scopeOf(c.req.query('scope'))
    if (!mayHave(c, scope)) fail(403, 'Only people who plan the shoots can have the studio’s calendar.')
    const { userId, companyId } = c.get('auth')
    const token = await attempt(c, 'calendar.link', () =>
      withService(c.env, async (sql) => {
        const [live] = await sql<{ token: string }[]>`
          select token from calendar_feed_tokens
           where company_id = ${companyId} and user_id = ${userId} and scope = ${scope} and revoked_at is null`
        if (live) return live.token
        const [made] = await sql<{ token: string }[]>`
          insert into calendar_feed_tokens (company_id, user_id, scope, token)
          values (${companyId}, ${userId}, ${scope}, ${newToken()})
          on conflict (company_id, user_id, scope) where revoked_at is null do update set token = calendar_feed_tokens.token
          returning token`
        return made?.token ?? null
      }),
    )
    if (!token) fail(400, 'We could not make your calendar link.')
    return c.json(calendarLink.parse({ scope, url: feedUrl(c, token) }))
  })

  /** A new link; the old one stops working at once (a phone lost, a link shared). */
  .post('/link/rotate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { scope?: unknown }
    const scope = scopeOf(body.scope)
    if (!mayHave(c, scope)) fail(403, 'Only people who plan the shoots can have the studio’s calendar.')
    const { userId, companyId } = c.get('auth')
    const token = await attempt(c, 'calendar.rotate', () =>
      withService(c.env, async (sql) => {
        await sql`
          update calendar_feed_tokens set revoked_at = now()
           where company_id = ${companyId} and user_id = ${userId} and scope = ${scope} and revoked_at is null`
        const [made] = await sql<{ token: string }[]>`
          insert into calendar_feed_tokens (company_id, user_id, scope, token)
          values (${companyId}, ${userId}, ${scope}, ${newToken()})
          returning token`
        return made?.token ?? null
      }),
    )
    if (!token) fail(400, 'We could not make a new link.')
    await audit(c, { action: 'calendar.link_rotate', entityType: 'calendar_feed', entityId: null, after: { scope } })
    return c.json(calendarLink.parse({ scope, url: feedUrl(c, token) }))
  })

/**
 * The link itself. A wrong, old or withdrawn token is a plain 404 -- the
 * same answer whatever the reason, so a guess learns nothing. A person
 * removed from the studio, or no longer one who plans, stops being served.
 */
export const publicCalendarRouter = new Hono<AppEnv>().get('/calendar/:file', async (c) => {
  const token = c.req.param('file').replace(/\.ics$/i, '')
  if (!TOKEN.test(token)) fail(404, 'This calendar link is not valid.')

  const feed = await attempt(c, 'calendar.feed', () =>
    withService(c.env, async (sql) => {
      const [t] = await sql<{ id: string; company_id: string; user_id: string; scope: CalendarScope; studio: string; role: string; last_read_at: Date | null }[]>`
        select t.id, t.company_id, t.user_id, t.scope, co.name as studio, u.role::text as role, t.last_read_at
          from calendar_feed_tokens t
          join companies co on co.id = t.company_id
          join users u on u.user_id = t.user_id and u.company_id = t.company_id and u.deleted_at is null
         where t.token = ${token} and t.revoked_at is null`
      if (!t) return null
      if (t.scope === 'studio' && !['super_admin', 'admin', 'manager'].includes(t.role)) return null
      // Google reads every few hours; a stamp an hour old is fresh enough.
      if (!t.last_read_at || Date.now() - new Date(t.last_read_at).getTime() > 3_600_000) {
        await sql`update calendar_feed_tokens set last_read_at = now() where id = ${t.id}`
      }
      if (t.scope === 'mine') {
        const rows = await sql<MineRow[]>`
          select s.id as slot_id, s.start_at, s.end_at, s.service_name, s.response,
                 sh.name as shoot_name, sh.location, sh.map_link,
                 p.name as project_name, cl.name as client_name
            from team_assignment_slots s
            left join shoots sh on sh.id = s.shoot_id
            left join projects p on p.id = sh.project_id
            left join clients cl on cl.id = p.client_id
           where s.company_id = ${t.company_id} and s.user_id = ${t.user_id}
             and s.status = 'booked' and coalesce(s.response, 'confirmed') <> 'declined'
             and coalesce(sh.status, '') <> 'cancelled'
             and s.end_at > now() - interval '30 days' and s.start_at < now() + interval '365 days'
           order by s.start_at
           limit 2000`
        return buildIcsFeed({ name: `${t.studio} · My shoots`, events: mineEvents(rows, t.studio) })
      }
      const rows = await sql<StudioRow[]>`
        select sh.id as shoot_id, sh.name as shoot_name, sh.shoot_date::text as shoot_date, sh.start_at, sh.end_at,
               sh.location, sh.map_link, p.name as project_name, cl.name as client_name,
               (select string_agg(coalesce(u.name, 'Someone') || coalesce(' (' || s.service_name || ')', ''), ', ' order by s.start_at)
                  from team_assignment_slots s
                  left join users u on u.user_id = s.user_id
                 where s.shoot_id = sh.id and s.status = 'booked' and coalesce(s.response, 'confirmed') <> 'declined') as crew
          from shoots sh
          join projects p on p.id = sh.project_id
          left join clients cl on cl.id = p.client_id
         where sh.company_id = ${t.company_id}
           and coalesce(sh.status, '') <> 'cancelled'
           and coalesce(sh.start_at::date, sh.shoot_date) between (now() - interval '30 days')::date and (now() + interval '365 days')::date
         order by coalesce(sh.start_at, sh.shoot_date::timestamptz)
         limit 2000`
      return buildIcsFeed({ name: `${t.studio} · Shoots`, events: studioEvents(rows, t.studio) })
    }),
  )
  if (!feed) fail(404, 'This calendar link is not valid.')
  c.header('Content-Type', 'text/calendar; charset=utf-8')
  c.header('Content-Disposition', 'inline; filename="shoots.ics"')
  c.header('Cache-Control', 'private, max-age=900')
  return c.body(feed)
})
