import { Hono } from 'hono'
import { makeOffersRequest, makeOffersResult, platformOffer, studioActivity } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/**
 * What each studio is doing, and personal offers (0268; owner, 17 Oct). The
 * Studio Access Manager reads the activity beside its list, and makes an
 * offer for the studios ticked there. An offer is a percent off the first
 * plan only, for the regular price unless it says Diamond members too; the
 * database skips everyone else and says why.
 *
 * Mounted inside platformRouter, so only a platform admin reaches it, and
 * every function checks is_platform_admin() again.
 */
export const platformOffersRouter = new Hono<AppEnv>()
  .get('/activity', async (c) => {
    const rows = await attempt(c, 'platform.activity', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from platform_studio_activity()`),
    )
    if (!rows) fail(400, 'We could not load what the studios are doing.')
    return c.json(studioActivity.array().parse(rows))
  })

  .get('/offers', async (c) => {
    const rows = await attempt(c, 'platform.offers', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from platform_list_offers()`),
    )
    if (!rows) fail(400, 'We could not load the offers.')
    return c.json(platformOffer.array().parse(rows))
  })

  .post('/offers', async (c) => {
    const parsed = makeOffersRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick the studios, a discount, the plans and the last day.')
    const d = parsed.data
    const row = await attempt(
      c,
      'platform.make_offers',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const r = await sql<{ r: unknown }[]>`
            select platform_make_offers(${d.company_ids}::uuid[], ${d.percent}, ${d.tiers}::text[], ${d.until}::date,
                                        ${d.note ?? null}, ${d.for_diamond}) as r`
          return r[0]?.r ?? null
        }),
      { onCode: (code) => (code === '22023' ? fail(422, 'Pick today or a later day, and a discount from 1 to 90%.') : undefined) },
    )
    if (!row) fail(400, 'We could not make the offer.')
    const result = makeOffersResult.parse(row)
    await audit(c, {
      action: 'platform.offers_made',
      entityType: 'company',
      entityId: null,
      after: { percent: d.percent, tiers: d.tiers, until: d.until, for_diamond: d.for_diamond, made: result.made, skipped: result.skipped.length },
    })
    return c.json(result)
  })

  .post('/offers/:id/cancel', async (c) => {
    const id = uuidParam(c)
    const ok = await attempt(c, 'platform.cancel_offer', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select platform_cancel_offer(${id})`),
    )
    if (!ok) fail(400, 'We could not end the offer.')
    await audit(c, { action: 'platform.offer_cancelled', entityType: 'company', entityId: null, after: { offer_id: id } })
    return c.json({ ok: true })
  })
