import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import {
  createRechargeRequest,
  ledgerEntry,
  ledgerQuery,
  messagingSummary,
  testMessageRequest,
  testMessageResult,
  updateMessagingSettings,
  walletState,
  z,
  MESSAGING_EVENTS,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requireOwner } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { uuidParam } from '../../lib/params'
import { whatsappConfigured } from '../../lib/whatsapp'

/** The database's own sentence for a refusal ("pick an amount between …"). */
export function explain(code: string, err: unknown): undefined {
  const msg = String((err as { message?: string })?.message ?? '')
  const sentence = msg ? `${msg[0]!.toUpperCase()}${msg.slice(1)}.` : ''
  if (code === 'P0002') fail(404, sentence || 'Not found.')
  if (code === '22023' && msg) fail(422, sentence)
  if (code === '42501' && msg && msg !== 'not allowed') fail(403, sentence)
  return undefined
}

/** Counted as sent (and paid for) this month. */
const CHARGED = ['queued', 'sending', 'sent', 'delivered', 'read']

async function readWallet(sql: TransactionSql) {
  const [w] = await sql<{ balance_paise: number; low_balance_paise: number }[]>`
    select balance_paise, low_balance_paise from wallets where company_id = get_current_company_id()`
  const [on] = await sql<{ any: boolean; whatsapp_enabled: boolean }[]>`
    select messaging_whatsapp_enabled() as whatsapp_enabled,
           exists (select 1 from messaging_settings
                    where company_id = get_current_company_id()
                      and ((whatsapp and messaging_whatsapp_enabled()) or email)) as any`
  const balance = Number(w?.balance_paise ?? 0)
  const low = Number(w?.low_balance_paise ?? 10000)
  return {
    balance_paise: balance,
    low_balance_paise: low,
    low: !!on?.any && balance < low,
    whatsapp_enabled: !!on?.whatsapp_enabled,
  }
}

/**
 * The studio's side of the messaging wallet. Owner only: it is the studio's
 * money. RLS says the same thing again (the tables are readable only by the
 * owner), and every write is a security-definer function that checks.
 */
export const messagingRouter = new Hono<AppEnv>()
  .use('*', requireAuth, requireOwner())

  /** Balance and whether to warn: the dashboard banner reads only this. */
  .get('/wallet', async (c) => {
    const w = await attempt(c, 'messaging.wallet', () => withUser(c.env, c.get('auth').userId, readWallet))
    if (!w) fail(400, 'We could not load the wallet.')
    return c.json(walletState.parse({ ...w, whatsapp_live: whatsappConfigured(c.env) }))
  })

  .get('/', async (c) => {
    const out = await attempt(c, 'messaging.summary', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const wallet = await readWallet(sql)
        const [usage] = await sql<Record<string, number>[]>`
          select
            count(*) filter (where channel = 'whatsapp' and status = any(${CHARGED}::text[]))::int as whatsapp_count,
            coalesce(sum(cost_paise) filter (where channel = 'whatsapp' and status = any(${CHARGED}::text[])), 0)::bigint as whatsapp_paise,
            count(*) filter (where channel = 'email' and free_allowance and status = any(${CHARGED}::text[]))::int as email_free_used,
            count(*) filter (where channel = 'email' and not free_allowance and status = any(${CHARGED}::text[]))::int as email_charged_count,
            coalesce(sum(cost_paise) filter (where channel = 'email' and status = any(${CHARGED}::text[])), 0)::bigint as email_paise,
            count(*) filter (where status = 'skipped_no_balance')::int as skipped_no_balance,
            count(*) filter (where channel = 'email' and status = any(${CHARGED}::text[]))::int as email_month_count,
            count(*) filter (where status = 'skipped_limit')::int as skipped_limit,
            (select coalesce(max(email_monthly_cap), 10000) from wallets where company_id = get_current_company_id())::int
              as email_monthly_cap
          from message_outbox
          where company_id = get_current_company_id() and created_at >= messaging_month_start()`
        // While the platform has WhatsApp off, a studio sees nothing of it:
        // no price, no toggle, no test button.
        const wa = wallet.whatsapp_enabled
        const allPrices = await sql<{ channel: string }[]>`select * from messaging_price_list()`
        const prices = wa ? allPrices : allPrices.filter((p) => p.channel !== 'whatsapp')
        const saved = await sql<{ event: string; whatsapp: boolean; email: boolean }[]>`
          select event, whatsapp, email from messaging_settings where company_id = get_current_company_id()`
        const settings = MESSAGING_EVENTS.map((e) => {
          const s = saved.find((r) => r.event === e.key)
          return { event: e.key, whatsapp: wa && !e.emailOnly ? (s?.whatsapp ?? false) : false, email: s?.email ?? false }
        })
        const requests = await sql`
          select id, amount_paise, note, status, created_at, decided_at, admin_note
            from wallet_recharge_requests where company_id = get_current_company_id()
           order by created_at desc limit 10`
        const recent = await sql`
          select id, channel, to_address, template_key, subject, status, cost_paise, error, created_at,
                 refunded_at is not null as refunded
            from message_outbox where company_id = get_current_company_id()
             ${wa ? sql`` : sql`and channel = 'email'`}
           order by created_at desc limit 25`
        const emailFree = (prices as unknown as Array<{ channel: string; free_monthly: number }>).find((p) => p.channel === 'email')
        return {
          wallet: { ...wallet, whatsapp_live: whatsappConfigured(c.env) },
          usage: { ...usage, email_free_monthly: emailFree?.free_monthly ?? 0 },
          prices,
          settings,
          requests,
          recent,
          email_live: !!c.env.RESEND_API_KEY,
          whatsapp_enabled: wa,
        }
      }),
    )
    if (!out) fail(400, 'We could not load messaging.')
    return c.json(messagingSummary.parse(out))
  })

  .get('/ledger', async (c) => {
    const parsed = ledgerQuery.safeParse({
      source: c.req.query('source') || undefined,
      from: c.req.query('from') || undefined,
      to: c.req.query('to') || undefined,
    })
    if (!parsed.success) fail(422, 'Please check the filters.')
    const { source, from, to } = parsed.data
    const rows = await attempt(c, 'messaging.ledger', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select id, kind, amount_paise, balance_after, source, reference, note, message_id, created_at
          from wallet_ledger
         where company_id = get_current_company_id()
           ${source ? sql`and source = ${source}` : sql``}
           ${from ? sql`and created_at >= (${from}::date at time zone 'Asia/Kolkata')` : sql``}
           ${to ? sql`and created_at < ((${to}::date + 1) at time zone 'Asia/Kolkata')` : sql``}
         order by created_at desc, id
         limit 1000`),
    )
    if (!rows) fail(400, 'We could not load the wallet history.')
    return c.json(ledgerEntry.array().parse(rows))
  })

  .post('/recharge-requests', async (c) => {
    const parsed = createRechargeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the amount.')
    const v = parsed.data
    const row = await attempt(c, 'messaging.recharge_request', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql<{ id: string }[]>`select request_wallet_recharge(${v.amount_paise}, ${v.note ?? null}) as id`
        return r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not send the request.')
    await audit(c, { action: 'wallet.recharge_request', entityType: 'wallet_recharge_request', entityId: row.id, after: v })
    return c.json(z.object({ id: z.string() }).parse(row), 201)
  })

  .post('/recharge-requests/:id/cancel', async (c) => {
    const id = uuidParam(c)
    const ok = await attempt(c, 'messaging.recharge_cancel', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        await sql`select cancel_wallet_recharge(${id})`
        return true
      }),
    { onCode: explain })
    if (!ok) fail(400, 'We could not cancel the request.')
    await audit(c, { action: 'wallet.recharge_cancel', entityType: 'wallet_recharge_request', entityId: id })
    return c.body(null, 204)
  })

  .patch('/settings', async (c) => {
    const parsed = updateMessagingSettings.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the settings.')
    const v = parsed.data
    const ok = await attempt(c, 'messaging.settings', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        for (const e of v.events ?? []) {
          await sql`select set_messaging_setting(${e.event}, ${e.whatsapp}, ${e.email})`
        }
        if (v.low_balance_paise !== undefined) await sql`select set_wallet_low_balance(${v.low_balance_paise})`
        return true
      }),
    { onCode: explain })
    if (!ok) fail(400, 'We could not save the settings.')
    await audit(c, { action: 'messaging.settings', entityType: 'company', entityId: c.get('auth').companyId, after: v })
    return c.json({ ok: true })
  })

  /** One test message to the owner, charged like any other. */
  .post('/test', async (c) => {
    const parsed = testMessageRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick WhatsApp or email.')
    const row = await attempt(c, 'messaging.test', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql`select * from send_test_message(${parsed.data.channel})`
        return r ?? null
      }),
    { onCode: explain })
    if (!row) fail(400, 'We could not send a test message.')
    return c.json(testMessageResult.parse(row), 201)
  })
