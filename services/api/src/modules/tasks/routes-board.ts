import { Hono } from 'hono'
import { setBoardOrderRequest, z } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAction } from '../../middleware/permissions'
import { fillSlots, placeRestAfter, selectLaneOrder, writeLaneOrder } from './task-columns'
import { readDoneSince, selectTasks } from './task-query'
import { fail } from '../../middleware/errors'
import { textParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { list, toItems } from './shared'

/** The board's saved hand order and lane colours. */
export const boardRoutes = new Hono<AppEnv>()
  // ── Board (persisted drag order) ────────────────────────────
  .get('/board', requireAction('tasks', 'view'), async (c) => {
    const view = c.req.query('view') ?? 'default'
    const since = readDoneSince(c.req.query('done_since'))
    if (since === 'bad') fail(422, 'done_since must be a date (YYYY-MM-DD).')
    const result = await attempt(c, 'tasks.board', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const tasks = await selectTasks(sql, { since: since ?? undefined })
        const orders = await sql<{ task_id: string; sort_order: number }[]>`
          select task_id, sort_order from production_board_card_order where board_view = ${view}`
        return { tasks, orders }
      }),
    )
    if (!result) fail(400, 'We could not load the board.')
    const orderMap = new Map(result.orders.map((o) => [o.task_id, o.sort_order]))
    return c.json(list.parse(toItems(result.tasks, orderMap)))
  })

  /** Per-lane colour, so a studio can tint the piles it cares about. */
  .get('/board/lanes', requireAction('tasks', 'view'), async (c) => {
    const rows = await attempt(c, 'tasks.board_lanes', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select lane_key, color from board_lane_prefs where board_view = 'default'`),
    )
    if (!rows) fail(400, 'We could not load the board settings.')
    return c.json(z.object({ lane_key: z.string(), color: z.string() }).array().parse(rows))
  })

  .put('/board/lanes/:lane', requireAction('tasks', 'edit'), async (c) => {
    const lane = textParam(c, 'lane', 60)
    const parsed = z
      .object({ color: z.enum(['default', 'slate', 'blue', 'green', 'amber', 'rose', 'violet']) })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'That is not a colour this board uses.')
    const auth = c.get('auth')
    const ok = await attempt(c, 'tasks.board_lane_color', () =>
      withUser(c.env, auth.userId, async (sql) => {
        await sql`
          insert into board_lane_prefs (company_id, board_view, lane_key, color)
          values (${auth.companyId}, 'default', ${lane}, ${parsed.data.color})
          on conflict (company_id, board_view, lane_key)
            do update set color = excluded.color, updated_at = now()`
        return true
      }),
    )
    if (!ok) fail(400, 'We could not save that colour.')
    return c.body(null, 204)
  })

  .post('/board/order', requireAction('tasks', 'edit'), async (c) => {
    const parsed = setBoardOrderRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid board order payload.')
    const d = parsed.data
    const auth = c.get('auth')
    const ok = await attempt(c, 'tasks.board_order', () =>
      withUser(c.env, auth.userId, async (sql) => {
        // A filtered board sends only the cards it shows: read the whole lane
        // first, so the hidden ones can keep their places.
        const lane = d.keep_hidden
          ? ((await selectLaneOrder(sql, d.board_view, d.lane_key)) as unknown as { id: string }[]).map((r) => r.id)
          : null
        await sql`select set_board_lane_order(
          p_board_view => ${d.board_view}, p_lane_key => ${d.lane_key}, p_task_ids => ${d.task_ids}::uuid[])`
        // The paged board sends only a lane's first cards: the rest go after them.
        if (lane) await writeLaneOrder(sql, auth.companyId, d.board_view, d.lane_key, fillSlots(lane, d.task_ids))
        else if (d.rest_after) await placeRestAfter(sql, auth.companyId, d.board_view, d.lane_key, d.task_ids)
        return true
      }),
    )
    if (!ok) fail(400, 'We could not save the board order.')
    await audit(c, { action: 'board.reorder', entityType: 'board', entityId: d.board_view, after: { lane: d.lane_key, count: d.task_ids.length } })
    return c.body(null, 204)
  })
