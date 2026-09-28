import { Hono } from 'hono'
import { branding, brandingInput, entitlementsResponse, setEntitlementRequest } from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { loadStudioBrand } from '../../lib/studio-brand'

/**
 * The higher-tier switches a studio has (0202), and its email branding.
 * The platform turns switches on per studio; the studio can only read them.
 */
const BRANDING_ROLES = new Set(['super_admin', 'admin'])

export const featuresRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const rows = await attempt(c, 'features.list', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ keys: string[] }[]>`select my_entitlements() as keys`),
    )
    if (!rows) fail(400, 'We could not load your plan features.')
    return c.json(entitlementsResponse.parse({ keys: rows[0]?.keys ?? [] }))
  })

  .get('/branding', async (c) => {
    const out = await attempt(c, 'features.branding', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const [me] = await sql<{ id: string }[]>`select get_current_company_id() as id`
        const b = await loadStudioBrand(sql, me!.id)
        const [own] = await sql<{ from_name: string | null; reply_to: string | null; footer_line: string | null }[]>`
          select from_name, reply_to, footer_line from company_branding where company_id = ${me!.id}`
        return {
          enabled: b.whiteLabel,
          studio_name: b.name,
          logo_url: b.logoUrl,
          from_name: own?.from_name ?? null,
          reply_to: own?.reply_to ?? null,
          footer_line: own?.footer_line ?? null,
        }
      }),
    )
    if (!out) fail(400, 'We could not load your email branding.')
    return c.json(branding.parse(out))
  })

  .put('/branding', async (c) => {
    const auth = c.get('auth')
    if (!BRANDING_ROLES.has(auth.role)) fail(403, 'Only the owner or an admin can change this.')
    const parsed = brandingInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the details.')
    const v = parsed.data
    const ok = await attempt(c, 'features.branding_save', () =>
      withUser(c.env, auth.userId, async (sql) => {
        const [can] = await sql<{ ok: boolean }[]>`select company_can(get_current_company_id(), 'white_label') as ok`
        if (!can?.ok) return 'locked' as const
        await sql`
          insert into company_branding (company_id, from_name, reply_to, footer_line)
          values (get_current_company_id(), ${v.from_name || null}, ${v.reply_to || null}, ${v.footer_line || null})
          on conflict (company_id) do update
            set from_name = excluded.from_name, reply_to = excluded.reply_to,
                footer_line = excluded.footer_line, updated_at = now()`
        return 'ok' as const
      }),
    )
    if (!ok) fail(400, 'We could not save your email branding.')
    if (ok === 'locked') fail(403, 'Your own name on emails comes with the higher plan.')
    await audit(c, { action: 'branding.update', entityType: 'company', entityId: auth.companyId, after: v })
    return c.body(null, 204)
  })

/** The platform console turns a studio's switches on and off. */
export const platformFeaturesRouter = new Hono<AppEnv>()
  .use('/studios/:id/features', requireAuth, requirePlatformAdmin())
  .get('/studios/:id/features', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'platform.features', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ keys: string[] }[]>`select platform_studio_entitlements(${id}) as keys`),
    )
    if (!rows) fail(400, 'We could not load this studio’s features.')
    return c.json(entitlementsResponse.parse({ keys: rows[0]?.keys ?? [] }))
  })
  .put('/studios/:id/features', async (c) => {
    const id = uuidParam(c)
    const parsed = setEntitlementRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a feature.')
    const rows = await attempt(c, 'platform.features_set', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ keys: string[] }[]>`
        select platform_set_entitlement(${id}, ${parsed.data.key}, ${parsed.data.enabled}) as keys`),
    )
    if (!rows) fail(400, 'We could not change this studio’s features.')
    await audit(c, { action: 'platform.feature_set', entityType: 'company', entityId: id, after: parsed.data })
    return c.json(entitlementsResponse.parse({ keys: rows[0]?.keys ?? [] }))
  })
