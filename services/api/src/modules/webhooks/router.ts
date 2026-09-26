import { Hono } from 'hono'
import { captureLeadRequest, fbConnectUrlResponse, fbPage, fbPageConnectRequest, fbStatusResponse, fbTokenRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { requireAuth } from '../../middleware/auth'
import { requireAction } from '../../middleware/permissions'
import { textParam, uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { timingSafeEqual } from '../../lib/crypto'
import { log } from '../../lib/log'
import { audit } from '../../lib/audit'
import { fetchMetaLead, isMetaLeadgenPayload, metaLeadgenIds, verifyMetaSignature } from '../../lib/meta'
import { verifyRazorpaySignature } from '../../lib/razorpay'
import { whatsappOptChanges, whatsappStatusUpdates } from '../../lib/whatsapp'
import { isDevLike } from '../../lib/env'

/**
 * PUBLIC webhook ingress — no auth. The source key resolves the tenant inside
 * the capture_lead RPC; the service client is used only to invoke that RPC,
 * which itself dedupes and auto-assigns. Meta and generic web forms share it.
 *
 * Two body shapes arrive here:
 *   - a plain JSON lead ({name, phone, email, meta}) from a web form
 *   - Meta's leadgen notification ({object:'page', entry:[…leadgen_id…]}),
 *     signed with the app secret; the lead itself is fetched from the Graph API
 */
export const webhooksRouter = new Hono<AppEnv>()
  .post('/lead/:sourceKey', async (c) => {
    const sourceKey = textParam(c, 'sourceKey')
    const raw = await c.req.text()
    const signature = c.req.header('X-Hub-Signature-256') ?? ''

    // A signature, when present, must be right. When the app secret is set,
    // a Meta-shaped post without one is a forgery.
    if (signature) {
      const ok = await verifyMetaSignature(raw, signature, c.env.META_APP_SECRET ?? '')
      if (!ok) fail(401, 'Invalid signature.')
    }

    let body: unknown = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      fail(422, 'Invalid lead payload.')
    }

    const capture = (lead: {
      name?: string | null | undefined
      phone: string
      email?: string | null | undefined
      meta?: Record<string, unknown> | undefined
    }) =>
      attempt(
        c,
        'webhooks.capture_lead',
        () =>
          withService(c.env, async (sql) => {
            const rows = await sql<{ id: string }[]>`
              select capture_lead(
                p_source_key => ${sourceKey},
                p_name => ${lead.name ?? null},
                p_phone => ${lead.phone},
                p_email => ${lead.email ?? null},
                p_meta => ${sql.json((lead.meta ?? {}) as Parameters<typeof sql.json>[0])}
              ) as id`
            const id = rows[0]?.id ?? null
            // The per-source import log: "did the form work" stays answerable.
            if (id) {
              const [src] = await sql<{ id: string; company_id: string }[]>`
                select id, company_id from crm_webhook_sources where source_key = ${sourceKey}`
              if (src) {
                const meta = (lead.meta ?? {}) as Record<string, unknown>
                await sql`
                  insert into fb_lead_imports (company_id, source_id, page_id, page_name, leadgen_id,
                                               name, phone, email, status, lead_id)
                  values (${src.company_id}, ${src.id},
                          ${String(meta.page_id ?? '') || null}, null,
                          ${String(meta.leadgen_id ?? '') || null},
                          ${lead.name ?? null}, ${lead.phone}, ${lead.email ?? null},
                          'imported', ${id})`
              }
            }
            return id
          }),
        // An unknown or paused key is the one refusal a caller should see as
        // such, not as a generic failure.
        { onCode: (code) => (code === '42501' ? ('unknown_source' as const) : undefined) },
      )

    if (isMetaLeadgenPayload(body)) {
      if (c.env.META_APP_SECRET && !signature) fail(401, 'Missing signature.')
      if (!c.env.META_PAGE_ACCESS_TOKEN) {
        log.warn({ requestId: c.get('requestId'), sourceKey }, 'meta leadgen received but META_PAGE_ACCESS_TOKEN is unset')
        // Meta retries on non-2xx; there is nothing to retry into. Acknowledge.
        return c.json({ ok: true, captured: 0, skipped: 'not_configured' })
      }
      const ids: string[] = []
      for (const item of metaLeadgenIds(body)) {
        const fetched = await attempt(c, 'webhooks.meta_fetch', () => fetchMetaLead(c.env, item.leadgen_id))
        if (!fetched || !fetched.phone) continue
        const id = await capture({
          name: fetched.name,
          phone: fetched.phone,
          email: fetched.email,
          meta: { ...item.meta, fields: fetched.fields },
        })
        if (id === 'unknown_source') fail(404, 'This lead source is not active.')
        if (id) ids.push(id)
      }
      return c.json({ ok: true, captured: ids.length, ids })
    }

    const parsed = captureLeadRequest.safeParse(body)
    if (!parsed.success) fail(422, 'Invalid lead payload.')
    const id = await capture(parsed.data)
    if (id === 'unknown_source') fail(404, 'This lead source is not active.')
    if (!id) fail(400, 'We could not capture this lead.')
    return c.json({ id }, 201)
  })

  // Meta subscription verification handshake (GET with hub.challenge). Meta
  // sends the verify token the studio configured; without checking it anyone
  // could complete the handshake and point a subscription here.
  .get('/meta', (c) => {
    const mode = c.req.query('hub.mode')
    const token = c.req.query('hub.verify_token') ?? ''
    const challenge = c.req.query('hub.challenge')
    const expected = c.env.META_VERIFY_TOKEN ?? ''
    if (mode !== 'subscribe' || !challenge) return c.json({ ok: true })
    if (!expected || !timingSafeEqual(token, expected)) fail(403, 'Verification token mismatch.')
    return c.text(challenge)
  })

  // WhatsApp Business Account webhook: the subscription handshake. Uses
  // WHATSAPP_VERIFY_TOKEN, or the Meta lead-ads token when that is unset.
  .get('/whatsapp', (c) => {
    const mode = c.req.query('hub.mode')
    const token = c.req.query('hub.verify_token') ?? ''
    const challenge = c.req.query('hub.challenge')
    const expected = c.env.WHATSAPP_VERIFY_TOKEN || c.env.META_VERIFY_TOKEN || ''
    if (mode !== 'subscribe' || !challenge) return c.json({ ok: true })
    if (!expected || !timingSafeEqual(token, expected)) fail(403, 'Verification token mismatch.')
    return c.text(challenge)
  })

  // Delivery receipts for the messaging wallet's messages (sent / delivered /
  // read / failed; a failure refunds), and STOP / START replies. Signed with
  // the Meta app secret. A receipt can move money (a refund), so without the
  // secret a production deployment reads nothing from this door.
  .post('/whatsapp', async (c) => {
    const raw = await c.req.text()
    const signature = c.req.header('X-Hub-Signature-256') ?? ''
    const secret = c.env.META_APP_SECRET ?? ''
    if (secret) {
      if (!signature || !(await verifyMetaSignature(raw, signature, secret))) fail(401, 'Invalid signature.')
    } else if (!isDevLike(c.env)) {
      log.warn({ requestId: c.get('requestId') }, 'whatsapp webhook received but META_APP_SECRET is unset')
      return c.json({ ok: true, skipped: 'not_configured' })
    }
    let body: unknown = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      fail(422, 'Invalid payload.')
    }
    const updates = whatsappStatusUpdates(body)
    const opts = whatsappOptChanges(body)
    const done = await attempt(c, 'webhooks.whatsapp', () =>
      withService(c.env, async (sql) => {
        let matched = 0
        for (const u of updates) {
          const [r] = await sql<{ ok: boolean }[]>`select message_status_update(${u.id}, ${u.status}, ${u.error}) as ok`
          if (r?.ok) matched += 1
        }
        for (const o of opts) await sql`select message_opt_out_set(${o.from}, ${o.out})`
        return matched
      }),
    )
    // Meta retries a non-2xx for days; a database hiccup is worth a retry.
    if (done === null) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    return c.json({ ok: true, statuses: updates.length, matched: done, opt_changes: opts.length })
  })

  // Razorpay webhook: verify HMAC over the raw body, record idempotently, and
  // activate on a captured payment. A replayed event is a no-op.
  .post('/razorpay', async (c) => {
    const raw = await c.req.text()
    const signature = c.req.header('x-razorpay-signature') ?? ''
    const ok = await verifyRazorpaySignature(raw, signature, c.env.RAZORPAY_WEBHOOK_SECRET ?? '')
    if (!ok) fail(401, 'Invalid signature.')

    let body: {
      id?: string
      event?: string
      payload?: { payment?: { entity?: { order_id?: string; id?: string } } }
    }
    try {
      body = JSON.parse(raw) as typeof body
    } catch {
      fail(422, 'Malformed event body.')
    }
    const eventId = body!.id ?? ''
    if (!eventId) fail(422, 'Missing event id.')

    const fresh = await attempt(c, 'webhooks.razorpay.record', () =>
      withService(c.env, async (sql) => {
        const rows = await sql<{ fresh: boolean }[]>`
          select record_webhook_event(p_event_id => ${eventId}, p_payload => ${sql.json(body as never)}) as fresh`
        return rows[0]?.fresh ?? false
      }),
    )
    // A failed ledger write must NOT proceed to activation: the provider will
    // retry, and replay safety depends on the ledger having the row first.
    if (fresh === null) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (fresh === false) return c.json({ ok: true, duplicate: true })

    const pay = body!.payload?.payment?.entity
    if (pay?.order_id && pay.id) {
      const orderId = pay.order_id
      const paymentId = pay.id
      const activated = await attempt(c, 'webhooks.razorpay.activate', () =>
        withService(c.env, async (sql) => {
          const [order] = await sql<{ id: string }[]>`
            select id from payment_orders where razorpay_order_id = ${orderId}`
          if (!order) return 'no_order' as const
          await sql`
            select * from activate_subscription(
              p_order_id => ${order.id},
              p_payment_id => ${paymentId}
            )`
          return 'ok' as const
        }),
      )
      if (activated === 'no_order') {
        log.warn({ requestId: c.get('requestId'), orderId, eventId }, 'razorpay event for unknown order')
      }
    }
    return c.json({ ok: true })
  })

/**
 * Meta (Facebook) connection — authenticated studio routes. Minimal viable:
 * status/pages UI backed by fb_pages, manual token verify, per-page
 * connect/disconnect + webhook-subscription checklist. OAuth URL is offered
 * when META_APP_ID is configured; otherwise the manual token flow applies.
 */
const metaMissing = (env: AppEnv['Bindings']): string[] => {
  const missing: string[] = []
  if (!env.META_APP_SECRET) missing.push('META_APP_SECRET')
  if (!env.META_VERIFY_TOKEN) missing.push('META_VERIFY_TOKEN')
  if (!env.META_PAGE_ACCESS_TOKEN) missing.push('META_PAGE_ACCESS_TOKEN')
  const appId = (env as unknown as Record<string, string | undefined>).META_APP_ID
  if (!appId) missing.push('META_APP_ID')
  return missing
}

export const metaRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/connect-url', async (c) => {
    const env = c.env
    const appId = (env as unknown as Record<string, string | undefined>).META_APP_ID ?? null
    const redirectUri = `${env.APP_URL ?? ''}/lead-sources`
    const missing = metaMissing(env)
    const connectUrl =
      appId && env.APP_URL
        ? `https://www.facebook.com/v21.0/dialog/oauth?client_id=${encodeURIComponent(appId)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&scope=${encodeURIComponent('pages_show_list,pages_read_engagement,leads_retrieval')}`
        : null
    return c.json(fbConnectUrlResponse.parse({ connect_url: connectUrl, app_id: appId, redirect_uri: redirectUri, missing_config: missing }))
  })

  .get('/status', async (c) => {
    const rows = await attempt(c, 'meta.status', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const pages = await sql<{ total: number; connected: number; subscribed: number; last_sync: string | null; last_error: string | null }[]>`
          select count(*)::int as total,
                 count(*) filter (where is_connected)::int as connected,
                 count(*) filter (where webhook_subscribed)::int as subscribed,
                 max(last_synced_at) as last_sync,
                 (select last_error from fb_pages where company_id = get_current_company_id() and last_error is not null order by updated_at desc limit 1) as last_error
          from fb_pages where company_id = get_current_company_id()`
        return pages[0] ?? null
      }),
    )
    if (!rows) fail(400, 'We could not load the Meta status.')
    const tokenPresent = !!c.env.META_PAGE_ACCESS_TOKEN
    return c.json(
      fbStatusResponse.parse({
        connected: rows.connected > 0 || tokenPresent,
        page_count: rows.total,
        connected_page_count: rows.connected,
        webhook_subscribed_count: rows.subscribed,
        missing_config: metaMissing(c.env),
        last_synced_at: rows.last_sync,
        last_error: rows.last_error,
      }),
    )
  })

  .get('/pages', async (c) => {
    const rows = await attempt(c, 'meta.pages', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql`
          select id, page_id, page_name, category, is_connected, webhook_subscribed,
                 last_synced_at, last_error, created_at
          from fb_pages order by page_name`,
      ),
    )
    if (!rows) fail(400, 'We could not load Meta pages.')
    return c.json(fbPage.array().parse(rows))
  })

  .post('/pages/connect', requireAction('crm', 'edit'), async (c) => {
    const parsed = fbPageConnectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a page to connect.')
    const { page_id, page_name } = parsed.data
    const row = await attempt(c, 'meta.page_connect', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [r] = await sql`
          insert into fb_pages (company_id, page_id, page_name, is_connected, last_synced_at, last_error)
          values (get_current_company_id(), ${page_id}, ${page_name ?? page_id}, true, now(), null)
          on conflict (company_id, page_id) do update
            set page_name = excluded.page_name, is_connected = true, last_synced_at = now(), last_error = null
          returning id, page_id, page_name, category, is_connected, webhook_subscribed,
                    last_synced_at, last_error, created_at`
        return r ?? null
      }),
    )
    if (!row) fail(400, 'We could not connect that page.')
    await audit(c, { action: 'meta.page_connect', entityType: 'fb_page', entityId: row.id, after: { page_id } })
    return c.json(fbPage.parse(row), 201)
  })

  .post('/pages/:id/disconnect', requireAction('crm', 'edit'), async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'meta.page_disconnect', () =>
      withUser(
        c.env,
        c.get('auth').userId,
        (sql) => sql<{ id: string }[]>`
          update fb_pages set is_connected = false, webhook_subscribed = false where id = ${id} returning id`,
      ),
    )
    if (!rows) fail(400, 'We could not disconnect that page.')
    if (!rows.length) fail(404, 'That page was not found.')
    await audit(c, { action: 'meta.page_disconnect', entityType: 'fb_page', entityId: id })
    return c.body(null, 204)
  })

  // Manual token flow: verify a long-lived token against the Graph API and
  // import the pages it can see (tokens themselves are never stored).
  .post('/token', requireAction('crm', 'edit'), async (c) => {
    const parsed = fbTokenRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Paste a valid token.')
    const { token } = parsed.data
    let fbUser: string | null = null
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(token)}`)
      if (!res.ok) fail(422, 'Meta rejected that token. Check it and try again.')
      fbUser = ((await res.json()) as { id?: string }).id ?? null
    } catch (e) {
      if (e instanceof Error && e.message.includes('Meta rejected')) throw e
      fail(400, 'Meta could not be reached. Try again in a moment.')
    }
    let imported = 0
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,category&access_token=${encodeURIComponent(token)}`)
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string; name: string; category?: string }> }
        const pages = data.data ?? []
        await withUser(c.env, c.get('auth').userId, async (sql) => {
          for (const p of pages) {
            await sql`
              insert into fb_pages (company_id, page_id, page_name, category, is_connected, last_synced_at, last_error)
              values (get_current_company_id(), ${p.id}, ${p.name}, ${p.category ?? null}, false, now(), null)
              on conflict (company_id, page_id) do update
                set page_name = excluded.page_name, category = excluded.category, last_synced_at = now(), last_error = null`
            imported += 1
          }
        })
      }
    } catch {
      // Token is valid (me worked); page listing is best-effort.
    }
    await audit(c, { action: 'meta.token_verify', entityType: 'fb_page', after: { fb_user: fbUser, imported } })
    return c.json({ ok: true as const, imported })
  })
