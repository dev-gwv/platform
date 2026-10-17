import { Hono } from 'hono'
import { myOffer, offerMarkRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'

/**
 * The studio's personal offer from the platform owner (0268): a percent off
 * its first plan, until a day ends. Only the owner sees it -- the person who
 * buys -- and seeing it or pressing Talk to us on WhatsApp is marked once, so
 * the platform owner can tell an offer that was read from one that was not.
 * Mounted inside subscriptionRouter (requireAuth).
 */
export const subscriptionOfferRouter = new Hono<AppEnv>()
  .get('/', async (c) => {
    const a = c.get('auth')
    if (!a.isOwner) return c.json(null)
    const rows = await attempt(c, 'subscription.offer', () =>
      withUser(c.env, a.userId, (sql) => sql`select * from my_offer()`),
    )
    return c.json(myOffer.parse(rows?.[0] ?? null))
  })

  .post('/:id/mark', async (c) => {
    const a = c.get('auth')
    if (!a.isOwner) return c.json({ ok: true })
    const parsed = offerMarkRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Unknown mark.')
    const id = uuidParam(c)
    // Best effort: a lost mark never troubles the studio.
    await attempt(c, 'subscription.offer_mark', () =>
      withUser(c.env, a.userId, (sql) => sql`select offer_mark(${id}, ${parsed.data.kind})`),
    )
    return c.json({ ok: true })
  })
