import { Hono, type Context, type Next } from 'hono'
import { deliveryReport, moneyReport, reportQuery, salesReport, teamReport, type z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { rpcJson } from '../../lib/rpc'

/**
 * Reports (0189): how the studio is doing for a period, one read per tab.
 *
 * Who sees what:
 *   - Sales, Delivery: the Reports module.
 *   - Money: Reports AND a money module (financials or money) -- the same
 *     people who can open Profit & Loss or Billing, since it is their numbers.
 *   - Team: Reports, or the Team Directory module.
 * The owner passes every check. Each tab is one SQL function run through
 * withUser, so RLS scopes it, and the studio id is passed as well.
 */
const DENIED = 'You do not have access to this report.'
const MAX_DAYS = 3 * 366

type Gate = (a: AppEnv['Variables']['auth']['access']) => boolean

const canSee: Record<'sales' | 'money' | 'delivery' | 'team', Gate> = {
  sales: (a) => a.hasModule('reports'),
  delivery: (a) => a.hasModule('reports'),
  money: (a) => a.hasModule('reports') && (a.hasModule('financials') || a.hasModule('money')),
  team: (a) => a.hasModule('reports') || a.hasModule('team_directory'),
}

function gate(tab: keyof typeof canSee) {
  return async (c: Context<AppEnv>, next: Next) => {
    const auth = c.get('auth')
    if (!auth.isOwner && !canSee[tab](auth.access)) fail(403, DENIED)
    await next()
  }
}

function period(c: Context<AppEnv>) {
  const parsed = reportQuery.safeParse({ from: c.req.query('from'), to: c.req.query('to') })
  if (!parsed.success) fail(422, 'Pick a start and an end date.')
  const { from, to } = parsed.data
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
  if (!Number.isFinite(days)) fail(422, 'Pick a start and an end date.')
  if (days > MAX_DAYS) fail(422, 'Pick a period of three years or less.')
  return { from, to }
}

const FN = {
  sales: 'report_sales',
  money: 'report_money',
  delivery: 'report_delivery',
  team: 'report_team',
} as const

async function run<S extends z.ZodTypeAny>(c: Context<AppEnv>, tab: keyof typeof FN, schema: S): Promise<z.infer<S>> {
  const { from, to } = period(c)
  const auth = c.get('auth')
  const row = await attempt(c, `reports.${tab}`, () =>
    withUser(c.env, auth.userId, async (sql) => {
      const rows = await sql<{ r: unknown }[]>`
        select ${sql(FN[tab])}(${auth.companyId}::uuid, ${from}::date, ${to}::date) as r`
      return { data: rpcJson(rows[0]?.r, null) }
    }),
  )
  if (!row?.data) fail(400, 'We could not load this report.')
  return schema.parse(row.data) as z.infer<S>
}

export const reportsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/sales', gate('sales'), async (c) => c.json(await run(c, 'sales', salesReport)))
  .get('/money', gate('money'), async (c) => c.json(await run(c, 'money', moneyReport)))
  .get('/delivery', gate('delivery'), async (c) => c.json(await run(c, 'delivery', deliveryReport)))
  .get('/team', gate('team'), async (c) => c.json(await run(c, 'team', teamReport)))
