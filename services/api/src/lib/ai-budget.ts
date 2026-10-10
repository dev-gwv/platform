import type { Env } from '../context'
import { withService } from './db'

/**
 * The provider's budget, which is a platform resource and not a tenant one.
 *
 * 0247 shipped two ceilings and neither knew what the provider allows. The
 * per-address rate limit in index.ts is an abuse ceiling (10 a minute from one
 * office connection). `assistant_asked_today()` is a per-studio allowance (50 a
 * day). Both count questions.
 *
 * Nobody bills in questions. Groq's free tier for openai/gpt-oss-120b is
 * **8,000 tokens a minute and 200,000 a day, shared across every studio at
 * once**. At roughly 1,700 counted tokens a question that is about four
 * questions a minute and a hundred a day for the entire platform -- so one
 * studio inside its allowance could spend four times the per-minute budget on
 * its own, and two studios at fifty questions each could finish the day before
 * a third ever opened the panel.
 *
 * What that looked like from the outside was not "we are busy". It was a 429
 * the driver reports as "the AI provider is rate-limiting us, or the plan has
 * run out of credit", retried once 400 ms later -- which cannot clear a
 * per-minute window -- and then shown to a studio as a broken assistant.
 *
 * So the ceiling is written in tokens, counted the way the provider counts
 * them: cached tokens subtracted, because a cached prefix costs neither money
 * nor rate limit. That subtraction is the entire reason the prompt is split
 * into a stable block and a selected one.
 */

/** Groq's free tier for gpt-oss-120b, which is what we are actually on. */
export const DEFAULT_MINUTE_TOKENS = 8_000
export const DEFAULT_DAY_TOKENS = 200_000

/**
 * Kept back for the questions already in the air.
 *
 * The usage figure is read from the log, and a question is only logged once it
 * has been answered -- so two questions that start together both see the same
 * "used" and both think they fit. Spending up to the last token would make
 * that race a refusal from the provider, which is the thing this exists to
 * prevent. A fifth of the minute's budget is about one question's worth of
 * room.
 */
const HEADROOM = 0.8

export interface BudgetLimits {
  minute: number
  day: number
}

export interface BudgetUse {
  minute: number
  day: number
}

/** What to do about this question. */
export type BudgetVerdict =
  | { ok: true }
  | { ok: false; window: 'minute' | 'day'; why: string }

/**
 * Pure, so the rule is testable without a database or a clock.
 *
 * `cost` is this question's own estimate. Checking `used + cost` rather than
 * `used` is what stops the question that tips us over from being the one the
 * provider refuses: we would rather say "a moment" in our own words than hand
 * someone the vendor's 429.
 */
export function budgetVerdict(used: BudgetUse, limits: BudgetLimits, cost: number): BudgetVerdict {
  if (used.day + cost > limits.day) {
    return {
      ok: false,
      window: 'day',
      // Said as a fact about us, not about them: they have not done anything
      // wrong, and their own allowance may be untouched.
      why: 'The assistant has answered as many questions as it can today. It opens again tomorrow, and Help is always here.',
    }
  }
  if (used.minute + cost > limits.minute * HEADROOM) {
    return {
      ok: false,
      window: 'minute',
      why: 'The assistant is busy just now. Please ask again in a minute.',
    }
  }
  return { ok: true }
}

/** The platform's spend in the last minute and so far today (0260). */
export async function budgetUsed(env: Env): Promise<BudgetUse | null> {
  if (!env.DATABASE_URL) return null
  try {
    return await withService(env, async (sql) => {
      const [r] = await sql<{ minute_tokens: number; day_tokens: number }[]>`
        select minute_tokens, day_tokens from assistant_budget_used()`
      return { minute: r?.minute_tokens ?? 0, day: r?.day_tokens ?? 0 }
    })
  } catch (e) {
    // Allowed through, and said out loud. The alternative is an assistant that
    // goes dark because a read failed, and the provider's own limit is still
    // there underneath us as the real backstop.
    console.error('[assistant] could not read the token budget', e)
    return null
  }
}
