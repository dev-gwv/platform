import { Hono } from 'hono'
import {
  askReply,
  askRequest,
  assistantFeedbackRequest,
  assistantHealth,
  assistantSettings,
  assistantState,
  assistantTestResult,
  saveAssistantSettingsRequest,
} from '@ipc/contracts'
import type { AppEnv } from '../../context'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformAdmin } from '../../middleware/permissions'
import { fail } from '../../middleware/errors'
import { withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { audit } from '../../lib/audit'
import { firstOf, openAiCompatible } from '../../lib/ai'
import {
  budgetUsed,
  budgetVerdict,
  DEFAULT_DAY_TOKENS,
  DEFAULT_MINUTE_TOKENS,
} from '../../lib/ai-budget'
import { ask, logAsk } from '../../lib/assistant'
import { buildHelpContext } from '../../lib/help-context'

/**
 * The help assistant (0247).
 *
 * Two routes for a studio -- what the panel needs to draw itself, and a
 * question -- and the platform console's settings pair beside them.
 *
 * The assistant is given the help content and nothing else, so neither route
 * reads a single row of the studio's own data. That is why the tenant route
 * uses withService for the settings and the log rather than withUser: there is
 * nothing here that RLS needs to scope, and both the settings singleton and the
 * log are service-only tables by design.
 */

/** Questions one studio may ask in a day when nobody has set a number. */
const DEFAULT_DAILY_LIMIT = 50

/** The question the console's Test asks. Also the commonest real one. */
const TEST_QUESTION = 'How do I add my team?'

/**
 * Who the assistant is for.
 *
 * It was asked for as "studio owners working in the app", and the prompt says
 * so in its first line. It also now carries the plans -- what a member pays
 * against what everyone else pays -- and the way every part of the studio
 * works, which is not a junior editor's business. They have their own help:
 * the guide, the tutorials and the Help panel, none of which is gated.
 */
const RUNS_THE_STUDIO = new Set(['super_admin', 'admin', 'manager', 'platform_admin'])

interface SettingsRow {
  assistant_enabled: boolean
  assistant_prompt: string | null
  assistant_model: string | null
  assistant_base_url: string | null
  support_call_url: string | null
  assistant_daily_limit: number | null
  assistant_fallback_base_url: string | null
  assistant_fallback_model: string | null
  assistant_minute_tokens: number | null
  assistant_day_tokens: number | null
}

const readSettings = (env: AppEnv['Bindings']) =>
  withService(env, async (sql) => {
    const [row] = await sql<SettingsRow[]>`
      select assistant_enabled, assistant_prompt, assistant_model, assistant_base_url,
             support_call_url, assistant_daily_limit,
             assistant_fallback_base_url, assistant_fallback_model,
             assistant_minute_tokens, assistant_day_tokens
        from platform_settings limit 1`
    return row ?? null
  })

/**
 * The vendors to try, in order.
 *
 * One provider until the console names a second address and the server holds a
 * second key. `firstOf` keeps `ChatProvider`'s contract either way, so nothing
 * below it knows how many there are.
 *
 * Each one gets a shorter budget than the whole walk, because the point of a
 * second vendor is an answer rather than a longer wait: two providers at the
 * full 25 s would outlast the browser and the studio would be shown a timeout
 * for an answer the server was still fetching.
 */
function providersFor(env: AppEnv['Bindings'], row: SettingsRow | null) {
  const second =
    env.AI_FALLBACK_API_KEY && row?.assistant_fallback_base_url
      ? openAiCompatible({
          apiKey: env.AI_FALLBACK_API_KEY,
          baseUrl: row.assistant_fallback_base_url,
          model: row.assistant_fallback_model || undefined,
          ...SHARED,
        })
      : null
  const first = openAiCompatible({
    apiKey: env.AI_API_KEY,
    baseUrl: row?.assistant_base_url || env.AI_BASE_URL,
    model: row?.assistant_model || env.AI_MODEL,
    ...(second ? SHARED : {}),
  })
  return second ? firstOf([first, second]) : first
}

/**
 * Half the walk each, so two vendors still beat the browser.
 *
 * Both numbers, not just the budget: `totalMs` is only checked between
 * attempts, so a single call left on the 30 s default could run the whole
 * budget over on its own and the second vendor would never be reached in
 * time. The per-call ceiling is what actually bounds a provider that has
 * stopped answering.
 */
const PROVIDER_MS = 11_000
const SHARED = { totalMs: PROVIDER_MS, timeoutMs: PROVIDER_MS } as const

/**
 * Where "book a call" goes. The platform setting first, then the onboarding
 * call link the app already had — a studio wanting to talk to us should not be
 * stopped because the newer of two settings is empty.
 */
const callLinkFor = (env: AppEnv['Bindings'], row: SettingsRow | null) =>
  row?.support_call_url || env.ONBOARDING_CALL_URL || null

export const assistantRouter = new Hono<AppEnv>()
  .use('*', requireAuth)

  /** What the header and the panel need before they draw anything. */
  .get('/state', async (c) => {
    const auth = c.get('auth')
    // Answered rather than refused, so the header simply draws no button.
    if (!RUNS_THE_STUDIO.has(auth.role)) {
      return c.json(assistantState.parse({ enabled: false, ready: false, call_url: null, asked_today: 0, daily_limit: 0 }))
    }
    const data = await attempt(c, 'assistant.state', async () => {
      const row = await readSettings(c.env)
      const limit = row?.assistant_daily_limit ?? DEFAULT_DAILY_LIMIT
      const used = await withService(c.env, async (sql) => {
        const [r] = await sql<{ n: number }[]>`select assistant_asked_today(${auth.companyId}::uuid) as n`
        return r?.n ?? 0
      })
      return {
        enabled: !!row?.assistant_enabled,
        ready: !!c.env.AI_API_KEY,
        call_url: callLinkFor(c.env, row),
        asked_today: used,
        daily_limit: limit,
      }
    })
    if (!data) fail(503, 'We could not check the assistant just now.')
    return c.json(assistantState.parse(data))
  })

  /** A question. */
  .post('/ask', async (c) => {
    const auth = c.get('auth')
    if (!RUNS_THE_STUDIO.has(auth.role)) fail(403, 'The assistant is for whoever runs the studio. Press Help for anything you need.')
    const parsed = askRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the question.')

    const row = await attempt(c, 'assistant.settings', () => readSettings(c.env))
    // The singleton is seeded in 0217, so a missing row means the read failed
    // rather than that this studio has no settings.
    if (!row) fail(503, 'The assistant is not available right now.')
    if (!row.assistant_enabled) fail(403, 'The assistant is not switched on.')

    const limit = row.assistant_daily_limit ?? DEFAULT_DAILY_LIMIT
    const used = await attempt(c, 'assistant.quota', () =>
      withService(c.env, async (sql) => {
        const [r] = await sql<{ n: number }[]>`select assistant_asked_today(${auth.companyId}::uuid) as n`
        return r?.n ?? 0
      }),
    )
    if (used === null) {
      // The count could not be read. Allowed through on purpose -- a database
      // hiccup should not take help away -- but said out loud, because the
      // alternative is an unmetered day nobody notices.
      console.warn('[assistant] could not read the day count; letting the question through')
    }
    if (used !== null && used >= limit) {
      fail(429, `You have asked the assistant ${limit} questions today. It opens again tomorrow.`)
    }

    const help = await buildHelpContext(c.env, parsed.data.question)

    /**
     * The platform's own ceiling, in the provider's units (0260).
     *
     * After the studio's allowance and before the call, because this one is
     * about what the vendor will accept from all of us at once. A null read is
     * let through on purpose -- see lib/ai-budget.ts -- and a pre-model
     * hand-off never gets this far, because it costs nothing to spend.
     */
    const spent = await budgetUsed(c.env)
    if (spent) {
      const verdict = budgetVerdict(
        spent,
        {
          minute: row.assistant_minute_tokens ?? DEFAULT_MINUTE_TOKENS,
          day: row.assistant_day_tokens ?? DEFAULT_DAY_TOKENS,
        },
        // What this question will actually be counted for -- the part that
        // changes, plus the answer. Not help.tokens: the stable block is
        // served from the provider's cache and metered at nothing, and
        // charging it here would refuse two questions a minute where three
        // fit.
        help.varying,
      )
      if (!verdict.ok) {
        console.warn(`[assistant] over the ${verdict.window} budget (${spent.minute}/min, ${spent.day}/day)`)
        fail(429, verdict.why)
      }
    }

    const result = await ask({
      provider: providersFor(c.env, row),
      help,
      prompt: row.assistant_prompt,
      callUrl: callLinkFor(c.env, row),
      question: parsed.data.question,
      history: parsed.data.history,
    })

    const logId = await logAsk(
      c.env,
      { companyId: auth.companyId, userId: auth.userId, question: parsed.data.question },
      // The prompt's size is the tripwire for the "no retrieval needed"
      // decision in help-context.ts, so record ours when the provider did not
      // tell us one.
      { ...result, promptTokens: result.promptTokens ?? help.tokens },
    )

    return c.json(
      askReply.parse({
        status: result.status,
        answer: result.answer,
        sources: result.sources,
        call_url: result.callUrl,
        log_id: logId,
      }),
    )
  })

  /**
   * "Did this help?" -- the only real signal of whether the knowledge base is
   * working. Status is not quality: an answer can be fluent, sourced, logged as
   * 'answered' and still wrong.
   *
   * Scoped to the studio's own row, so one studio cannot mark another's answer,
   * and silent about a row that is not theirs: there is nothing useful to say
   * and nothing to learn from being told.
   */
  .post('/feedback', async (c) => {
    const auth = c.get('auth')
    // The same gate as /state and /ask. It was the one route of the three
    // without it: a thumb needs a log id nobody else can hold, so nothing was
    // reachable, but "nearly impossible" is not the standard the other two
    // are held to.
    if (!RUNS_THE_STUDIO.has(auth.role)) fail(403, 'The assistant is for whoever runs the studio.')
    const parsed = assistantFeedbackRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, 'We could not record that.')
    await attempt(c, 'assistant.feedback', () =>
      withService(c.env, (sql) => sql`
        update assistant_log set helpful = ${parsed.data.helpful}
         where id = ${parsed.data.log_id}::uuid and company_id = ${auth.companyId}::uuid`),
    )
    return c.json({ ok: true })
  })

export const platformAssistantRouter = new Hono<AppEnv>()
  .use('*', requireAuth, requirePlatformAdmin())

  .get('/assistant', async (c) => {
    const row = await attempt(c, 'platform.assistant', () => readSettings(c.env))
    if (!row) fail(400, 'We could not load the assistant settings.')
    return c.json(
      assistantSettings.parse({
        assistant_enabled: row.assistant_enabled,
        assistant_prompt: row.assistant_prompt,
        assistant_model: row.assistant_model,
        assistant_base_url: row.assistant_base_url,
        support_call_url: row.support_call_url,
        assistant_daily_limit: row.assistant_daily_limit,
        assistant_fallback_base_url: row.assistant_fallback_base_url,
        assistant_fallback_model: row.assistant_fallback_model,
        assistant_minute_tokens: row.assistant_minute_tokens,
        assistant_day_tokens: row.assistant_day_tokens,
        ready: !!c.env.AI_API_KEY,
        fallback_ready: !!c.env.AI_FALLBACK_API_KEY,
      }),
    )
  })

  /**
   * How the assistant is actually doing. 0247 wrote a row per question and
   * nothing ever read it, which is the shape that makes "the assistant is
   * unhelpful" and "nobody opens the assistant" look identical from outside --
   * and they want opposite fixes.
   */
  .get('/assistant/health', async (c) => {
    const data = await attempt(c, 'platform.assistant_health', () =>
      withService(c.env, async (sql) => {
        const [n] = await sql<
          {
            today: number
            week: number
            answered: number
            escalated: number
            failed: number
            skipped: number
            helpful: number
            unhelpful: number
            avg_prompt_tokens: number | null
            cached_share: number | null
          }[]
        >`
          select
            count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')::int as today,
            count(*) filter (where created_at >= now() - interval '7 days')::int as week,
            count(*) filter (where created_at >= now() - interval '7 days' and status = 'answered')::int as answered,
            count(*) filter (where created_at >= now() - interval '7 days' and status = 'escalated')::int as escalated,
            count(*) filter (where created_at >= now() - interval '7 days' and status = 'failed')::int as failed,
            count(*) filter (where created_at >= now() - interval '7 days' and status = 'skipped')::int as skipped,
            count(*) filter (where helpful is true)::int as helpful,
            count(*) filter (where helpful is false)::int as unhelpful,
            avg(prompt_tokens) filter (where created_at >= now() - interval '7 days')::int as avg_prompt_tokens,
            -- What share of the prompt the provider served from its cache. The
            -- rate limit counts the rest, so this is the headroom figure.
            (100.0 * sum(cached_tokens) / nullif(sum(prompt_tokens), 0))
              filter (where created_at >= now() - interval '7 days')::int as cached_share
          from assistant_log`
        const recent = await sql`
          select id, question, answer, status, helpful, model, prompt_tokens, cached_tokens, error,
                 to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
            from assistant_log order by created_at desc limit 50`
        const [b] = await sql<{ minute_tokens: number; day_tokens: number }[]>`
          select minute_tokens, day_tokens from assistant_budget_used()`
        return { ...(n ?? {}), used: b, recent }
      }),
    )
    if (!data) fail(400, 'We could not load how the assistant is doing.')
    const row = await attempt(c, 'platform.assistant_health_settings', () => readSettings(c.env))
    return c.json(
      assistantHealth.parse({
        ...data,
        // What the vendor allows, beside what we have spent of it. Questions a
        // day never answered "will the next one work?", because the provider
        // meters tokens and shares them across every studio at once.
        budget: {
          minute_used: data.used?.minute_tokens ?? 0,
          minute_limit: row?.assistant_minute_tokens ?? DEFAULT_MINUTE_TOKENS,
          day_used: data.used?.day_tokens ?? 0,
          day_limit: row?.assistant_day_tokens ?? DEFAULT_DAY_TOKENS,
        },
      }),
    )
  })

  /**
   * Ask one real question, as a platform admin, to prove the whole path: the
   * key is accepted, the model still exists, the corpus loads, and an answer
   * comes back. `ready` on the settings only says a key is present.
   *
   * Deliberately not logged and not counted against anyone's day -- it is our
   * test, not a studio's question, and putting it in assistant_log would skew
   * the very figures the console is there to show.
   */
  .post('/assistant/test', async (c) => {
    const row = await attempt(c, 'platform.assistant_test', () => readSettings(c.env))
    const started = Date.now()
    const help = await buildHelpContext(c.env, TEST_QUESTION)
    const result = await ask({
      // The whole chain, so Test proves the fallback too: a second vendor
      // nobody has ever exercised is a second vendor nobody knows works.
      provider: providersFor(c.env, row ?? null),
      help,
      prompt: row?.assistant_prompt,
      callUrl: callLinkFor(c.env, row ?? null),
      question: TEST_QUESTION,
    })
    return c.json(
      assistantTestResult.parse({
        status: result.status,
        answer: result.answer,
        model: result.model,
        prompt_tokens: result.promptTokens ?? help.tokens,
        ms: Date.now() - started,
        error: result.error,
      }),
    )
  })

  .put('/assistant', async (c) => {
    const parsed = saveAssistantSettingsRequest.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) fail(422, parsed.error.issues[0]?.message ?? 'Please check the details.')
    const d = parsed.data
    // '' collapses to NULL so "empty means the server's default" is one state
    // in the database and not two.
    const prompt = d.assistant_prompt?.trim() || null
    const model = d.assistant_model || null
    const baseUrl = d.assistant_base_url || null
    const callUrl = d.support_call_url || null
    const fallbackUrl = d.assistant_fallback_base_url || null
    const fallbackModel = d.assistant_fallback_model || null

    const ok = await attempt(c, 'platform.assistant_save', () =>
      withService(c.env, (sql) => sql`
        update platform_settings
           set assistant_enabled = ${d.assistant_enabled},
               assistant_prompt = ${prompt},
               assistant_model = ${model},
               assistant_base_url = ${baseUrl},
               support_call_url = ${callUrl},
               assistant_daily_limit = ${d.assistant_daily_limit},
               assistant_fallback_base_url = ${fallbackUrl},
               assistant_fallback_model = ${fallbackModel},
               assistant_minute_tokens = ${d.assistant_minute_tokens},
               assistant_day_tokens = ${d.assistant_day_tokens},
               updated_at = now()`),
    )
    if (!ok) fail(400, 'We could not save the assistant settings.')
    await audit(c, {
      action: 'platform.assistant_settings',
      entityType: 'platform_settings',
      entityId: null,
      // The prompt itself is not recorded: it can run to eight thousand
      // characters and the audit trail wants to say what changed, not carry it.
      after: {
        assistant_enabled: d.assistant_enabled,
        assistant_model: model,
        assistant_base_url: baseUrl,
        support_call_url: callUrl,
        assistant_daily_limit: d.assistant_daily_limit,
        assistant_fallback_base_url: fallbackUrl,
        assistant_fallback_model: fallbackModel,
        assistant_minute_tokens: d.assistant_minute_tokens,
        assistant_day_tokens: d.assistant_day_tokens,
        prompt_length: prompt?.length ?? 0,
      },
    })
    return c.json({ ok: true })
  })
