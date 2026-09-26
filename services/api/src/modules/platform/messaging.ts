import { Hono } from 'hono'
import {
  marginRow,
  messageStatus,
  platformAdjustRequest,
  platformCreditRequest,
  platformOutboxMessage,
  platformOverdraftRequest,
  platformPrice,
  platformRechargeRequest,
  platformRejectRecharge,
  platformSetPrice,
  platformWallet,
  rechargeStatus,
  saveWhatsappTemplate,
  whatsappTemplate,
  z,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { whatsappConfigured } from '../../lib/whatsapp'
import { explain } from '../messaging/router'

const idOnly = z.object({ id: z.string() })

/**
 * The platform's side of the messaging wallet: every studio's balance, the
 * recharge requests to fulfil, the price list, the template catalogue, the
 * outbox and the margin. platform_admins only, checked here and again inside
 * every security-definer function.
 */
export const platformMessagingRouter = new Hono<AppEnv>()
  .use('*', requireAuth, requirePlatformAdmin())

  .get('/status', (c) =>
    c.json({
      whatsapp_live: whatsappConfigured(c.env),
      email_live: !!c.env.RESEND_API_KEY,
      webhook_signed: !!c.env.META_APP_SECRET,
    }),
  )

  .get('/wallets', async (c) => {
    const rows = await attempt(c, 'platform.messaging.wallets', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from platform_messaging_wallets()`),
    )
    if (!rows) fail(400, 'We could not load the wallets.')
    return c.json(platformWallet.array().parse(rows))
  })

  .get('/requests', async (c) => {
    const want = c.req.query('status')
    const status = want ? rechargeStatus.safeParse(want) : null
    if (want && !status?.success) fail(422, 'Unknown status.')
    const rows = await attempt(c, 'platform.messaging.requests', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select * from platform_recharge_requests(${status?.success ? status.data : null})`),
    )
    if (!rows) fail(400, 'We could not load the requests.')
    return c.json(platformRechargeRequest.array().parse(rows))
  })

  /** Money received outside the app (UPI, bank transfer): credit it. */
  .post('/credit', async (c) => {
    const parsed = platformCreditRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the amount and reference.')
    const v = parsed.data
    const row = await attempt(c, 'platform.messaging.credit', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ id: string }[]>`
          select platform_credit_wallet(${v.company_id}, ${v.amount_paise}, ${v.reference}, ${v.note ?? null}, ${v.request_id ?? null}) as id`
        return r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not credit the wallet.')
    await audit(c, { action: 'platform.wallet_credit', entityType: 'wallet', entityId: v.company_id, after: { ...v, ledger_id: row.id } })
    return c.json(idOnly.parse(row), 201)
  })

  .post('/adjust', async (c) => {
    const parsed = platformAdjustRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the amount and reason.')
    const v = parsed.data
    const row = await attempt(c, 'platform.messaging.adjust', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ id: string }[]>`select platform_adjust_wallet(${v.company_id}, ${v.amount_paise}, ${v.note}) as id`
        return r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not adjust the wallet.')
    await audit(c, { action: 'platform.wallet_adjust', entityType: 'wallet', entityId: v.company_id, after: { ...v, ledger_id: row.id } })
    return c.json(idOnly.parse(row), 201)
  })

  .post('/overdraft', async (c) => {
    const parsed = platformOverdraftRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'The overdraft must be between ₹0 and ₹1,000.')
    const v = parsed.data
    const ok = await attempt(c, 'platform.messaging.overdraft', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select platform_set_wallet_overdraft(${v.company_id}, ${v.overdraft_paise})`
        return true
      }),
    { onCode: explain })
    if (!ok) fail(400, 'We could not save the overdraft.')
    await audit(c, { action: 'platform.wallet_overdraft', entityType: 'wallet', entityId: v.company_id, after: v })
    return c.json({ ok: true })
  })

  .post('/requests/:id/reject', async (c) => {
    const id = uuidParam(c)
    const parsed = platformRejectRecharge.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the note.')
    const ok = await attempt(c, 'platform.messaging.reject', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select platform_reject_recharge(${id}, ${parsed.data.note ?? null})`
        return true
      }),
    { onCode: explain })
    if (!ok) fail(400, 'We could not update the request.')
    await audit(c, { action: 'platform.wallet_request_reject', entityType: 'wallet_recharge_request', entityId: id, after: parsed.data })
    return c.body(null, 204)
  })

  /** The current price per channel+category, with the history behind it. */
  .get('/prices', async (c) => {
    const rows = await attempt(c, 'platform.messaging.prices', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, channel, category, meta_cost_paise, markup_pct, markup_fixed_paise, free_monthly, effective_from,
               messaging_price_paise(meta_cost_paise, markup_pct, markup_fixed_paise) as price_paise
          from messaging_prices
         order by channel desc, category, effective_from desc, created_at desc
         limit 200`),
    )
    if (!rows) fail(400, 'We could not load the prices.')
    return c.json(platformPrice.array().parse(rows))
  })

  .post('/prices', async (c) => {
    const parsed = platformSetPrice.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the price.')
    const v = parsed.data
    if ((v.channel === 'email') !== (v.category === 'email')) fail(422, 'Email prices use the email category.')
    const row = await attempt(c, 'platform.messaging.price', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ id: string }[]>`
          select platform_set_messaging_price(${v.channel}, ${v.category}, ${v.meta_cost_paise}, ${v.markup_pct},
                                              ${v.markup_fixed_paise}, ${v.free_monthly ?? 0}) as id`
        return r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not save the price.')
    await audit(c, { action: 'platform.messaging_price', entityType: 'messaging_price', entityId: row.id, after: v })
    return c.json(idOnly.parse(row), 201)
  })

  .get('/templates', async (c) => {
    const rows = await attempt(c, 'platform.messaging.templates', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, key, name, meta_template_name, language, category, body, variables, status, updated_at
          from whatsapp_templates order by key`),
    )
    if (!rows) fail(400, 'We could not load the templates.')
    return c.json(whatsappTemplate.array().parse(rows))
  })

  .put('/templates', async (c) => {
    const parsed = saveWhatsappTemplate.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the template.')
    const v = parsed.data
    const row = await attempt(c, 'platform.messaging.template', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ id: string }[]>`
          select platform_save_whatsapp_template(${v.key}, ${v.name}, ${v.meta_template_name}, ${v.language}, ${v.category},
                                                 ${v.body}, ${sql.json(v.variables)}, ${v.status}) as id`
        return r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not save the template.')
    await audit(c, { action: 'platform.whatsapp_template', entityType: 'whatsapp_template', entityId: row.id, after: v })
    return c.json(idOnly.parse(row))
  })

  .get('/outbox', async (c) => {
    const want = c.req.query('status')
    const status = want ? messageStatus.safeParse(want) : null
    if (want && !status?.success) fail(422, 'Unknown status.')
    const rows = await attempt(c, 'platform.messaging.outbox', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select * from platform_message_outbox(${status?.success ? status.data : null}, 200)`),
    )
    if (!rows) fail(400, 'We could not load the messages.')
    return c.json(platformOutboxMessage.array().parse(rows))
  })

  /**
   * What studios paid against what the messages cost, per month (India time).
   * Failed messages were refunded and skipped ones never charged, so only
   * messages that went (or are going) out count.
   */
  .get('/margin', async (c) => {
    const monthsRaw = Number(c.req.query('months') ?? 6)
    const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(Math.trunc(monthsRaw), 1), 24) : 6
    const rows = await attempt(c, 'platform.messaging.margin', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select to_char(date_trunc('month', created_at at time zone 'Asia/Kolkata'), 'YYYY-MM') as month,
               channel,
               count(*)::int as messages,
               coalesce(sum(cost_paise), 0)::bigint as charged_paise,
               coalesce(sum(meta_cost_paise), 0)::bigint as cost_paise,
               (coalesce(sum(cost_paise), 0) - coalesce(sum(meta_cost_paise), 0))::bigint as margin_paise
          from message_outbox
         where status in ('queued', 'sending', 'sent', 'delivered', 'read')
           and created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
                             - make_interval(months => ${months - 1})
         group by 1, 2
         order by 1 desc, 2 desc`),
    )
    if (!rows) fail(400, 'We could not load the margin report.')
    return c.json(marginRow.array().parse(rows))
  })
