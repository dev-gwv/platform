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
  content: z.string().max(4000),
})
export type AssistantTurn = z.infer<typeof assistantTurn>

export const askRequest = z.object({
  question: z.string().trim().min(3, 'Ask a question of at least a few words.').max(500),
  /**
   * Carried by the panel, not stored: the conversation lives as long as the
   * panel is open. Capped because the whole help corpus is already in the
   * prompt and a long history would crowd it out.
   */
  history: z.array(assistantTurn).max(10).default([]),
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
})
export type AskReply = z.infer<typeof askReply>

/** What a platform admin may change, from /platform/assistant. */
export const saveAssistantSettingsRequest = z.object({
  assistant_enabled: z.boolean(),
  assistant_prompt: z.string().trim().max(8000).nullable(),
  assistant_model: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._/:-]{1,120}$/, 'A model name, e.g. llama-3.3-70b-versatile.')
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
