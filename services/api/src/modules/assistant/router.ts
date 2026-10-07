import { Hono } from 'hono'
import { askReply, askRequest, assistantSettings, assistantState, saveAssistantSettingsRequest } from '@ipc/contracts'
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

    await logAsk(
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
      }),
    )
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
