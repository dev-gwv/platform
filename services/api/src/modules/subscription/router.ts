import { Hono } from 'hono'
import {
  activateRequest,
  activateResponse,
  createOrderRequest,
  createOrderResponse,
  diamondClaimRequest,
  diamondClaimResult,
  plan,
  subscriptionStatus,
} from '@ipc/contracts'
import { planSource } from '@ipc/domain'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { isDevLike, razorpayConfigured } from '../../lib/env'
import { createRazorpayOrder, verifyRazorpaySignature } from '../../lib/razorpay'
import { checkDiamondScreenshot } from '../../lib/diamond-check'
import { sendDiamondClaimNotice, sendDiamondResultEmail } from '../../lib/email'

/**
 * Plans + checkout. The order is priced in SQL (create_payment_order); when
 * Razorpay is configured the same amount is registered with the provider and
 * activation demands the Checkout signature. Without a provider, activation is
 * allowed only on a dev-like bench — never in production.
 */
export const subscriptionRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/plans', async (c) => {
    const rows = await attempt(c, 'subscription.plans', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, key, name, price, billing_interval,
                 description, currency, duration_days, features, is_active,
                 badge, billing_label, savings_label, monthly_equivalent, sort_order
          from plans
         where is_active = true
           -- A studio sees only its own audience's plans: IPC Diamond members the
           -- member prices, everyone else the one outsider plan (0214).
           and audience = (select member_tier from companies where id = get_current_company_id())
         order by sort_order, price`,
      ),
    )
    if (!rows) fail(400, 'We could not load plans.')
    return c.json(plan.array().parse((rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      description: (r['description'] as string | null) ?? null,
      currency: (r['currency'] as string | null) ?? 'INR',
      duration_days: r['duration_days'] ?? null,
      features: Array.isArray(r['features']) ? r['features'] : null,
      is_active: true,
      badge: (r['badge'] as string | null) ?? null,
      billing_label: (r['billing_label'] as string | null) ?? null,
      savings_label: (r['savings_label'] as string | null) ?? null,
      // numeric(12,2) arrives as a string from the driver.
      monthly_equivalent:
        r['monthly_equivalent'] === null || r['monthly_equivalent'] === undefined
          ? null
          : Number(r['monthly_equivalent']),
      sort_order: r['sort_order'] === null || r['sort_order'] === undefined ? null : Number(r['sort_order']),
    }))))
  })

  // Lovable parity: extended status (current/latest/can_purchase/webhook + history + recovery).
  //
  // Every column here used to be invented: companies.plan_key / plan_name /
  // plan_gate, users.plan_gate / plan_expiry and payment_orders.expires_at
  // exist on no table, so this endpoint 400'd on every call and the screen
  // showed "This didn't load". The real facts: the key is companies.plan, the
  // name comes from plans, an order's expiry is on the company_subscriptions
  // row activation writes, and the gate is derived — with the same CASE
  // 0004_access_control uses, so this and the access payload cannot disagree
  // about whether a studio has paid.
  .get('/status', async (c) => {
    const auth = c.get('auth')
    const row = await attempt(c, 'subscription.status', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const comp = await sql<Record<string, unknown>[]>`
          select c.plan as plan_key,
                 p.name as plan_name,
                 c.plan_expiry::text as plan_expiry,
                 company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until)::text as access_until,
                 c.member_tier,
                 case
                   when coalesce(c.plan_expiry,         'epoch'::timestamptz) > now() then 'active'
                   when coalesce(c.grandfathered_until, 'epoch'::timestamptz) > now() then 'grandfathered'
                   when coalesce(c.grace_until,         'epoch'::timestamptz) > now() then 'grace'
                   else 'expired'
                 end as plan_gate
            from companies c
            left join plans p on p.key = c.plan
           where c.id = ${auth.companyId}`
        const orders = await sql<Record<string, unknown>[]>`
          select o.id, o.status, o.amount, pl.name as plan_name,
                 o.created_at::text as created_at,
                 cs.expires_at::text as expires_at
            from payment_orders o
            left join plans pl on pl.id = o.plan_id
            left join lateral (
              -- Linked from 0131 onward; older rows fall back to the
              -- subscription for the same plan that started right after.
              select s.expires_at from company_subscriptions s
               where s.company_id = o.company_id
                 and (s.order_id = o.id
                      or (s.order_id is null and s.plan_id = o.plan_id and s.started_at >= o.created_at))
               order by s.order_id nulls last, s.started_at
               limit 1
            ) cs on true
           where o.company_id = ${auth.companyId}
           order by o.created_at desc
           limit 10`
        const claim = await sql<{ status: string; reason: string | null; created_at: string }[]>`
          select status, reason, created_at::text as created_at from diamond_claims
           where company_id = ${auth.companyId} and decided_by is distinct from 'superseded'
           order by created_at desc limit 1`
        const link = await sql<{ l: string | null }[]>`select diamond_group_link as l from platform_settings limit 1`
        return { comp: comp[0] ?? {}, orders, claim: claim[0] ?? null, groupLink: link[0]?.l ?? null }
      }),
    )
    if (!row) fail(400, 'We could not load subscription status.')
    const comp = row.comp as Record<string, unknown>
    const gate = (comp['plan_gate'] as string ?? 'expired') as 'active' | 'grandfathered' | 'grace' | 'expired'
    const orders = row.orders as Record<string, unknown>[]
    const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
    const accessUntil = str(comp['access_until'])
    const daysLeft = accessUntil ? Math.ceil((new Date(accessUntil).getTime() - Date.now()) / 86_400_000) : null
    // 0210: open access that ends within a couple of months is the 30-day
    // trial; the long grants a platform admin gives by hand stay
    // "grandfathered".
    const source = planSource(gate, orders)
    return c.json(subscriptionStatus.parse({
      plan_key: str(comp['plan_key']),
      plan_name: str(comp['plan_name']),
      plan_gate: gate,
      plan_expiry: str(comp['plan_expiry']),
      access_until: accessUntil,
      days_left: daysLeft,
      can_purchase: gate !== 'active',
      plan_source: source === 'grandfathered' && daysLeft !== null && daysLeft <= 60 ? 'trial' : source,
      latest_order_id: (orders[0]?.['id'] as string | undefined) ?? null,
      latest_order_status: (orders[0]?.['status'] as string | undefined) ?? null,
      webhook_configured: Boolean(c.env.RAZORPAY_WEBHOOK_SECRET),
      member_tier: comp['member_tier'] === 'diamond' ? 'diamond' : 'outsider',
      diamond_claim: row.claim,
      diamond_group_link: row.groupLink,
      history: orders.map((o) => ({
        id: String(o['id']),
        plan_name: str(o['plan_name']),
        // numeric(12,2) arrives as a string from the driver, not a number —
        // the old `typeof === 'number'` test nulled every amount.
        amount: o['amount'] === null || o['amount'] === undefined ? null : Number(o['amount']),
        status: str(o['status']),
        created_at: str(o['created_at']),
        expires_at: str(o['expires_at']),
      })),
    }))
  })

  .post('/order', requireOwner(), async (c) => {
    const parsed = createOrderRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'A plan is required.')
    const planId = parsed.data.plan_id

    const row = await attempt(c, 'subscription.order', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ order_id: string; amount: number }[]>`
          select * from create_payment_order(p_plan_id => ${planId})`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not start checkout.')

    let razorpayOrderId: string | null = null
    if (razorpayConfigured(c.env)) {
      const provider = await attempt(c, 'subscription.razorpay_order', () =>
        createRazorpayOrder(c.env, {
          amountRupees: row.amount,
          receipt: row.order_id,
          notes: { company_id: c.get('auth').companyId, plan_id: planId },
        }),
      )
      if (!provider) fail(400, 'We could not reach the payment provider. Please try again.')
      razorpayOrderId = provider.id
      // payment_orders has no client write policy (0016); the provider id is
      // set by the API alone, under the service role.
      const stored = await attempt(c, 'subscription.store_provider_order', () =>
        withService(
          c.env,
          (sql) => sql`
            update payment_orders set razorpay_order_id = ${razorpayOrderId}
            where id = ${row.order_id}`,
        ),
      )
      if (!stored) fail(400, 'We could not start checkout.')
    }

    await audit(c, {
      action: 'subscription.order_created',
      entityType: 'payment_order',
      entityId: row.order_id,
      after: { plan_id: planId, amount: row.amount, razorpay_order_id: razorpayOrderId },
    })

    return c.json(
      createOrderResponse.parse({
        order_id: row.order_id,
        amount: row.amount,
        currency: 'INR',
        razorpay_order_id: razorpayOrderId,
        key_id: razorpayConfigured(c.env) ? c.env.RAZORPAY_KEY_ID : null,
      }),
      201,
    )
  })

  // "I am an IPC Diamond member": the owner sends a screenshot of the IPC
  // Diamonds - Premium group (uploaded through /files first). Claude reads the
  // group name off it and a match approves at once; anything else is either
  // rejected with the reason or, when it could not be read, left for the
  // platform team. Every claim is in the platform inbox, revocable (0214).
  .post('/diamond/claim', requireOwner(), async (c) => {
    const parsed = diamondClaimRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Upload a screenshot first.')
    const auth = c.get('auth')

    const claimId = await attempt(
      c,
      'subscription.diamond_claim',
      () =>
        withUser(c.env, auth.userId, async (sql) => {
          const [r] = await sql<{ id: string }[]>`select diamond_submit_claim(${parsed.data.file_id}) as id`
          return r?.id ?? null
        }),
      { onCode: (code) => (code === '22023' ? 'bad' : undefined) },
    )
    if (claimId === 'bad') fail(422, 'Upload a screenshot image (PNG, JPEG or WEBP) of the group.')
    if (!claimId) fail(400, 'We could not send that. Please try again.')

    const file = await attempt(c, 'subscription.diamond_file', () =>
      withService(c.env, (sql) => sql<{ mime: string; bytes: Buffer; name: string }[]>`
        select f.mime, f.bytes, co.name
          from files f join companies co on co.id = f.company_id
         where f.id = ${parsed.data.file_id} and f.company_id = ${auth.companyId}`),
    )
    const img = file?.[0]
    const verdict = img
      ? await checkDiamondScreenshot(c.env.ANTHROPIC_API_KEY, { mime: img.mime, bytes: img.bytes })
      : ({ decision: 'manual', reason: 'The screenshot could not be read; the team will look at it.' } as const)

    let status: 'pending' | 'approved' | 'rejected' = 'pending'
    let reason: string | null = verdict.decision === 'approve' ? null : verdict.reason
    if (verdict.decision !== 'manual') {
      const decided = await attempt(c, 'subscription.diamond_decide', () =>
        withService(c.env, (sql) => sql<{ s: string }[]>`
          select diamond_decide(${claimId}, ${verdict.decision === 'approve'}, 'auto', ${reason},
                                ${verdict.reading ? sql.json(verdict.reading as never) : null}) as s`),
      )
      if (decided?.[0]?.s === 'approved' || decided?.[0]?.s === 'rejected') status = decided[0].s
    } else {
      // Nothing read: the reason says so, and a person decides from the inbox.
      await attempt(c, 'subscription.diamond_note', () =>
        withService(c.env, (sql) => sql`update diamond_claims set reason = ${reason} where id = ${claimId}`),
      )
    }

    const until = await attempt(c, 'subscription.diamond_until', () =>
      withService(c.env, (sql) => sql<{ u: string | null }[]>`
        select company_access_until(plan_expiry, grandfathered_until, grace_until)::text as u
          from companies where id = ${auth.companyId}`),
    )
    const accessUntil = until?.[0]?.u ?? null
    const studio = img?.name ?? 'Your studio'

    await audit(c, { action: `subscription.diamond_${status}`, entityType: 'company', entityId: auth.companyId })
    if (status !== 'pending') {
      await sendDiamondResultEmail(c.env, auth.email, { studio, approved: status === 'approved', reason, accessUntil })
    }
    const title = verdict.decision === 'manual' ? null : (verdict.reading?.group_title ?? null)
    await sendDiamondClaimNotice(c.env, {
      studio,
      outcome: status === 'approved' ? 'approved automatically' : status === 'rejected' ? 'not approved' : 'waiting for you',
      title,
    })
    if (status === 'approved') reason = null
    return c.json(diamondClaimResult.parse({ status, reason, access_until: accessUntil }), 201)
  })

  .post('/activate', requireOwner(), async (c) => {
    const parsed = activateRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Invalid activation payload.')
    const { order_id, payment_id, signature } = parsed.data

    // The signature is the proof of payment. It is optional in the contract
    // only so a dev bench without a provider can exercise the flow; anywhere a
    // provider is configured, or that is not dev-like, its absence is a refusal.
    const providerOn = razorpayConfigured(c.env)
    if (providerOn || !isDevLike(c.env)) {
      if (!signature) fail(400, 'Payment verification failed.')
      const razorpayOrderId = await attempt(c, 'subscription.lookup_order', () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const rows = await sql<{ razorpay_order_id: string | null }[]>`
            select razorpay_order_id from payment_orders where id = ${order_id}`
          return rows[0]?.razorpay_order_id ?? null
        }),
      )
      if (!razorpayOrderId) fail(400, 'Payment verification failed.')
      const ok = await verifyRazorpaySignature(
        `${razorpayOrderId}|${payment_id}`,
        signature,
        c.env.RAZORPAY_KEY_SECRET ?? '',
      )
      if (!ok) fail(400, 'Payment verification failed.')
    }

    const row = await attempt(c, 'subscription.activate', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ duplicate: boolean; expires_at: string }[]>`
          select * from activate_subscription(
            p_order_id => ${order_id},
            p_payment_id => ${payment_id})`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not activate your plan.')

    await audit(c, {
      action: row.duplicate ? 'subscription.activate_replayed' : 'subscription.activated',
      entityType: 'payment_order',
      entityId: order_id,
      after: { payment_id, expires_at: row.expires_at },
    })
    return c.json(activateResponse.parse(row))
  })
