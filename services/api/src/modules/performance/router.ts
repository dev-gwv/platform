import { Hono, type Context } from 'hono'
import { memberScorecard, memberScorecardHistory, scorecardTeamRow } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'

/**
 * The scorecard (0208), under /performance. The functions decide who may
 * read what: yourself, or anyone in your studio if you run it.
 */
const RUNS = new Set(['super_admin', 'admin', 'manager', 'platform_admin'])

/** A month as [first, last] dates, India time. `YYYY-MM`, or this month. */
function monthRange(month: string | undefined, back = 0): { from: string; to: string } {
  const now = new Date(Date.now() + 5.5 * 3600_000)
  let y = now.getUTCFullYear()
  let m = now.getUTCMonth()
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) fail(422, 'Month is YYYY-MM.')
    y = Number(month.slice(0, 4))
    m = Number(month.slice(5, 7)) - 1
  }
  const first = new Date(Date.UTC(y, m - back, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
}

async function history(c: Context<AppEnv>, userId: string) {
  const auth = c.get('auth')
  const out = await attempt(
    c,
    'performance.history',
    () =>
      withUser(c.env, auth.userId, async (sql) => {
        const months = []
        for (let back = 5; back >= 0; back--) {
          const r = monthRange(undefined, back)
          const [row] = await sql<{ c: unknown }[]>`select member_scorecard(${userId}::uuid, ${r.from}::date, ${r.to}::date) as c`
          months.push(row?.c)
        }
        const [u] = await sql<{ name: string }[]>`select name from users where user_id = ${userId}`
        return { user_id: userId, name: u?.name ?? '', months }
      }),
    { onCode: (code) => (code === '42501' ? ('forbidden' as const) : undefined) },
  )
  if (out === 'forbidden') fail(403, 'You can see your own performance, or your team’s if you run the studio.')
  if (!out) fail(400, 'We could not load the scorecard.')
  return memberScorecardHistory.parse(out)
}

export const performanceRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Everyone's month, best first.
  .get('/', async (c) => {
    const auth = c.get('auth')
    if (!RUNS.has(auth.role)) fail(403, 'Only the owner or a manager can see the whole team.')
    const r = monthRange(c.req.query('month'))
    const rows = await attempt(c, 'performance.team', () =>
      withUser(c.env, auth.userId, (sql) => sql`select * from member_scorecard_team(${r.from}::date, ${r.to}::date)`),
    )
    if (!rows) fail(400, 'We could not load the team’s performance.')
    return c.json({ ...r, items: scorecardTeamRow.array().parse(rows) })
  })

  .get('/me', async (c) => c.json(await history(c, c.get('auth').userId)))

  .get('/members/:id', async (c) => c.json(await history(c, uuidParam(c))))

  // This month only, for the dashboard card.
  .get('/me/month', async (c) => {
    const auth = c.get('auth')
    const r = monthRange(undefined)
    const rows = await attempt(c, 'performance.month', () =>
      withUser(c.env, auth.userId, (sql) => sql<{ c: unknown }[]>`select member_scorecard(${auth.userId}::uuid, ${r.from}::date, ${r.to}::date) as c`),
    )
    if (!rows?.[0]) fail(400, 'We could not load your month.')
    return c.json(memberScorecard.parse(rows[0].c))
  })
