import { Hono } from 'hono'
import { captureLeadRequest, fbCheckResponse, fbConnectUrlResponse, fbDisconnectResponse, fbResetResponse, fbExchangeRequest, fbPage, fbPageConnectRequest, fbStatusResponse, fbTokenRequest } from '@ipc/contracts'
import type { Context } from 'hono'
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
import {
  MetaError,
  checkPageToken,
  isMetaAuthError,
  exchangeUserCode,
  fetchMetaLead,
  isMetaLeadgenPayload,
  metaLeadgenIds,
  readPages,
  subscribePage,
  unsubscribePage,
  pruneIdlePageTokens,
  verifyMetaSignature,
  type MetaLeadgenPayload,
  type MetaPage,
} from '../../lib/meta'
import { verifyRazorpaySignature } from '../../lib/razorpay'
import { GRAPH_VERSION, whatsappOptChanges, whatsappStatusUpdates } from '../../lib/whatsapp'
import { routeStudioWhatsapp } from '../../lib/studio-whatsapp-inbound'
import { open, seal, secretBoxReady } from '../../lib/secret-box'
import { apiOrigin } from '../../lib/request-origin'
import { isDevLike } from '../../lib/env'
import { cleanLead } from '../../lib/lead-fields'

type Captured = string | 'unknown_source' | null

interface IncomingLead {
  name?: string | null | undefined
  phone?: string | null | undefined
  email?: string | null | undefined
  meta?: Record<string, unknown> | undefined
}

/**
 * Write one row to the source's import log. Its own transaction, so a failed
 * capture (which rolls its own back) still leaves a "failed" row the studio
 * can see on Lead Sources. Never throws: the log must not fail the webhook.
 */
async function logImport(
  c: Context<AppEnv>,
  sourceKey: string,
  row: { name: string | null; phone: string | null; email: string | null; meta: Record<string, unknown>; pageName: string | null; status: 'imported' | 'failed'; error?: string | null; leadId?: string | null },
): Promise<void> {
  await withService(c.env, async (sql) => {
    const [src] = await sql<{ id: string; company_id: string }[]>`
      select id, company_id from crm_webhook_sources where source_key = ${sourceKey}`
    if (!src) return
    await sql`
      insert into fb_lead_imports (company_id, source_id, page_id, page_name, leadgen_id,
                                   name, phone, email, status, error, lead_id)
      values (${src.company_id}, ${src.id},
              ${String(row.meta.page_id ?? '') || null}, ${row.pageName},
              ${String(row.meta.leadgen_id ?? '') || null},
              ${row.name}, ${row.phone}, ${row.email}, ${row.status}, ${row.error ?? null}, ${row.leadId ?? null})`
  }).catch((err: unknown) => {
    // The code only: a Postgres error's detail can carry the row, phone included.
    log.warn({ requestId: c.get('requestId'), sourceKey, code: (err as { code?: string }).code ?? null }, 'lead import log write failed')
  })
}

/**
 * Hand a lead to capture_lead under a source key, and log the result per
 * source ("did the form work" stays answerable). The name, phone and email
 * are cleaned first (lib/lead-fields.ts): a phone that is not a number is
 * stored as null with the raw text in meta, so no lead is lost to it. An
 * unknown or paused key is the one refusal a caller should see as such.
 */
async function captureLead(c: Context<AppEnv>, sourceKey: string, incoming: IncomingLead, pageName: string | null = null): Promise<Captured> {
  const lead = cleanLead(incoming)
  if (lead.phoneIssue) {
    // Never the number itself: only where it came from and why it is empty.
    log.warn(
      { requestId: c.get('requestId'), sourceKey, leadgenId: lead.meta.leadgen_id ?? null, reason: `phone_${lead.phoneIssue}` },
      'lead captured without a usable phone',
    )
  }
  let failure: string | null = null
  const id = await attempt(
    c,
    'webhooks.capture_lead',
    () =>
      withService(c.env, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          select capture_lead(
            p_source_key => ${sourceKey},
            p_name => ${lead.name},
            p_phone => ${lead.phone},
            p_email => ${lead.email},
            p_meta => ${sql.json(lead.meta as Parameters<typeof sql.json>[0])}
          ) as id`
        return rows[0]?.id ?? null
      }).catch((err: unknown) => {
        failure = (err as { code?: string }).code ? `Database refused the lead (${(err as { code?: string }).code}).` : 'The lead could not be saved.'
        throw err
      }),
    { onCode: (code) => (code === '42501' ? ('unknown_source' as const) : undefined) },
  )
  if (id === 'unknown_source') return id
  await logImport(c, sourceKey, {
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    meta: lead.meta,
    pageName,
    status: id ? 'imported' : 'failed',
    error: id ? null : (failure ?? 'The lead could not be saved.'),
    leadId: id,
  })
  return id
}

/** The sealed token we hold for a page, opened; null when the studio never connected it. */
async function pageToken(c: Context<AppEnv>, pageId: string | null): Promise<string | null> {
  if (!pageId) return null
  const rows = await attempt(c, 'webhooks.page_token', () =>
    withService(c.env, (sql) => sql<{ token_enc: string }[]>`
      select t.token_enc from fb_page_tokens t
        join fb_pages p on p.company_id = t.company_id and p.page_id = t.page_id
       where t.page_id = ${pageId} and p.is_connected`),
  )
  const enc = rows?.[0]?.token_enc
  if (!enc) return null
  return open(c.env, enc).catch(() => null)
}

/**
 * Every lead in a Meta post, fetched with the right token and captured under
 * the right source. `resolve` says, per page, which token and source key to
 * use; a page it does not know is acknowledged and skipped (Meta retries a
 * non-2xx for days, and there is nothing to retry into).
 */
async function captureMetaPost(
  c: Context<AppEnv>,
  body: MetaLeadgenPayload,
  resolve: (pageId: string | null) => Promise<{ token: string; sourceKey: string; pageName: string | null } | null>,
): Promise<{ captured: string[]; skipped: number }> {
  const captured: string[] = []
  let skipped = 0
  for (const item of metaLeadgenIds(body)) {
    const pageId = (item.meta.page_id as string | null) ?? null
    const target = await resolve(pageId)
    if (!target) {
      skipped += 1
      log.warn({ requestId: c.get('requestId'), pageId }, 'meta lead for a page no studio has connected')
      continue
    }
    const fetched = await attempt(c, 'webhooks.meta_fetch', () => fetchMetaLead(target.token, item.leadgen_id))
    if (!fetched) {
      // Meta told us about a lead we could not read (token revoked, page
      // access removed). Logged as failed so the studio sees it on Lead Sources.
      skipped += 1
      await logImport(c, target.sourceKey, {
        name: null, phone: null, email: null, meta: item.meta, pageName: target.pageName,
        status: 'failed', error: 'Facebook did not let us read this lead. Reconnect the page and check its Leads Access.',
      })
      continue
    }
    // A lead with no phone is still a lead: it is saved, never skipped.
    const id = await captureLead(
      c,
      target.sourceKey,
      { name: fetched.name, phone: fetched.phone, email: fetched.email, meta: { ...item.meta, fields: fetched.fields } },
      target.pageName,
    )
    if (id === 'unknown_source') fail(404, 'This lead source is not active.')
    if (id) captured.push(id)
  }
  return { captured, skipped }
}

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

    if (isMetaLeadgenPayload(body)) {
      if (c.env.META_APP_SECRET && !signature) fail(401, 'Missing signature.')
      // The page's own token when the studio connected it (0204); the
      // platform-wide token, if any, for a source set up the old way.
      const r = await captureMetaPost(c, body, async (pageId) => {
        const token = (await pageToken(c, pageId)) ?? c.env.META_PAGE_ACCESS_TOKEN ?? null
        return token ? { token, sourceKey, pageName: null } : null
      })
      if (r.captured.length === 0 && r.skipped > 0 && !c.env.META_PAGE_ACCESS_TOKEN) {
        return c.json({ ok: true, captured: 0, skipped: 'not_configured' })
      }
      return c.json({ ok: true, captured: r.captured.length, ids: r.captured })
    }

    const parsed = captureLeadRequest.safeParse(body)
    if (!parsed.success) fail(422, 'Invalid lead payload.')
    const id = await captureLead(c, sourceKey, parsed.data)
    if (id === 'unknown_source') fail(404, 'This lead source is not active.')
    if (!id) fail(400, 'We could not capture this lead.')
    return c.json({ id }, 201)
  })

  // The Meta app's one leadgen webhook (0204). Every connected page posts
  // here; the page id in the post finds the studio, its token and its
  // "Facebook lead ads" source. Signed with the app secret, always.
  .post('/meta', async (c) => {
    const raw = await c.req.text()
    const signature = c.req.header('X-Hub-Signature-256') ?? ''
    const secret = c.env.META_APP_SECRET ?? ''
    if (secret) {
      if (!signature || !(await verifyMetaSignature(raw, signature, secret))) fail(401, 'Invalid signature.')
    } else if (!isDevLike(c.env)) {
      log.warn({ requestId: c.get('requestId') }, 'meta webhook received but META_APP_SECRET is unset')
      return c.json({ ok: true, skipped: 'not_configured' })
    }
    let body: unknown = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      fail(422, 'Invalid payload.')
    }
    if (!isMetaLeadgenPayload(body)) return c.json({ ok: true, captured: 0 })
    const r = await captureMetaPost(c, body, async (pageId) => {
      if (!pageId) return null
      const rows = await attempt(c, 'webhooks.meta_page', () =>
        withService(c.env, (sql) => sql<{ source_key: string; page_name: string }[]>`
          select source_key, page_name from meta_page_company(${pageId})`),
      )
      const found = rows?.[0]
      if (!found) return null
      const token = await pageToken(c, pageId)
      return token ? { token, sourceKey: found.source_key, pageName: found.page_name } : null
    })
    return c.json({ ok: true, captured: r.captured.length, skipped: r.skipped })
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
    // Studios that connected their number through our app (Embedded Signup)
    // post here too: their clients' replies and their receipts (0203).
    const studios = done === null ? null : await attempt(c, 'webhooks.whatsapp_studios', () => routeStudioWhatsapp(c.env, body))
    // Meta retries a non-2xx for days; a database hiccup is worth a retry.
    if (done === null) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    if (studios === null) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    return c.json({ ok: true, statuses: updates.length, matched: done, opt_changes: opts.length, studios })
  })

  // A studio whose number lives on its own Meta app points that app here
  // (0203). The address carries the studio's unguessable key; the handshake
  // checks its verify token; posts are checked against its app secret when it
  // gave us one, and only ever write about its own number.
  .get('/whatsapp/studio/:key', async (c) => {
    const mode = c.req.query('hub.mode')
    const token = c.req.query('hub.verify_token') ?? ''
    const challenge = c.req.query('hub.challenge')
    if (mode !== 'subscribe' || !challenge) return c.json({ ok: true })
    const rows = await attempt(c, 'webhooks.whatsapp_studio_verify', () =>
      withService(c.env, (sql) => sql<{ verify_token: string }[]>`
        select verify_token from company_whatsapp where webhook_key = ${c.req.param('key')}`),
    )
    const expected = rows?.[0]?.verify_token ?? ''
    if (!expected || !timingSafeEqual(token, expected)) fail(403, 'Verification token mismatch.')
    return c.text(challenge)
  })

  .post('/whatsapp/studio/:key', async (c) => {
    const raw = await c.req.text()
    const rows = await attempt(c, 'webhooks.whatsapp_studio_read', () =>
      withService(c.env, (sql) => sql<{ phone_number_id: string; app_secret_enc: string | null }[]>`
        select phone_number_id, app_secret_enc from company_whatsapp where webhook_key = ${c.req.param('key')}`),
    )
    if (rows === null) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    const w = rows[0]
    if (!w) fail(404, 'Unknown address.')
    if (w.app_secret_enc) {
      const secret = await open(c.env, w.app_secret_enc).catch(() => '')
      const signature = c.req.header('X-Hub-Signature-256') ?? ''
      if (!secret || !signature || !(await verifyMetaSignature(raw, signature, secret))) fail(401, 'Invalid signature.')
    }
    let body: unknown = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      fail(422, 'Invalid payload.')
    }
    const r = await attempt(c, 'webhooks.whatsapp_studio', () => routeStudioWhatsapp(c.env, body, w.phone_number_id))
    if (r === null) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    return c.json({ ok: true, ...r })
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

    const pay = body!.payload?.payment?.entity
    // Only money that actually arrived gives a plan. A `payment.failed` (or
    // `payment.authorized` not yet captured) carries the same order_id and
    // payment id, and used to activate the subscription all the same.
    const paid = body!.event === 'payment.captured' || body!.event === 'order.paid'
    // A replay of anything else is done with. A replay of a payment still
    // tries the plan: activate_subscription does nothing to an order already
    // paid, and this is how a paid order whose first activation failed gets
    // its plan when Razorpay sends the event again.
    if (fresh === false && !paid) return c.json({ ok: true, duplicate: true })
    if (paid && pay?.order_id && pay.id) {
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
      // The money arrived but the plan did not: answer 503 so Razorpay sends
      // the event again (it used to be 200, and the order waited for a
      // platform admin to credit it by hand).
      if (activated === null) fail(503, 'The service is temporarily unavailable. Please try again in a moment.')
    }
    if (fresh === false) return c.json({ ok: true, duplicate: true })
    return c.json({ ok: true })
  })

/**
 * Meta (Facebook) connection -- authenticated studio routes (0204). The
 * owner signs in with Facebook (or pastes a long-lived token); we keep each
 * page's own token sealed, and Connect on a page subscribes it to leadgen
 * so its leads post to /webhooks/meta. Tokens never go back to the browser.
 */
/** What a studio grants so its lead-form leads reach us. */
const META_LEAD_SCOPES = 'pages_show_list,pages_manage_metadata,pages_read_engagement,business_management,leads_retrieval'

const metaMissing = (env: AppEnv['Bindings']): string[] => {
  const missing: string[] = []
  if (!env.META_APP_ID) missing.push('META_APP_ID')
  if (!env.META_APP_SECRET) missing.push('META_APP_SECRET')
  if (!env.META_VERIFY_TOKEN) missing.push('META_VERIFY_TOKEN')
  return missing
}

const redirectUri = (env: AppEnv['Bindings']) => `${(env.APP_URL ?? '').replace(/\/+$/, '')}/lead-sources`

/**
 * The "Connect with Facebook" link. A Business-type app uses Facebook Login
 * for Business: the permissions live in a configuration, named by its id.
 * Without one, the classic scope list. Null until the app id and APP_URL are set.
 */
export function metaConnectUrl(env: Pick<AppEnv['Bindings'], 'META_APP_ID' | 'APP_URL' | 'META_LOGIN_CONFIG_ID'>): string | null {
  if (!env.META_APP_ID || !env.APP_URL) return null
  const base =
    `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?client_id=${encodeURIComponent(env.META_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri(env as AppEnv['Bindings']))}`
  // auth_type=rerequest: Facebook shows the permission dialog again, even to
  // someone who connected before or declined a permission last time.
  return env.META_LOGIN_CONFIG_ID
    ? `${base}&config_id=${encodeURIComponent(env.META_LOGIN_CONFIG_ID)}&response_type=code&override_default_response_type=true&auth_type=rerequest`
    : `${base}&scope=${encodeURIComponent(META_LEAD_SCOPES)}&auth_type=rerequest`
}

/** Remember the pages a token can manage, with each page's own token sealed. */
async function savePages(
  c: Context<AppEnv>,
  found: { fb_user_id: string | null; pages: MetaPage[] },
  via: 'oauth' | 'token',
): Promise<number> {
  const auth = c.get('auth')
  const sealed = await Promise.all(found.pages.map((p) => seal(c.env, p.access_token)))
  const n = await attempt(c, 'meta.save_pages', () =>
    withService(c.env, async (sql) => {
      for (const [i, p] of found.pages.entries()) {
        await sql`
          insert into fb_pages (company_id, page_id, page_name, category, connected_via, last_synced_at, last_error)
          values (${auth.companyId}, ${p.id}, ${p.name}, ${p.category}, ${via}, now(), null)
          on conflict (company_id, page_id) do update
            set page_name = excluded.page_name, category = excluded.category, connected_via = excluded.connected_via,
                last_synced_at = now(), last_error = null`
        // A page belongs to one studio: a token from another studio's login
        // moves it, which is what the person with the page's login asked for.
        await sql`delete from fb_page_tokens where page_id = ${p.id} and company_id <> ${auth.companyId}`
        await sql`
          insert into fb_page_tokens (company_id, page_id, token_enc, fb_user_id, connected_by)
          values (${auth.companyId}, ${p.id}, ${sealed[i]!}, ${found.fb_user_id}, ${auth.userId})
          on conflict (company_id, page_id) do update
            set token_enc = excluded.token_enc, fb_user_id = excluded.fb_user_id,
                connected_by = excluded.connected_by, connected_at = now()`
      }
      // A new Facebook login lists only the pages picked in its dialog: pages
      // from an earlier login that are not connected leave the list. A page
      // already connected stays connected until it is disconnected.
      if (via === 'oauth') {
        const ids = found.pages.map((p) => p.id)
        await sql`
          delete from fb_page_tokens t
           where t.company_id = ${auth.companyId} and not (t.page_id = any(${ids}::text[]))
             and not exists (select 1 from fb_pages p where p.company_id = t.company_id and p.page_id = t.page_id and p.is_connected)`
        await sql`
          delete from fb_pages
           where company_id = ${auth.companyId} and not is_connected and not (page_id = any(${ids}::text[]))`
      }
      await pruneIdlePageTokens(sql, auth.companyId)
      return found.pages.length
    }),
  )
  if (n === null) fail(400, 'We could not save your pages.')
  return n
}

const META_EXPIRED = 'Your Facebook connection expired. Please reconnect.'

/**
 * Forget a studio's Facebook connection. Each subscribed page is told to stop
 * posting leads first, with its own token, and a failure there (a revoked
 * token) is ignored -- Facebook already dropped the app in that case. Then
 * 0230's meta_forget_studio() removes every page token and page record.
 * Tokens are never logged.
 */
async function forgetStudio(c: Context<AppEnv>, why: 'reset' | 'expired'): Promise<{ forgotten: number; unsubscribed: number }> {
  const companyId = c.get('auth').companyId
  const held = await attempt(c, 'meta.forget_read', () =>
    withService(c.env, (sql) => sql<{ page_id: string; token_enc: string }[]>`
      select t.page_id, t.token_enc from fb_page_tokens t
        join fb_pages p on p.company_id = t.company_id and p.page_id = t.page_id
       where t.company_id = ${companyId} and p.webhook_subscribed`),
  )
  let unsubscribed = 0
  if (why === 'reset') {
    for (const t of held ?? []) {
      const token = await open(c.env, t.token_enc).catch(() => null)
      if (token && (await unsubscribePage(token, t.page_id).then(() => true, () => false))) unsubscribed += 1
    }
  }
  const forgotten = await attempt(c, 'meta.forget', () =>
    withService(c.env, async (sql) => {
      const [r] = await sql<{ n: number }[]>`select meta_forget_studio(${companyId}) as n`
      return r?.n ?? 0
    }),
  )
  if (forgotten === null) fail(400, 'We could not remove the Facebook connection. Please try again.')
  await audit(c, { action: why === 'reset' ? 'meta.reset' : 'meta.expired', entityType: 'fb_page', after: { forgotten, unsubscribed } })
  return { forgotten, unsubscribed }
}

export const metaRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/connect-url', async (c) => {
    const env = c.env
    const appId = env.META_APP_ID ?? null
    const missing = metaMissing(env)
    const connectUrl = metaConnectUrl(env)
    return c.json(fbConnectUrlResponse.parse({ connect_url: connectUrl, app_id: appId, redirect_uri: redirectUri(env), missing_config: missing }))
  })

  .get('/status', async (c) => {
    const rows = await attempt(c, 'meta.status', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const pages = await sql<{ total: number; connected: number; subscribed: number; last_sync: string | null; last_error: string | null; last_lead: string | null }[]>`
          select count(*)::int as total,
                 count(*) filter (where is_connected)::int as connected,
                 count(*) filter (where webhook_subscribed)::int as subscribed,
                 max(last_synced_at) as last_sync,
                 (select last_error from fb_pages where company_id = get_current_company_id() and last_error is not null order by updated_at desc limit 1) as last_error,
                 (select max(created_at) from fb_lead_imports where company_id = get_current_company_id() and page_id is not null and status = 'imported') as last_lead
          from fb_pages where company_id = get_current_company_id()`
        return pages[0] ?? null
      }),
    )
    if (!rows) fail(400, 'We could not load the Meta status.')
    return c.json(
      fbStatusResponse.parse({
        connected: rows.subscribed > 0,
        page_count: rows.total,
        connected_page_count: rows.connected,
        webhook_subscribed_count: rows.subscribed,
        missing_config: metaMissing(c.env),
        last_synced_at: rows.last_sync,
        last_error: rows.last_error,
        ready: secretBoxReady(c.env),
        webhook_url: `${apiOrigin(c)}/webhooks/meta`,
        last_lead_at: rows.last_lead,
      }),
    )
  })

  .get('/pages', async (c) => {
    const rows = await attempt(c, 'meta.pages', () =>
      withService(
        c.env,
        (sql) => sql`
          select p.id, p.page_id, p.page_name, p.category, p.is_connected, p.webhook_subscribed,
                 p.last_synced_at, p.last_error, p.created_at, p.connected_via, p.subscribed_at,
                 exists (select 1 from fb_page_tokens t where t.company_id = p.company_id and t.page_id = p.page_id) as has_token
            from fb_pages p
           where p.company_id = ${c.get('auth').companyId}
           order by p.is_connected desc, p.page_name`,
      ),
    )
    if (!rows) fail(400, 'We could not load Meta pages.')
    return c.json(fbPage.array().parse(rows))
  })

  // "Connect with Facebook" came back with a code: trade it for page tokens.
  .post('/exchange', requireAction('crm', 'edit'), async (c) => {
    const { META_APP_ID: appId, META_APP_SECRET: secret } = c.env
    if (!appId || !secret) fail(503, '"Connect with Facebook" is not set up on this server.')
    if (!secretBoxReady(c.env)) fail(503, 'Facebook connections are not set up on this server yet (WHATSAPP_TOKEN_KEY).')
    const parsed = fbExchangeRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Facebook did not finish the connection. Please try again.')
    let found: { fb_user_id: string | null; pages: MetaPage[] }
    try {
      const token = await exchangeUserCode(appId, secret, parsed.data.code, redirectUri(c.env))
      found = await readPages(token)
    } catch (e) {
      fail(422, e instanceof MetaError ? `Facebook said: ${e.message}` : 'We could not reach Facebook. Please try again.')
    }
    const imported = await savePages(c, found, 'oauth')
    await audit(c, { action: 'meta.oauth_connect', entityType: 'fb_page', after: { fb_user: found.fb_user_id, imported } })
    return c.json({ ok: true as const, imported })
  })

  // Connect a page: from now on its leads post to /webhooks/meta.
  .post('/pages/connect', requireAction('crm', 'edit'), async (c) => {
    const parsed = fbPageConnectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a page to connect.')
    const { page_id, page_name } = parsed.data
    const companyId = c.get('auth').companyId
    const token = await pageToken(c, page_id).then(async (t) => {
      if (t) return t
      const rows = await withService(c.env, (sql) => sql<{ token_enc: string }[]>`
        select token_enc from fb_page_tokens where company_id = ${companyId} and page_id = ${page_id}`).catch(() => [])
      return rows[0] ? open(c.env, rows[0].token_enc).catch(() => null) : null
    })
    if (!token) fail(422, 'Connect with Facebook first, so we have this page\'s permission.')
    // The plan's Facebook Pages (0242), checked before Facebook is asked: the
    // database would refuse the row only after the page was subscribed there.
    const room = await attempt(c, 'meta.page_room', () =>
      withService(c.env, (sql) => sql<{ room: number | null; already: boolean }[]>`
        select plan_room(${companyId}, 'facebook_pages') as room,
               exists (select 1 from fb_pages where company_id = ${companyId} and page_id = ${page_id} and is_connected) as already`),
    )
    if (room?.[0] && room[0].room === 0 && !room[0].already) {
      fail(402, 'Your plan has no room for another Facebook Page. Upgrade to connect more.')
    }
    let error: string | null = null
    try {
      await subscribePage(token, page_id)
    } catch (e) {
      // The app was removed in Facebook or the token revoked: nothing we hold
      // works any more, so forget it all and ask for a fresh connection.
      if (isMetaAuthError(e)) {
        await forgetStudio(c, 'expired')
        fail(409, META_EXPIRED)
      }
      error = e instanceof MetaError ? e.message : 'We could not reach Facebook.'
    }
    const row = await attempt(c, 'meta.page_connect', () =>
      withService(c.env, async (sql) => {
        const [r] = await sql`
          insert into fb_pages (company_id, page_id, page_name, is_connected, webhook_subscribed, subscribed_at, last_synced_at, last_error)
          values (${companyId}, ${page_id}, ${page_name ?? page_id}, ${!error}, ${!error}, ${error ? null : new Date()}, now(), ${error})
          on conflict (company_id, page_id) do update
            set page_name = coalesce(${page_name ?? null}, fb_pages.page_name), is_connected = ${!error},
                webhook_subscribed = ${!error}, subscribed_at = ${error ? null : new Date()}, last_synced_at = now(), last_error = ${error}
          returning id, page_id, page_name, category, is_connected, webhook_subscribed,
                    last_synced_at, last_error, created_at, connected_via, subscribed_at, true as has_token`
        await pruneIdlePageTokens(sql, companyId)
        return r ?? null
      }),
    )
    if (!row) fail(400, 'We could not connect that page.')
    if (error) fail(422, `Facebook said: ${error}`)
    await audit(c, { action: 'meta.page_connect', entityType: 'fb_page', entityId: row.id, after: { page_id } })
    return c.json(fbPage.parse(row), 201)
  })

  .post('/pages/:id/disconnect', requireAction('crm', 'edit'), async (c) => {
    const id = uuidParam(c)
    const companyId = c.get('auth').companyId
    const rows = await attempt(c, 'meta.page_disconnect', () =>
      withService(c.env, async (sql) => {
        const [p] = await sql<{ page_id: string; token_enc: string | null }[]>`
          select p.page_id, t.token_enc from fb_pages p
            left join fb_page_tokens t on t.company_id = p.company_id and t.page_id = p.page_id
           where p.id = ${id} and p.company_id = ${companyId}`
        if (!p) return null
        await sql`update fb_pages set is_connected = false, webhook_subscribed = false, subscribed_at = null where id = ${id}`
        await sql`delete from fb_page_tokens where company_id = ${companyId} and page_id = ${p.page_id}`
        return p
      }),
    )
    if (rows === null) fail(404, 'That page was not found.')
    // Meta stops posting for this page once it is told. Our side is off and the
    // token is gone either way; `unsubscribed` says whether Facebook confirmed,
    // so the card can tell the person to remove the app in Facebook if not.
    let unsubscribed = false
    if (rows.token_enc) {
      const token = await open(c.env, rows.token_enc).catch(() => null)
      if (token) unsubscribed = await unsubscribePage(token, rows.page_id).then(() => true, () => false)
    }
    await audit(c, { action: 'meta.page_disconnect', entityType: 'fb_page', entityId: id, after: { unsubscribed } })
    return c.json(fbDisconnectResponse.parse({ ok: true, unsubscribed }))
  })

  // Are the page tokens we hold still good? Called when the card opens. Once
  // Facebook says no (the app was removed, the token revoked or expired),
  // everything is forgotten so the card offers "Connect with Facebook" again.
  .post('/check', requireAction('crm', 'view'), async (c) => {
    const companyId = c.get('auth').companyId
    const held = await attempt(c, 'meta.check_tokens', () =>
      withService(c.env, (sql) => sql<{ page_id: string; token_enc: string }[]>`
        select page_id, token_enc from fb_page_tokens where company_id = ${companyId} order by connected_at desc limit 5`),
    )
    if (!held) fail(400, 'We could not check the Facebook connection.')
    let expired = false
    for (const t of held) {
      const token = await open(c.env, t.token_enc).catch(() => null)
      if (!token) continue
      const state = await checkPageToken(token, t.page_id)
      if (state === 'ok') break
      if (state === 'expired') {
        expired = true
        break
      }
    }
    if (expired) await forgetStudio(c, 'expired')
    return c.json(fbCheckResponse.parse({ expired }))
  })

  // "Disconnect Facebook": every page off the leadgen webhook (best effort --
  // a revoked token cannot), then every page and token forgotten. Leads
  // already received, the import log and the lead source stay.
  .post('/reset', requireAction('crm', 'edit'), async (c) => {
    const out = await forgetStudio(c, 'reset')
    return c.json(fbResetResponse.parse({ ok: true, ...out }))
  })

  // Manual token flow: a long-lived user token, for a studio without the
  // Facebook login button. Verified against Meta; the page tokens it can see
  // are kept sealed, the user token itself is not.
  .post('/token', requireAction('crm', 'edit'), async (c) => {
    if (!secretBoxReady(c.env)) fail(503, 'Facebook connections are not set up on this server yet (WHATSAPP_TOKEN_KEY).')
    const parsed = fbTokenRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Paste a valid token.')
    let found: { fb_user_id: string | null; pages: MetaPage[] }
    try {
      found = await readPages(parsed.data.token)
    } catch (e) {
      fail(422, e instanceof MetaError ? `Meta rejected that token: ${e.message}` : 'Meta could not be reached. Try again in a moment.')
    }
    const imported = await savePages(c, found, 'token')
    await audit(c, { action: 'meta.token_verify', entityType: 'fb_page', after: { fb_user: found.fb_user_id, imported } })
    return c.json({ ok: true as const, imported })
  })
