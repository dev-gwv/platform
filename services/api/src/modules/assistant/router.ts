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
import { openAiCompatible } from '../../lib/ai'
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
}

const readSettings = (env: AppEnv['Bindings']) =>
  withService(env, async (sql) => {
    const [row] = await sql<SettingsRow[]>`
      select assistant_enabled, assistant_prompt, assistant_model, assistant_base_url,
             support_call_url, assistant_daily_limit
        from platform_settings limit 1`
    return row ?? null
  })

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

    const help = await buildHelpContext(c.env)
    const result = await ask({
      provider: openAiCompatible({
        apiKey: c.env.AI_API_KEY,
        baseUrl: row.assistant_base_url || c.env.AI_BASE_URL,
        model: row.assistant_model || c.env.AI_MODEL,
      }),
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
        ready: !!c.env.AI_API_KEY,
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
            avg(prompt_tokens) filter (where created_at >= now() - interval '7 days')::int as avg_prompt_tokens
          from assistant_log`
        const recent = await sql`
          select id, question, answer, status, helpful, model, prompt_tokens, error,
                 to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
            from assistant_log order by created_at desc limit 50`
        return { ...(n ?? {}), recent }
      }),
    )
    if (!data) fail(400, 'We could not load how the assistant is doing.')
    return c.json(assistantHealth.parse(data))
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
    const help = await buildHelpContext(c.env)
    const result = await ask({
      provider: openAiCompatible({
        apiKey: c.env.AI_API_KEY,
        baseUrl: row?.assistant_base_url || c.env.AI_BASE_URL,
        model: row?.assistant_model || c.env.AI_MODEL,
      }),
      help,
      prompt: row?.assistant_prompt,
      callUrl: callLinkFor(c.env, row ?? null),
      question: 'How do I add my team?',
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

    const ok = await attempt(c, 'platform.assistant_save', () =>
      withService(c.env, (sql) => sql`
        update platform_settings
           set assistant_enabled = ${d.assistant_enabled},
               assistant_prompt = ${prompt},
               assistant_model = ${model},
               assistant_base_url = ${baseUrl},
               support_call_url = ${callUrl},
               assistant_daily_limit = ${d.assistant_daily_limit},
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
        prompt_length: prompt?.length ?? 0,
      },
    })
    return c.json({ ok: true })
  })
