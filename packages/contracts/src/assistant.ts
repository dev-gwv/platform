import { z } from 'zod'

/**
 * The help assistant (0247).
 *
 * A studio owner asks a question in their own words and gets an answer from the
 * help the product already ships — the /learn guide, the tutorials and the FAQs.
 * When the question is beyond that, it offers a call instead of guessing.
 *
 * It can see help content and nothing else: no leads, no projects, no money.
 */

/**
 * The providers we know the address of, so the console can offer a name rather
 * than ask someone to look up a URL. An address not on this list is typed in
 * full and works the same -- the driver only needs chat-completions.
 *
 * Here rather than in the API because the platform console draws the same list
 * the driver defaults from, and two copies of it would drift the first time one
 * of these changed its path.
 */
export const ASSISTANT_PROVIDERS = [
  { key: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', suggest: 'openai/gpt-oss-120b' },
  { key: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', suggest: 'openai/gpt-oss-120b' },
  { key: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', suggest: 'gpt-4o-mini' },
  { key: 'together', label: 'Together', baseUrl: 'https://api.together.xyz/v1', suggest: 'openai/gpt-oss-120b' },
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', suggest: 'deepseek-chat' },
] as const

/**
 * Tried in turn when the chosen model is gone.
 *
 * Groq retires models on a schedule and answers 404 for a name that worked last
 * month: llama-3.3-70b-versatile went on 16 August 2026 and qwen3.6-27b a month
 * later. A help assistant that stops answering until someone edits a setting is
 * the predictable result, so the driver walks this list instead.
 */
export const ASSISTANT_FALLBACK_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'] as const

/**
 * The fallback chain for a given address.
 *
 * It has to depend on the address, because a model name is not portable: a
 * studio pointed at DeepSeek or OpenAI once fell back to two gpt-oss names
 * neither of them has, turning one 404 into three. An address we do not
 * recognise gets no chain at all -- better one honest error than three.
 */
export function assistantFallbacks(baseUrl: string | null | undefined): readonly string[] {
  const url = (baseUrl || ASSISTANT_PROVIDERS[0].baseUrl).replace(/\/+$/, '')
  const known = ASSISTANT_PROVIDERS.find((p) => p.baseUrl === url)
  if (!known) return []
  // gpt-oss runs on all three of these, and the 20b is the sibling to drop to.
  if (known.key === 'groq' || known.key === 'openrouter' || known.key === 'together') {
    return ASSISTANT_FALLBACK_MODELS
  }
  return [known.suggest]
}

/** What the driver and the console fall back to when nothing is configured. */
export const ASSISTANT_DEFAULT_BASE_URL = ASSISTANT_PROVIDERS[0].baseUrl
export const ASSISTANT_DEFAULT_MODEL = ASSISTANT_PROVIDERS[0].suggest

/** What the panel needs before it draws anything. */
export const assistantState = z.object({
  /** The platform switched it on. Off means the header button is not drawn. */
  enabled: z.boolean(),
  /** A provider key is configured. Off means it would skip every question. */
  ready: z.boolean(),
  /** Where "book a call" goes; null when nobody has set one. */
  call_url: z.string().nullable(),
  asked_today: z.number().int(),
  daily_limit: z.number().int(),
})
export type AssistantState = z.infer<typeof assistantState>

/** One earlier turn, so a follow-up ("and on mobile?") makes sense. */
export const assistantTurn = z.object({
  role: z.enum(['user', 'assistant']),
  /**
   * Short on purpose. The client sends this back, so an 'assistant' turn is
   * whatever the caller says it is -- there is no way to prove we wrote it.
   * The panel only ever sends back real turns, but the contract is the
   * boundary, and 10 x 4000 characters of caller-authored text sitting in the
   * model's mouth is a screenshot waiting to happen. A help answer that needs
   * more than 1,000 characters of itself quoted back is not a follow-up.
   */
  content: z.string().max(1000),
})
export type AssistantTurn = z.infer<typeof assistantTurn>

export const askRequest = z.object({
  question: z.string().trim().min(3, 'Ask a question of at least a few words.').max(500),
  /**
   * Carried by the panel, not stored: the conversation lives as long as the
   * panel is open. Capped to what the panel actually sends -- the gap between
   * the contract's limit and the UI's was pure attack surface -- and because
   * the whole help corpus is already in the prompt.
   */
  history: z.array(assistantTurn).max(6).default([]),
})
export type AskRequest = z.infer<typeof askRequest>

/** Where an answer came from, so a studio can go and read the whole thing. */
export const assistantSource = z.object({
  title: z.string(),
  /** The screen it is about, when the guide names one. */
  to: z.string().nullable().default(null),
  /** A tutorial key, when one shows it. */
  video: z.string().nullable().default(null),
})
export type AssistantSource = z.infer<typeof assistantSource>

export const askReply = z.object({
  /**
   * 'answered'  the help content covered it
   * 'escalated' it could not, and is offering a call
   * 'skipped'   no provider key on the server; nothing was sent
   * 'failed'    the provider refused or could not be reached
   */
  status: z.enum(['answered', 'escalated', 'skipped', 'failed']),
  answer: z.string(),
  sources: z.array(assistantSource).default([]),
  call_url: z.string().nullable().default(null),
  /**
   * The log row this answer was written to, so "did this help?" can mark the
   * right one. Null when the log could not be written -- the answer still
   * stands; only the thumb is lost.
   */
  log_id: z.string().uuid().nullable().default(null),
})
export type AskReply = z.infer<typeof askReply>

/** What a platform admin may change, from /platform/assistant. */
export const saveAssistantSettingsRequest = z.object({
  assistant_enabled: z.boolean(),
  assistant_prompt: z.string().trim().max(8000).nullable(),
  assistant_model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._/:-]{1,120}$/, 'A model name, e.g. openai/gpt-oss-120b.')
    .or(z.literal(''))
    .nullable(),
  assistant_base_url: z
    .string()
    .trim()
    .url('That does not look like a web address.')
    .startsWith('https://', 'The address must start with https://')
    .or(z.literal(''))
    .nullable(),
  support_call_url: z
    .string()
    .trim()
    .url('That does not look like a web address.')
    .startsWith('https://', 'The link must start with https://')
    .or(z.literal(''))
    .nullable(),
  assistant_daily_limit: z.number().int().min(1).max(1000).nullable(),
})
export type SaveAssistantSettingsRequest = z.infer<typeof saveAssistantSettingsRequest>

export const assistantSettings = saveAssistantSettingsRequest.extend({
  /** Whether the server has a key at all — the console says so plainly. */
  ready: z.boolean(),
})
export type AssistantSettings = z.infer<typeof assistantSettings>

/** "Did this help?" on one answer. */
export const assistantFeedbackRequest = z.object({
  log_id: z.string().uuid(),
  helpful: z.boolean(),
})
export type AssistantFeedbackRequest = z.infer<typeof assistantFeedbackRequest>

/** What the platform console reads about how the assistant is doing. */
export const assistantLogRow = z.object({
  id: z.string().uuid(),
  question: z.string(),
  answer: z.string().nullable(),
  status: z.enum(['answered', 'escalated', 'skipped', 'failed']),
  helpful: z.boolean().nullable(),
  model: z.string().nullable(),
  prompt_tokens: z.number().int().nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
})
export type AssistantLogRow = z.infer<typeof assistantLogRow>

export const assistantHealth = z.object({
  /** Asked today and over the last seven days. */
  today: z.number().int(),
  week: z.number().int(),
  /** The split over the last seven days. */
  answered: z.number().int(),
  escalated: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  /** Of the answers somebody marked. */
  helpful: z.number().int(),
  unhelpful: z.number().int(),
  /** The retrieval tripwire: average prompt size over the week. */
  avg_prompt_tokens: z.number().int().nullable(),
  recent: z.array(assistantLogRow),
})
export type AssistantHealth = z.infer<typeof assistantHealth>

/**
 * What a test question proved.
 *
 * `ready` on the settings only says a key is present, which is not the same as
 * the key working, the model still existing, or the corpus loading. This is the
 * one call that exercises the whole path.
 */
export const assistantTestResult = z.object({
  status: z.enum(['answered', 'escalated', 'skipped', 'failed']),
  answer: z.string(),
  /** The model that actually answered -- not necessarily the one configured. */
  model: z.string().nullable(),
  prompt_tokens: z.number().int().nullable(),
  /** How long the whole thing took, so a slow provider is visible. */
  ms: z.number().int(),
  error: z.string().nullable(),
})
export type AssistantTestResult = z.infer<typeof assistantTestResult>
