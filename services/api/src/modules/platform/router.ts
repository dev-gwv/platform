import { Hono } from 'hono'
import { platformStudioList, platformUsage, platformPlanAction, platformCreateStudioRequest, platformUsageQuery, featureRequest, featureRequestStatus, updateFeatureRequest, z } from '@ipc/contracts'
import { serve } from '../files/router'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { platformMessagingRouter } from './messaging'

/**
 * The vendor's cross-tenant console. Gated twice: requirePlatformAdmin() here,
 * and again inside each security-definer RPC (defence in depth — the RPC is the
 * boundary that actually crosses tenant RLS).
 */
export const platformRouter = new Hono<AppEnv>()
  .use('*', requireAuth, requirePlatformAdmin())

  /** Every studio's "Suggest a feature", newest first. */
  .get('/feedback', async (c) => {
    const want = c.req.query('status')
    const status = want ? featureRequestStatus.safeParse(want) : null
    if (want && !status?.success) fail(422, 'Unknown status.')
    const rows = await attempt(c, 'platform.feedback', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select * from platform_list_feature_requests(${status?.success ? status.data : null})`),
    )
    if (!rows) fail(400, 'We could not load the suggestions.')
    return c.json(featureRequest.array().parse(rows))
  })

  .patch('/feedback/:id', async (c) => {
    const parsed = updateFeatureRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the status or note.')
    const id = uuidParam(c)
    const rows = await attempt(c, 'platform.feedback_update', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ ok: boolean }[]>`
        select platform_update_feature_request(${id}, ${parsed.data.status ?? null}, ${parsed.data.admin_note ?? null}) as ok`),
    )
    if (!rows) fail(400, 'We could not update that suggestion.')
    if (!rows[0]?.ok) fail(404, 'That suggestion was not found.')
    return c.body(null, 204)
  })

  /** A voice note or screenshot on a suggestion (another studio's file, so not via /files). */
  .get('/feedback/:id/files/:fid', async (c) => {
    const id = uuidParam(c)
    const fid = uuidParam(c, 'fid')
    const rows = await attempt(c, 'platform.feedback_file', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ name: string; mime: string; bytes: Buffer }[]>`
        select * from platform_feature_request_file(${id}, ${fid})`),
    )
    if (!rows) fail(400, 'We could not load that file.')
    if (!rows.length) fail(404, 'That file was not found.')
    return serve(rows[0]!)
  })

  .get('/studios', async (c) => {
    const rows = await attempt(c, 'platform.studios', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from platform_list_studios()`),
    )
    if (!rows) fail(400, 'We could not load studios.')
    // Lovable parity: search/filter/sort/pagination/CSV/stats are client-side
    // over this list (single query, vendor console scale). Query params are
    // accepted so the UI can deep-link a filtered view.
    const q = (c.req.query('search') ?? '').trim().toLowerCase()
    const gate = c.req.query('plan_gate') ?? ''
    const sort = c.req.query('sort') ?? 'created_desc'
    const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1)
    const pageSize = Math.min(200, Math.max(1, Number(c.req.query('page_size') ?? 100) || 100))
    let list = (rows as Record<string, unknown>[])
    if (q) {
      list = list.filter((s) =>
        [s['name'], s['owner_email'], s['owner_name']].some((v) =>
          typeof v === 'string' && v.toLowerCase().includes(q)))
    }
    if (gate) list = list.filter((s) => s['plan_gate'] === gate)
    const by: Record<string, (a: Record<string, unknown>, b: Record<string, unknown>) => number> = {
      created_desc: (a, b) => String(b['created_at'] ?? '').localeCompare(String(a['created_at'] ?? '')),
      created_asc: (a, b) => String(a['created_at'] ?? '').localeCompare(String(b['created_at'] ?? '')),
      name_asc: (a, b) => String(a['name'] ?? '').localeCompare(String(b['name'] ?? '')),
      expiry_asc: (a, b) => String(a['plan_expiry'] ?? 'z').localeCompare(String(b['plan_expiry'] ?? 'z')),
    }
    list = [...list].sort(by[sort] ?? by['created_desc'])
    // Enrich with owner profile + heartbeat last-seen (best-effort).
    try {
      const enriched = await withUser(c.env, c.get('auth').userId, async (sql) => {
        const det = await sql<Record<string, unknown>[]>`select * from platform_usage_detailed(30)`
        const byId = new Map(det.map((d) => [String(d['company_id']), d]))
        return { det: byId }
      })
      list = list.map((s) => {
        const d = enriched.det.get(String(s['id']))
        return { ...s, last_seen: d?.['last_seen'] ?? null, active_today: d?.['active_today'] ?? null }
      })
    } catch { /* heartbeat table may predate migration */ }
    const total = list.length
    const paged = list.slice((page - 1) * pageSize, page * pageSize)
    // Contract stays an array (old clients); pagination meta rides on a header.
    c.header('X-Total-Count', String(total))
    return c.json(platformStudioList.parse(paged))
  })

  // Lovable parity: create-studio (vendor-provisioned tenant).
  .post('/studios', async (c) => {
    const parsed = platformCreateStudioRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Please check the studio details.')
    const row = await attempt(c, 'platform.create_studio', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql<{ id: string }[]>`
          insert into companies (name) values (${parsed.data.name}) returning id`
        const companyId = rows[0]?.id
        if (!companyId) return null
        // Who this studio is for. Owner membership is created when they
        // register against this row — without it the company is an orphan
        // nobody can claim, which is what used to happen: the table did not
        // exist and this insert's failure was swallowed.
        await sql`insert into platform_studio_invites (company_id, email, name, phone, plan_key, invited_by)
          values (${companyId}, ${parsed.data.owner_email}, ${parsed.data.owner_name ?? null},
                  ${parsed.data.owner_phone ?? null}, ${parsed.data.plan_key ?? null}, ${c.get('auth').userId})
          on conflict do nothing`
        if (parsed.data.plan_key) {
          try {
            await sql`select platform_grant_trial(p_company_id => ${companyId})`
          } catch { /* keep going */ }
        }
        return { id: companyId }
      }),
    )
    if (!row) fail(400, 'We could not create this studio.')
    await audit(c, { action: 'platform.studio_create', entityType: 'company', entityId: (row as { id: string }).id, after: parsed.data })
    return c.json(row, 201)
  })

  .get('/usage', async (c) => {
    const parsed = platformUsageQuery.safeParse({
      days: c.req.query('days') ?? undefined,
      module: c.req.query('module') ?? undefined,
      search: c.req.query('search') ?? undefined,
    })
    const days = parsed.success ? parsed.data.days : 30
    const row = await attempt(c, 'platform.usage', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const rows = await sql`select * from platform_usage_summary()`
        return rows[0] ?? null
      }),
    )
    if (!row) fail(400, 'We could not load usage.')
    // Lovable parity: heartbeat rollup merged onto the base summary.
    // usage_events is a NEW table — never activity_log. Best-effort so a
    // pre-migration bench still returns the 4 base cards.
    let extra: Record<string, unknown> = {}
    try {
      const agg = await withUser(c.env, c.get('auth').userId, async (sql) => {
        const sessions = await sql<{ company_id: string; sessions: string; events: string }[]>`
          select company_id::text as company_id, count(distinct session_id)::text as sessions,
                 count(*)::text as events
            from usage_events where occurred_at > now() - make_interval(days => ${days})
            group by company_id`
        const today = await sql<{ c: string }[]>`
          select count(distinct session_id)::text as c from usage_events
           where occurred_at > now() - interval '1 day'`
        const week = await sql<{ c: string }[]>`
          select count(distinct session_id)::text as c from usage_events
           where occurred_at > now() - interval '7 days'`
        const modules = await sql<{ module: string; events: string }[]>`
          select coalesce(module, 'other') as module, count(*)::text as events
            from usage_events where occurred_at > now() - make_interval(days => ${days})
            group by 1 order by 2 desc limit 12`
        const top = await sql<{ company_id: string; company_name: string | null; events: string }[]>`
          select ue.company_id::text as company_id, co.name as company_name, count(*)::text as events
            from usage_events ue left join companies co on co.id = ue.company_id
           where ue.occurred_at > now() - make_interval(days => ${days})
           group by 1, 2 order by 3 desc limit 10`
        const recent = await sql<{ company_id: string; route: string | null; module: string | null; occurred_at: string }[]>`
          select company_id::text, route, module, occurred_at::text from usage_events
           order by occurred_at desc limit 25`
        return { sessions, today: today[0]?.c, week: week[0]?.c, modules, top, recent }
      })
      const totalSessions = agg.sessions.reduce((s, r) => s + Number(r.sessions), 0)
      const totalEvents = agg.sessions.reduce((s, r) => s + Number(r.events), 0)
      extra = {
        active_today: Number(agg.today ?? 0),
        active_week: Number(agg.week ?? 0),
        active_month: agg.sessions.length,
        inactive_count: Math.max(0, Number((row as Record<string, unknown>)['studio_count'] ?? 0) - agg.sessions.length),
        sessions_30d: totalSessions,
        events_30d: totalEvents,
        avg_sessions_per_studio: agg.sessions.length ? totalSessions / agg.sessions.length : 0,
        modules: agg.modules.map((m) => ({ module: m.module, events: Number(m.events) })),
        top_studios: agg.top.map((t) => ({ company_id: t.company_id, company_name: t.company_name, events: Number(t.events) })),
        recent_events: agg.recent,
      }
    } catch {
      extra = {}
    }
    return c.json(platformUsage.parse({ ...(row as Record<string, unknown>), ...extra }))
  })

  // Extend / expire / grant-trial on one tenant's plan. Each RPC re-checks the
  // allowlist and logs a billing_event; the audit row here is the vendor's own.
  // Lovable parity: `custom` months + `assign` a paid plan key directly.
  .post('/studios/:id/plan', async (c) => {
    const raw = await c.req.json().catch(() => ({})) as Record<string, unknown>
    // `assign` + `custom` are Lovable-parity aliases handled here; the contract
    // still validates extend/expire/trial.
    const extended = z.object({
      action: z.enum(['extend', 'expire', 'trial', 'custom', 'assign']),
      months: z.number().int().min(1).max(60).optional(),
      plan_key: z.string().trim().max(80).optional(),
    }).safeParse(raw)
    if (!extended.success) fail(422, 'Please check the action.')
    const id = uuidParam(c)
    const { action, months, plan_key } = extended.data
    const parsed = action === 'custom'
      ? { action: 'extend' as const, months: months ?? 12 }
      : action === 'assign'
        ? { action: 'extend' as const, months: 12 }
        : platformPlanAction.parse({ action, months })
    const ok = await attempt(c, 'platform.plan', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        if (parsed.action === 'extend') {
          await sql`select platform_extend_plan(p_company_id => ${id}, p_months => ${parsed.months!})`
          if (action === 'assign' && plan_key) {
            await sql`update companies set plan_key = ${plan_key} where id = ${id}`.catch(() => [])
          }
        } else if (parsed.action === 'expire') {
          await sql`select platform_expire_plan(p_company_id => ${id})`
        } else {
          await sql`select platform_grant_trial(p_company_id => ${id})`
        }
        return true
      }),
    )
    if (!ok) fail(400, 'We could not update the plan.')
    await audit(c, { action: `platform.plan_${action}`, entityType: 'company', entityId: id, after: extended.data })
    return c.json({ ok: true })
  })

  // Messaging wallets, recharge requests, prices, templates, outbox, margin.
  .route('/messaging', platformMessagingRouter)
