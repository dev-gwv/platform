import type { Context } from 'hono'
import type { AppEnv } from '../context'
import type { ChatMessage } from './ai'
import { fail } from '../middleware/errors'
import { attempt } from './attempt'
import { withService } from './db'
import { logAsk } from './assistant'
import { budgetUsed, budgetVerdict, DEFAULT_DAY_TOKENS, DEFAULT_MINUTE_TOKENS } from './ai-budget'
import { providersFor, readSettings } from '../modules/assistant/router'

/** Writings one studio may ask for in a day when nobody has set a number (the assistant's own). */
export const DEFAULT_DAILY_LIMIT = 50

export const AI_OFF = 'AI writing is not switched on yet. Please ask us to switch it on.'

export const dayUsedUp = (n: number) =>
  `Your studio has used today's ${n} AI writings and questions. It opens again tomorrow.`

/**
 * Every AI writer (the designer's "Write it for me", a reply to a lead, a
 * follow-up sequence) goes through here, in this order: the key, the studio's
 * daily allowance (shared with the assistant, `assistant_asked_today`), the
 * platform's token budget, the model, the log. The log keeps only the kind of
 * writing asked for, never a lead's name or number.
 *
 * Answers the model's text, or fails with a sentence the screen can show.
 */
export async function writeWithAi(
  c: Context<AppEnv>,
  opts: { kind: string; messages: ChatMessage[]; maxTokens: number; temperature?: number; cost?: number },
): Promise<string> {
  if (!c.env.AI_API_KEY) fail(503, AI_OFF)
  const auth = c.get('auth')
  const row = await attempt(c, 'ai.write_settings', () => readSettings(c.env))

  const limit = row?.assistant_daily_limit ?? DEFAULT_DAILY_LIMIT
  const used = await attempt(c, 'ai.write_quota', () =>
    withService(c.env, async (sql) => {
      const [r] = await sql<{ n: number }[]>`select assistant_asked_today(${auth.companyId}::uuid) as n`
      return r?.n ?? 0
    }),
  )
  // A count that could not be read lets the writing through, as the assistant does.
  if (used !== null && used >= limit) fail(429, dayUsedUp(limit))

  const spent = await budgetUsed(c.env)
  if (spent) {
    const verdict = budgetVerdict(
      spent,
      {
        minute: row?.assistant_minute_tokens ?? DEFAULT_MINUTE_TOKENS,
        day: row?.assistant_day_tokens ?? DEFAULT_DAY_TOKENS,
      },
      opts.cost ?? 900,
      'en',
    )
    if (!verdict.ok) fail(429, verdict.why)
  }

  const reply = await providersFor(c.env, row ?? null).chat({
    messages: opts.messages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature ?? 0.7,
  })
  await logAsk(
    c.env,
    { companyId: auth.companyId, userId: auth.userId, question: `[${opts.kind}]`.slice(0, 300) },
    reply.ok
      ? {
          status: 'answered',
          answer: reply.text,
          sources: [],
          callUrl: null,
          model: reply.model,
          promptTokens: reply.usage.promptTokens,
          completionTokens: reply.usage.completionTokens,
          cachedTokens: reply.usage.cachedTokens,
          error: null,
        }
      : {
          status: 'failed',
          answer: '',
          sources: [],
          callUrl: null,
          model: null,
          promptTokens: null,
          completionTokens: null,
          cachedTokens: null,
          error: reply.error,
        },
  )
  if (!reply.ok) fail(503, reply.error || 'The AI could not write just now. Try again in a minute.')
  return reply.text
}
