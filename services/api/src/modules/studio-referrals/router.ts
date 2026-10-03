import { Hono } from 'hono'
import {
  myStudioReferrals,
  platformStudioReferrals,
  saveStudioRefTermsRequest,
  settleStudioReferralRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwnerOr, requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'

/**
 * Refer a studio (0237). A studio shares its link; a studio that signs up
 * through it is listed for the one that sent it. What a referral earns is
 * the platform owner's call, set on /platform/studio-referrals.
 */
type Env = AppEnv['Bindings']

const readTerms = (env: Env) =>
  withService(env, async (sql) => {
    const [t] = await sql<{ reward: string | null; discount_pct: string | null; hold_days: number | null }[]>`
      select studio_ref_reward as reward, studio_ref_discount_pct as discount_pct, studio_ref_hold_days as hold_days
        from platform_settings limit 1`
    return { reward: t?.reward ?? null, discount_pct: t?.discount_pct ?? null, hold_days: t?.hold_days ?? null }
  })

const base = (env: Env) => (env.APP_URL || 'https://studioautopilot.in').replace(/\/+$/, '')

export const studioReferralsRouter = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/', requireOwnerOr('settings_subscription', 'view'), async (c) => {
    const auth = c.get('auth')
    const data = await attempt(c, 'studio_referrals.mine', async () => {
      const mine = await withUser(c.env, auth.userId, async (sql) => {
        const [r] = await sql<{ code: string }[]>`select my_studio_ref_code() as code`
        const rows = await sql`select * from my_studio_referrals()`
        return { code: r!.code, rows }
      })
      return { ...mine, terms: await readTerms(c.env) }
    })
    if (!data) fail(400, 'We could not load your referrals.')
    return c.json(
      myStudioReferrals.parse({
        code: data.code,
        link: `${base(c.env)}/?studio_ref=${data.code}`,
        terms: data.terms,
        referrals: data.rows,
      }),
    )
  })

export const platformStudioReferralsRouter = new Hono<AppEnv>()
  .use('*', requireAuth, requirePlatformAdmin())
  .get('/studio-referrals', async (c) => {
    const data = await attempt(c, 'platform.studio_referrals', async () => {
      const rows = await withService(c.env, (sql) => sql`
        select r.id, r.code,
               coalesce(nullif(btrim(rc.display_name), ''), rc.name) as referrer_name,
               coalesce(nullif(btrim(co.display_name), ''), co.name) as studio_name,
               r.signed_up_at,
               (select min(o.created_at) from payment_orders o where o.company_id = r.referred_company_id and o.status = 'paid') as paid_at,
               r.reward_amount, r.rewarded_at, r.void_reason
          from studio_referrals r
          join companies rc on rc.id = r.referrer_company_id
          join companies co on co.id = r.referred_company_id
         order by r.signed_up_at desc
         limit 500`)
      return { rows, terms: await readTerms(c.env) }
    })
    if (!data) fail(400, 'We could not load studio referrals.')
    return c.json(platformStudioReferrals.parse({ terms: data.terms, referrals: data.rows }))
  })

  .put('/studio-referrals/terms', async (c) => {
    const parsed = saveStudioRefTermsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the numbers.')
    const t = parsed.data
    const ok = await attempt(c, 'platform.studio_ref_terms', () =>
      withService(c.env, (sql) => sql`
        update platform_settings
           set studio_ref_reward = ${t.reward}, studio_ref_discount_pct = ${t.discount_pct},
               studio_ref_hold_days = ${t.hold_days}, updated_at = now()`),
    )
    if (!ok) fail(400, 'We could not save the terms.')
    await audit(c, { action: 'platform.studio_ref_terms', entityType: 'platform_settings', entityId: null, after: t })
    return c.json(t)
  })

  .post('/studio-referrals/:id', async (c) => {
    const id = uuidParam(c)
    const parsed = settleStudioReferralRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the details.')
    const b = parsed.data
    const rows = await attempt(c, 'platform.studio_ref_settle', () =>
      withService(c.env, (sql) =>
        b.action === 'reward'
          ? sql`update studio_referrals set reward_amount = ${b.amount}, rewarded_at = now(), void_reason = null where id = ${id} returning id`
          : b.action === 'void'
            ? sql`update studio_referrals set void_reason = ${b.reason}, rewarded_at = null, reward_amount = null where id = ${id} returning id`
            : sql`update studio_referrals set void_reason = null, rewarded_at = null, reward_amount = null where id = ${id} returning id`,
      ),
    )
    if (!rows?.[0]) fail(404, 'That referral was not found.')
    await audit(c, { action: `platform.studio_ref_${b.action}`, entityType: 'studio_referral', entityId: id })
    return c.json({ ok: true })
  })
