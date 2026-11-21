import { Hono } from 'hono'
import { dashboardSummary, type DashboardSummary } from '@ipc/contracts'
import { homeWeekEnd, weekShootCounts, type WeekShoot } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { todayInIndia } from '../../lib/dates'
import { studioWork } from '../../lib/scope'

/** Who may see the whole studio's call list (the same set as GET /crm/queue). */
const SEES_ALL = new Set(['super_admin', 'admin', 'manager', 'platform_admin'])

/**
 * The studio Home's tiles as numbers (speed audit, 21 Nov: Home downloaded the
 * whole call queue, the week's shoots and every booking to show three
 * figures). Each part follows the screen it opens: Today's calls
 * (`crm_call_queue`, the same scope rule), Team Booking (the week's shoots and
 * their booked seats, `weekShootCounts`). Money is GET /billing/due.
 */
export const dashboardRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/summary', async (c) => {
    const auth = c.get('auth')
    const today = todayInIndia()
    const end = homeWeekEnd(today)
    const canCrm = auth.access.hasModule('crm')
    const canProjects = auth.access.hasAction('projects', 'view')
    // Home asks for everyone's calls when the caller may edit the CRM; the
    // queue itself still narrows to their own unless their role sees all.
    const scope = auth.access.hasAction('crm', 'edit') && SEES_ALL.has(auth.role) ? 'all' : 'mine'
    // Bookings: whoever plans crew sees everyone's, anyone else their own (GET /allocation).
    const onlyUser = auth.access.hasAction('projects', 'edit') ? null : auth.userId
    // Staff see only the shoots they are on (GET /shoots).
    const onlyOn = studioWork(c) ? null : auth.userId

    const out = await attempt(c, 'dashboard.summary', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [calls, shoots, slots] = await Promise.all([
          canCrm
            ? sql<{ to_call: number; not_contacted: number }[]>`
                select count(*)::int as to_call,
                       count(*) filter (where q.last_contacted_at is null)::int as not_contacted
                  from crm_call_queue(${scope}) q`
            : Promise.resolve(null),
          canProjects
            ? sql<WeekShoot[]>`
                select s.id, s.shoot_date::text as shoot_date, s.status,
                       coalesce((
                         select jsonb_agg(jsonb_build_object('name', sv.name, 'quantity', ss.quantity))
                           from shoot_services ss
                           join services sv on sv.id = ss.service_id
                          where ss.shoot_id = s.id
                       ), '[]'::jsonb) as requirements
                  from shoots s
                 where s.shoot_date >= ${today}::date and s.shoot_date <= ${end}::date
                   and s.status <> 'cancelled'
                   ${
                     onlyOn
                       ? sql`and exists (select 1 from team_assignment_slots t
                                          where t.shoot_id = s.id and t.user_id = ${onlyOn} and t.status <> 'cancelled')`
                       : sql``
                   }`
            : Promise.resolve(null),
          canProjects
            ? sql<{ shoot_id: string | null; service_name: string | null; status: string }[]>`
                select s.shoot_id, s.service_name, s.status
                  from team_assignment_slots s
                 where s.status = 'booked'
                   and (s.end_at at time zone 'Asia/Kolkata')::date >= ${today}::date
                   and (s.start_at at time zone 'Asia/Kolkata')::date <= ${end}::date
                   ${onlyUser ? sql`and s.user_id = ${onlyUser}` : sql``}`
            : Promise.resolve(null),
        ])
        const summary: DashboardSummary = {
          leads: calls ? (calls[0] ?? { to_call: 0, not_contacted: 0 }) : null,
          shoots: shoots && slots ? weekShootCounts(shoots, slots, today) : null,
        }
        return summary
      }),
    )
    if (!out) fail(400, 'We could not load your Home.')
    return c.json(dashboardSummary.parse(out))
  })
