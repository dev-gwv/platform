import { Hono } from 'hono'
import { platformDiamondClaim, platformDiamondDecision, diamondClaimStatus, platformStudioList, platformUsage, platformPlanAction, platformCreateStudioRequest, platformUsageQuery, legacyImportRequest, legacyStudioList, featureRequest, featureRequestStatus, updateFeatureRequest, platformPlanList, flowStopList, platformPlanCounts, platformPlanOnSaleRequest, platformAssignPlanRequest, paymentRecovery, paymentCreditResult, z } from '@ipc/contracts'
import { serve } from '../files/router'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { uuidParam } from '../../lib/params'
import { withService, withUser } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { platformMessagingRouter } from './messaging'
import { platformEmailRouter } from './email'
import { fetchOrderPayments } from '../../lib/razorpay'

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

  // The old app's subscribers (0218): its Studio Access export, imported here.
  // Re-importing updates by the old Company ID; every studio already on the
  // new app with a matching owner or admin email takes its paid time over.
  .get('/legacy', async (c) => {
    const rows = await attempt(c, 'platform.legacy', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from platform_legacy_studios()`),
    )
    if (!rows) fail(400, 'We could not load the old app\'s studios.')
    return c.json(legacyStudioList.parse(rows.map((r) => ({ ...r, carried_at: r['carried_at'] ? new Date(r['carried_at'] as string).toISOString() : null }))))
  })

  .post('/legacy/import', async (c) => {
    const parsed = legacyImportRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'That file does not look like the old app\'s Studio Access export.')
    const rows = parsed.data.rows.map((r) => ({
      old_company_id: r.old_company_id,
      studio_name: r.studio_name,
      owner_name: r.owner_name || null,
      email: r.email ? r.email.toLowerCase() : null,
      phone: r.phone || null,
      plan: r.plan || null,
      expires_at: r.expires_at || null,
      old_created_at: r.old_created_at || null,
    }))
    const result = await attempt(c, 'platform.legacy.import', () =>
      withService(c.env, async (sql) => {
        const before = await sql<{ n: number }[]>`
          select count(*)::int as n from legacy_studios where old_company_id in ${sql(rows.map((r) => r.old_company_id))}`
        await sql`
          insert into legacy_studios ${sql(rows, 'old_company_id', 'studio_name', 'owner_name', 'email', 'phone', 'plan', 'expires_at', 'old_created_at')}
          on conflict (old_company_id) do update set
            studio_name = excluded.studio_name, owner_name = excluded.owner_name, email = excluded.email,
            phone = excluded.phone, plan = excluded.plan, expires_at = excluded.expires_at,
            old_created_at = excluded.old_created_at, imported_at = now()`
        const carried = await sql<{ n: number }[]>`select coalesce(sum(legacy_carry_over(id)), 0)::int as n from companies`
        const updated = before[0]?.n ?? 0
        return { imported: rows.length - updated, updated, carried: carried[0]?.n ?? 0 }
      }),
    )
    if (!result) fail(400, 'We could not import that file.')
    await audit(c, { action: 'platform.legacy_import', entityType: 'company', entityId: null, after: result })
    return c.json(result)
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
    // The Studio Access Manager reads the whole list and pages it itself;
    // only a caller that asks for a page gets one.
    const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1)
    const pageSize = c.req.query('page_size') ? Math.min(200, Math.max(1, Number(c.req.query('page_size')) || 100)) : Number.MAX_SAFE_INTEGER
    let list = (rows as Record<string, unknown>[])
    if (q) {
      list = list.filter((s) =>
        [s['name'], s['owner_email'], s['owner_name'], s['owner_phone']].some((v) =>
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

  /**
   * Where people stop: per screen, visits that opened it and visits that
   * finished it (a visit is one browser session), so "left" is the visits
   * that opened and never finished -- not a count of closes, which a screen
   * that hands on to another (Add your team → the form) would inflate.
   */
  .get('/usage/stuck', async (c) => {
    const days = Math.min(365, Math.max(1, Number(c.req.query('days') ?? 30) || 30))
    const rows = await attempt(c, 'platform.usage_stuck', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        with ev as (
          select route as flow, session_id, company_id, event_name
            from usage_events
           where module = 'flow' and occurred_at > now() - make_interval(days => ${days})
        ), per as (
          select flow, session_id,
                 bool_or(event_name = 'flow_opened') as opened,
                 bool_or(event_name = 'flow_done') as done
            from ev group by flow, session_id
        )
        select f.flow,
               (select count(*) from per p where p.flow = f.flow and p.opened) as opened,
               (select count(*) from per p where p.flow = f.flow and p.done) as done,
               (select count(*) from per p where p.flow = f.flow and p.opened and not p.done) as left,
               count(*) filter (where f.event_name = 'flow_refused') as refused,
               count(*) filter (where f.event_name = 'flow_stuck') as stuck,
               count(*) filter (where f.event_name = 'flow_video') as videos,
               count(distinct f.company_id) as studios
          from ev f
         group by f.flow
         order by 4 desc`),
    )
    if (!rows) fail(400, 'We could not load where people stop.')
    return c.json(flowStopList.parse(rows))
  })

  // Extend / expire / grant-trial on one tenant's plan. Each RPC re-checks the
  // allowlist and logs a billing_event; the audit row here is the vendor's own.
  // Lovable parity: `custom` months + `assign` a paid plan key directly.
  .post('/studios/:id/plan', async (c) => {
    const raw = await c.req.json().catch(() => ({})) as Record<string, unknown>
    // `assign` + `custom` are Lovable-parity aliases handled here; the contract
    // still validates extend/expire/trial.
    const extended = z.object({
      action: z.enum(['extend', 'expire', 'trial', 'custom', 'assign', 'until']),
      months: z.number().int().min(1).max(60).optional(),
      plan_key: z.string().trim().max(80).optional(),
      // 'until': access to the end of this day (0220), as the old board's
      // Extend 30 / 90 / 180 days and Custom expiry did.
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).safeParse(raw)
    if (!extended.success) fail(422, 'Please check the action.')
    const id = uuidParam(c)
    const { action, months, plan_key, until } = extended.data
    if (action === 'until') {
      if (!until) fail(422, 'Pick the date access should run until.')
      const done = await attempt(c, 'platform.plan_until', () =>
        withUser(c.env, c.get('auth').userId, (sql) => sql`select platform_set_access_until(${id}, ${until}::date)`),
      )
      if (!done) fail(422, 'Pick today or a later date.')
      await audit(c, { action: 'platform.plan_until', entityType: 'company', entityId: id, after: { until } })
      return c.json({ ok: true })
    }
    const parsed = action === 'custom'
      ? { action: 'extend' as const, months: months ?? 12 }
      : action === 'assign'
        ? { action: 'extend' as const, months: 12 }
        : platformPlanAction.parse({ action, months })
    const ok = await attempt(c, 'platform.plan', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        if (action === 'assign' && plan_key) {
          // 0226: the real plan column and the plan's own length.
          await sql`select platform_assign_plan(${id}, ${plan_key})`
        } else if (parsed.action === 'extend') {
          await sql`select platform_extend_plan(p_company_id => ${id}, p_months => ${parsed.months!})`
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

  /** The whole plan catalogue, both audiences, for "Assign plan". */
  .get('/plans', async (c) => {
    const rows = await attempt(c, 'platform.plans', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from platform_plans()`),
    )
    if (!rows) fail(400, 'We could not load the plans.')
    return c.json(platformPlanList.parse(rows))
  })

  /** Paying studios and studios on a free trial, for Platform → Plans. */
  .get('/plans/counts', async (c) => {
    const rows = await attempt(c, 'platform.plan_counts', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select * from platform_plan_counts()`),
    )
    if (!rows?.[0]) fail(400, 'We could not count the studios.')
    return c.json(platformPlanCounts.parse(rows[0]))
  })

  /** Put a plan on sale or take it off. A studio already on it keeps it. */
  .patch('/plans/:key', async (c) => {
    const parsed = platformPlanOnSaleRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Say whether the plan is on sale.')
    const key = c.req.param('key')
    const ok = await attempt(
      c,
      'platform.plan_on_sale',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          await sql`select platform_set_plan_on_sale(${key}, ${parsed.data.on_sale})`
          return true
        }),
      { onCode: (code) => (code === '22023' ? fail(404, 'That plan is not in the catalogue.') : undefined) },
    )
    if (!ok) fail(400, 'We could not change the plan.')
    await audit(c, { action: 'platform.plan_on_sale', entityType: 'plan', entityId: key, after: { on_sale: parsed.data.on_sale } })
    return c.json({ ok: true })
  })

  .post('/studios/:id/assign-plan', async (c) => {
    const parsed = platformAssignPlanRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Pick a plan.')
    const id = uuidParam(c)
    const row = await attempt(
      c,
      'platform.assign_plan',
      () =>
        withUser(c.env, c.get('auth').userId, async (sql) => {
          const r = await sql<{ until: string }[]>`select platform_assign_plan(${id}, ${parsed.data.plan_key})::text as until`
          return r[0]?.until ?? null
        }),
      { onCode: (code) => (code === '22023' ? fail(422, 'That plan is not in the catalogue.') : undefined) },
    )
    if (!row) fail(400, 'We could not assign the plan.')
    await audit(c, { action: 'platform.plan_assign', entityType: 'company', entityId: id, after: { plan_key: parsed.data.plan_key, until: row } })
    return c.json({ ok: true, until: row })
  })

  /** Razorpay took the money, the studio did not get its plan. */
  .get('/payments/recovery', async (c) => {
    const row = await attempt(c, 'platform.payment_recovery', () =>
      withUser(c.env, c.get('auth').userId, async (sql) => {
        const r = await sql<{ platform_payment_recovery: unknown }[]>`select platform_payment_recovery()`
        return r[0]?.platform_payment_recovery ?? null
      }),
    )
    if (!row) fail(400, 'We could not load the payments.')
    const can = !!(c.env.RAZORPAY_KEY_ID && c.env.RAZORPAY_KEY_SECRET)
    return c.json(paymentRecovery.parse({ ...(row as object), can_check: can }))
  })

  /**
   * Credit one stuck order. The payment id is never taken from the request:
   * it is a captured payment the webhook ledger already holds for this order,
   * or one Razorpay itself reports for it. activate_subscription is
   * idempotent, so a second press says "already credited".
   */
  .post('/payments/:id/credit', async (c) => {
    const id = uuidParam(c)
    const order = await attempt(c, 'platform.payment_order', () =>
      withService(c.env, async (sql) => {
        const r = await sql<{ razorpay_order_id: string | null; status: string; captured: string | null }[]>`
          select o.razorpay_order_id, o.status,
                 (select e.payload #>> '{payload,payment,entity,id}' from razorpay_webhook_events e
                   where e.payload #>> '{payload,payment,entity,order_id}' = o.razorpay_order_id
                     and e.payload ->> 'event' in ('payment.captured', 'order.paid')
                   order by e.processed_at desc limit 1) as captured
            from payment_orders o where o.id = ${id}`
        return r[0] ?? null
      }),
    )
    if (!order) fail(404, 'That order was not found.')
    if (!order.razorpay_order_id) fail(409, 'This order never reached Razorpay, so there is nothing to credit.')
    let paymentId = order.captured
    if (!paymentId) {
      if (!c.env.RAZORPAY_KEY_ID || !c.env.RAZORPAY_KEY_SECRET) fail(409, 'No captured payment on record, and Razorpay keys are not set to ask.')
      let payments: Awaited<ReturnType<typeof fetchOrderPayments>> = []
      try {
        payments = await fetchOrderPayments(c.env, order.razorpay_order_id)
      } catch {
        fail(503, 'Razorpay did not answer. Try again in a minute.')
      }
      paymentId = payments.find((p) => p.status === 'captured')?.id ?? null
      if (!paymentId) fail(409, 'Razorpay has no captured payment for this order, so the studio was not charged.')
    }
    const result = await attempt(c, 'platform.payment_credit', () =>
      withService(c.env, async (sql) => {
        const r = await sql<{ duplicate: boolean; expires_at: string | null }[]>`
          select duplicate, expires_at::text from activate_subscription(p_order_id => ${id}, p_payment_id => ${paymentId})`
        return r[0] ?? null
      }),
    )
    if (!result) fail(400, 'We could not credit the order.')
    await audit(c, { action: 'platform.payment_credit', entityType: 'payment_order', entityId: id, after: { payment_id: paymentId, duplicate: result.duplicate } })
    return c.json(paymentCreditResult.parse({ expires_at: result.expires_at, duplicate: result.duplicate, payment_id: paymentId }))
  })

  // IPC Diamond claims: every screenshot, how it was decided, and the owner's
  // approve / reject / revoke (0214).
  /** The IPC Diamonds group link shown on every studio's verify card (0217). */
  .get('/diamond/settings', async (c) => {
    const rows = await attempt(c, 'platform.diamond_settings', () =>
      withService(c.env, (sql) => sql<{ l: string | null }[]>`select diamond_group_link as l from platform_settings limit 1`),
    )
    if (!rows) fail(400, 'We could not load the setting.')
    return c.json({ group_link: rows[0]?.l ?? null })
  })

  .put('/diamond/settings', async (c) => {
    const parsed = z
      .object({ group_link: z.string().trim().max(300).url().startsWith('https://').nullable() })
      .safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'The link must start with https://')
    const ok = await attempt(c, 'platform.diamond_settings_save', () =>
      withService(c.env, (sql) => sql`
        update platform_settings set diamond_group_link = ${parsed.data.group_link || null}, updated_at = now()`),
    )
    if (!ok) fail(400, 'We could not save the link.')
    await audit(c, { action: 'platform.diamond_group_link', entityType: 'platform_settings', entityId: null, after: parsed.data })
    return c.json({ group_link: parsed.data.group_link || null })
  })

  .get('/diamond', async (c) => {
    const want = c.req.query('status')
    const status = want ? diamondClaimStatus.safeParse(want) : null
    if (want && !status?.success) fail(422, 'Unknown status.')
    const rows = await attempt(c, 'platform.diamond', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`
        select * from platform_list_diamond_claims(${status?.success ? status.data : null})`),
    )
    if (!rows) fail(400, 'We could not load the claims.')
    return c.json(platformDiamondClaim.array().parse(rows))
  })

  .get('/diamond/:id/file', async (c) => {
    const id = uuidParam(c)
    const rows = await attempt(c, 'platform.diamond_file', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ name: string; mime: string; bytes: Buffer }[]>`
        select * from platform_diamond_claim_file(${id})`),
    )
    if (!rows) fail(400, 'We could not load that screenshot.')
    if (!rows.length) fail(404, 'That screenshot was not found.')
    return serve(rows[0]!)
  })

  .post('/diamond/:id/decide', async (c) => {
    const parsed = platformDiamondDecision.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'Approve or reject.')
    const id = uuidParam(c)
    const rows = await attempt(c, 'platform.diamond_decide', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql<{ s: string }[]>`
        select platform_diamond_decide(${id}, ${parsed.data.approve}, ${parsed.data.reason ?? null}) as s`),
    )
    if (!rows) fail(400, 'We could not save that.')
    await audit(c, { action: parsed.data.approve ? 'platform.diamond_approve' : 'platform.diamond_reject', entityType: 'diamond_claim', entityId: id })
    return c.json({ ok: true, status: rows[0]?.s ?? null })
  })

  .post('/studios/:id/diamond/revoke', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null
    const id = uuidParam(c)
    const ok = await attempt(c, 'platform.diamond_revoke', () =>
      withUser(c.env, c.get('auth').userId, (sql) => sql`select platform_diamond_revoke(${id}, ${reason})`),
    )
    if (!ok) fail(400, 'We could not revoke that.')
    await audit(c, { action: 'platform.diamond_revoke', entityType: 'company', entityId: id, after: { reason } })
    return c.json({ ok: true })
  })

  // Messaging wallets, recharge requests, prices, templates, outbox, margin.
  .route('/messaging', platformMessagingRouter)
  .route('/email', platformEmailRouter)
