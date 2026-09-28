import { Hono, type Context } from 'hono'
import { randomBytes } from 'node:crypto'
import {
  studioWhatsappTemplate,
  whatsappConnectRequest,
  whatsappEmbeddedRequest,
  whatsappStatus,
  type WhatsappStatus,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { fail } from '../../middleware/errors'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { open, seal, secretBoxReady } from '../../lib/secret-box'
import { GraphError, exchangeCode, readNumber, readTemplates, subscribeApp } from '../../lib/studio-whatsapp'
import { log } from '../../lib/log'
import { apiOrigin } from '../../lib/request-origin'

/**
 * The studio's own WhatsApp number (0203), under /whatsapp. Owners and
 * admins connect it -- by Meta's Embedded Signup when the server has it, or
 * by pasting the number's details -- once the platform has switched on
 * whatsapp_api for the studio. The token is checked against Meta, sealed
 * (lib/secret-box.ts) and never sent back.
 */
const MANAGERS = new Set(['super_admin', 'admin'])

const token = () => randomBytes(24).toString('base64url')

async function entitled(c: Context<AppEnv>): Promise<boolean> {
  const rows = await withUser(c.env, c.get('auth').userId, (sql) => sql<{ ok: boolean }[]>`
    select company_can(get_current_company_id(), 'whatsapp_api') as ok`)
  return !!rows[0]?.ok
}

async function guard(c: Context<AppEnv>) {
  if (!MANAGERS.has(c.get('auth').role)) fail(403, 'Only the owner or an admin can change this.')
  const ok = await attempt(c, 'whatsapp.entitled', () => entitled(c))
  if (ok === null) fail(400, 'We could not check your plan.')
  if (!ok) fail(403, 'Your own WhatsApp number comes with the higher plan.')
  if (!secretBoxReady(c.env)) fail(503, 'WhatsApp connections are not set up on this server yet (WHATSAPP_TOKEN_KEY).')
}

/** Copy the account's templates in. Best effort after a connect; explicit on "Sync". */
async function syncTemplates(c: Context<AppEnv>, companyId: string, accessToken: string, wabaId: string): Promise<number> {
  const list = await readTemplates(accessToken, wabaId)
  await withService(c.env, async (sql) => {
    await sql`delete from company_whatsapp_templates where company_id = ${companyId}`
    for (const t of list) {
      await sql`
        insert into company_whatsapp_templates (company_id, name, language, status, category, body, param_count)
        values (${companyId}, ${t.name}, ${t.language}, ${t.status}, ${t.category}, ${t.body}, ${t.param_count})
        on conflict (company_id, name, language) do nothing`
    }
    await sql`update company_whatsapp set templates_synced_at = now() where company_id = ${companyId}`
  })
  return list.length
}

async function saveConnection(
  c: Context<AppEnv>,
  v: { phone_number_id: string; waba_id: string; access_token: string; app_secret?: string | null | undefined; via: 'manual' | 'embedded' },
) {
  const auth = c.get('auth')
  // Proves the token can use the number, and gives us its name.
  let number: { display_phone: string | null; verified_name: string | null }
  try {
    number = await readNumber(v.access_token, v.phone_number_id)
  } catch (e) {
    fail(422, e instanceof GraphError ? `WhatsApp did not accept these details: ${e.message}` : 'We could not reach WhatsApp. Please try again.')
  }
  const tokenEnc = await seal(c.env, v.access_token)
  const secretEnc = v.app_secret ? await seal(c.env, v.app_secret) : null
  const saved = await attempt(
    c,
    'whatsapp.connect',
    () =>
      withService(c.env, (sql) => sql`
        insert into company_whatsapp (company_id, phone_number_id, waba_id, display_phone, verified_name, access_token_enc,
                                      app_secret_enc, webhook_key, verify_token, via, status, last_error, connected_by)
        values (${auth.companyId}, ${v.phone_number_id}, ${v.waba_id}, ${number.display_phone}, ${number.verified_name}, ${tokenEnc},
                ${secretEnc}, ${token()}, ${token()}, ${v.via}, 'connected', null, ${auth.userId})
        on conflict (company_id) do update
          set phone_number_id = excluded.phone_number_id, waba_id = excluded.waba_id,
              display_phone = excluded.display_phone, verified_name = excluded.verified_name,
              access_token_enc = excluded.access_token_enc,
              app_secret_enc = coalesce(excluded.app_secret_enc, company_whatsapp.app_secret_enc),
              via = excluded.via, status = 'connected', last_error = null,
              connected_at = now(), connected_by = excluded.connected_by`),
    { onCode: (code) => (code === '23505' ? ('taken' as const) : undefined) },
  )
  if (saved === 'taken') fail(409, 'That WhatsApp number is already connected to another studio.')
  if (!saved) fail(400, 'We could not save the connection.')
  await syncTemplates(c, auth.companyId, v.access_token, v.waba_id).catch((e: unknown) =>
    log.warn({ err: String(e) }, 'whatsapp template sync after connect failed'),
  )
  await audit(c, {
    action: 'whatsapp.connect',
    entityType: 'company',
    entityId: auth.companyId,
    after: { phone_number_id: v.phone_number_id, waba_id: v.waba_id, via: v.via },
  })
}

export const studioWhatsappRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const out = await attempt(c, 'whatsapp.status', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [can] = await sql<{ ok: boolean }[]>`select company_can(get_current_company_id(), 'whatsapp_api') as ok`
        const [w] = await sql`select * from company_whatsapp_status()`
        return { can: !!can?.ok, w }
      }),
    )
    if (!out) fail(400, 'We could not load your WhatsApp connection.')
    const { app_id, config } = { app_id: c.env.META_APP_ID, config: c.env.WHATSAPP_CONFIG_ID }
    const w = out.w as Record<string, unknown> | undefined
    const status: WhatsappStatus = {
      entitled: out.can,
      ready: secretBoxReady(c.env),
      embedded: app_id && config && c.env.META_APP_SECRET ? { app_id, config_id: config } : null,
      connection: w
        ? {
            phone_number_id: String(w['phone_number_id']),
            waba_id: String(w['waba_id']),
            display_phone: (w['display_phone'] as string | null) ?? null,
            verified_name: (w['verified_name'] as string | null) ?? null,
            via: w['via'] as 'manual' | 'embedded',
            status: w['status'] as 'connected' | 'error',
            last_error: (w['last_error'] as string | null) ?? null,
            connected_at: w['connected_at'] as string,
            templates_synced_at: (w['templates_synced_at'] as string | null) ?? null,
            webhook_url: `${apiOrigin(c)}/webhooks/whatsapp/studio/${String(w['webhook_key'])}`,
            verify_token: String(w['verify_token']),
            has_app_secret: !!w['has_app_secret'],
          }
        : null,
    }
    return c.json(whatsappStatus.parse(status))
  })

  .post('/connect', async (c) => {
    await guard(c)
    const parsed = whatsappConnectRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the details.')
    await saveConnection(c, { ...parsed.data, via: 'manual' })
    return c.body(null, 204)
  })

  // Embedded Signup: the browser hands us Facebook's one-time code and the
  // ids of the number the owner picked; the token never touches the browser.
  .post('/embedded', async (c) => {
    await guard(c)
    const { META_APP_ID: appId, META_APP_SECRET: secret } = c.env
    if (!appId || !secret || !c.env.WHATSAPP_CONFIG_ID) fail(503, '"Connect with Facebook" is not set up on this server.')
    const parsed = whatsappEmbeddedRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Facebook did not finish the connection. Please try again.')
    let accessToken: string
    try {
      accessToken = await exchangeCode(appId, secret, parsed.data.code)
      await subscribeApp(accessToken, parsed.data.waba_id)
    } catch (e) {
      fail(422, e instanceof GraphError ? `Facebook said: ${e.message}` : 'We could not reach Facebook. Please try again.')
    }
    await saveConnection(c, { phone_number_id: parsed.data.phone_number_id, waba_id: parsed.data.waba_id, access_token: accessToken, via: 'embedded' })
    return c.body(null, 204)
  })

  .get('/templates', async (c) => {
    const rows = await attempt(c, 'whatsapp.templates', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select name, language, status, category, body, param_count
          from company_whatsapp_templates
         order by (status = 'APPROVED') desc, name, language`),
    )
    if (!rows) fail(400, 'We could not load your templates.')
    return c.json({ items: studioWhatsappTemplate.array().parse(rows) })
  })

  .post('/templates/sync', async (c) => {
    await guard(c)
    const companyId = c.get('auth').companyId
    const conn = await attempt(c, 'whatsapp.sync_read', () =>
      withService(c.env, (sql) => sql<{ access_token_enc: string; waba_id: string }[]>`
        select access_token_enc, waba_id from company_whatsapp where company_id = ${companyId}`),
    )
    if (!conn) fail(400, 'We could not read your connection.')
    if (!conn[0]) fail(404, 'Connect your WhatsApp number first.')
    try {
      const n = await syncTemplates(c, companyId, await open(c.env, conn[0].access_token_enc), conn[0].waba_id)
      return c.json({ templates: n })
    } catch (e) {
      const msg = e instanceof GraphError ? e.message : 'We could not reach WhatsApp.'
      await withService(c.env, (sql) => sql`
        update company_whatsapp set status = 'error', last_error = ${msg.slice(0, 300)} where company_id = ${companyId}`).catch(() => null)
      fail(422, `WhatsApp said: ${msg}`)
    }
  })

  .delete('/', async (c) => {
    if (!MANAGERS.has(c.get('auth').role)) fail(403, 'Only the owner or an admin can change this.')
    const companyId = c.get('auth').companyId
    const done = await attempt(c, 'whatsapp.disconnect', () =>
      withService(c.env, async (sql) => {
        await sql`delete from company_whatsapp_templates where company_id = ${companyId}`
        return sql`delete from company_whatsapp where company_id = ${companyId} returning company_id`
      }),
    )
    if (!done) fail(400, 'We could not disconnect.')
    await audit(c, { action: 'whatsapp.disconnect', entityType: 'company', entityId: companyId })
    return c.body(null, 204)
  })
