import { ASSISTANT_DEFAULT_BASE_URL, ASSISTANT_DEFAULT_MODEL, assistantFallbacks } from '@ipc/contracts'

/**
 * The AI engine: one interface, so the provider is a setting and not a rewrite.
 *
 * Groq, OpenRouter, OpenAI, Together, DeepSeek, Fireworks and a local Ollama all
 * speak the same chat-completions shape, so one driver covers all of them and
 * moving between them is a base URL and a key. That is the whole reason this
 * file exists as a layer of its own: the feature code below it (the help
 * assistant, and whatever comes next) never names a vendor.
 *
 * A provider that does NOT speak this shape -- Anthropic and Gemini differ in
 * both the message and the tool-call shape -- gets its own small driver next to
 * `openAiCompatible`, exporting the same `ChatProvider`. Nothing above has to
 * change for that. We have not written one yet because nothing needs it; the
 * existing Anthropic call (lib/diamond-check.ts) reads images and is a different
 * job from holding a conversation.
 *
 * No SDK and no framework on purpose. This is one HTTP POST with a JSON body;
 * a chain-and-agent library would add a dependency tree to the container to
 * wrap it, and tool-calling -- the only part that looks like it needs a
 * framework -- is native to the same request.
 */

/** Who said a thing. 'tool' carries the result of a tool the model asked for. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
  /** Set on a 'tool' message: which call it answers. */
  toolCallId?: string
}

/** A tool the model may ask us to run. `parameters` is JSON Schema. */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** The model asking for a tool. `args` is whatever it sent, still unchecked. */
export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface ChatRequest {
  messages: readonly ChatMessage[]
  tools?: readonly ToolSpec[]
  maxTokens?: number
  /** Low by default: a help answer should be the same answer twice running. */
  temperature?: number
}

export interface ChatUsage {
  promptTokens: number | null
  completionTokens: number | null
}

/**
 * Deliberately not a thrown error.
 *
 * Every caller has to decide what a studio sees when the model is unavailable,
 * and a result they must look at makes them decide. `lib/email.ts` settled on
 * the same shape for the same reason, down to telling "no key" apart from
 * "refused": one is our configuration mistake and silent, the other is worth
 * saying out loud.
 */
export type ChatReply =
  | {
      ok: true
      text: string
      /** Empty unless the model asked for a tool. */
      calls: readonly ToolCall[]
      model: string
      usage: ChatUsage
      /** True when the model stopped because it ran out of room. */
      truncated: boolean
    }
  | {
      ok: false
      /** 'no_key' nothing was sent | 'refused' the provider said no | 'unreachable' we never got an answer */
      kind: 'no_key' | 'refused' | 'unreachable'
      /** A sentence fit to show someone, never a status code on its own. */
      error: string
    }

export interface ChatProvider {
  /** For the log, so a bad week can be traced to a provider. */
  readonly id: string
  readonly model: string
  chat(req: ChatRequest): Promise<ChatReply>
}

/** 30s for one call: well past Groq, and short enough that a studio is not left staring. */
const TIMEOUT_MS = 30_000

/**
 * 25s for everything, retries and fallbacks included -- inside the browser's own
 * 30 s, so whatever happens the studio hears the real answer rather than its
 * own timeout.
 */
const TOTAL_MS = 25_000

/**
 * Why the provider said no, as a sentence.
 *
 * The status alone is no use to whoever is reading the log at nine in the
 * evening, and "try again in a minute" for a monthly quota sends them to wait
 * for something that will not happen -- the mistake this app already made once
 * with Resend's 429, where a spent monthly allowance was reported as a burst.
 * So 429 says both things might be true and names the thing to check.
 */
export function refusalSentence(status: number, raw: string): string {
  let said = ''
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown } | string; message?: unknown }
    const e = body.error
    said = String((typeof e === 'object' && e ? e.message : e) ?? body.message ?? '')
  } catch {
    said = raw
  }
  const why =
    status === 401 || status === 403
      ? 'the AI provider did not accept the key'
      : status === 404
        ? 'the AI provider does not have that model (check the model name)'
        : status === 429
          ? 'the AI provider is rate-limiting us, or the plan has run out of credit for now'
          : status === 400 || status === 422
            ? 'the AI provider rejected the request'
            : status >= 500
              ? 'the AI provider is having trouble'
              : `the AI provider answered ${status}`
  const tail = said ? ` (${said.replace(/\s+/g, ' ').trim().slice(0, 200)})` : ''
  return `${why}${tail}.`
}

/**
 * Extra body fields a particular model family needs.
 *
 * gpt-oss is a reasoning model: left alone it spends tokens thinking before it
 * answers, which for "where do I add a team member" is latency and cost for
 * nothing. Groq returns that thinking in its own `reasoning` field rather than
 * in `content`, so switching it off costs us no part of the answer.
 *
 * Keyed on the model name because the model is a setting and the provider is a
 * URL -- the same gpt-oss runs on Groq, OpenRouter and Together, and all three
 * want the same treatment. An unknown model gets nothing added, which is what
 * every plain chat model wants.
 */
function tuningFor(model: string): Record<string, unknown> {
  if (/gpt-oss/i.test(model)) return { reasoning_effort: 'low', include_reasoning: false }
  return {}
}

/** Worth trying the same request again: a blip, not a refusal. */
const transient = (status: number) => status === 429 || status >= 500

/** The model is gone. Groq answers 404 for a name it retired. */
const modelGone = (status: number) => status === 404

/** The wire shape, kept local: nothing above this file should know it. */
interface WireChoice {
  message?: {
    content?: string | null
    tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] | null
  }
  finish_reason?: string | null
}
interface WireReply {
  model?: string
  choices?: WireChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * One driver for every provider that speaks chat-completions.
 *
 * `fetchImpl` is the test seam, the way lib/diamond-check.ts takes a `client`:
 * a test hands in a function and never touches the network.
 */
export function openAiCompatible(cfg: {
  apiKey: string | undefined
  baseUrl?: string | undefined
  model?: string | undefined
  id?: string | undefined
  timeoutMs?: number | undefined
  /** Tried in turn if the chosen model is gone. Defaults to the address's chain. */
  fallbackModels?: readonly string[] | undefined
  /** The budget for the whole walk, retries and fallbacks included. */
  totalMs?: number | undefined
  fetchImpl?: typeof fetch | undefined
}): ChatProvider {
  const baseUrl = (cfg.baseUrl || ASSISTANT_DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = cfg.model || ASSISTANT_DEFAULT_MODEL
  const doFetch = cfg.fetchImpl ?? fetch
  const id = cfg.id || hostOf(baseUrl)

  /** The chosen model first, then the fallbacks, each name only once. */
  const chain = [...new Set([model, ...(cfg.fallbackModels ?? assistantFallbacks(baseUrl))])]

  /** One POST. Returns the reply, and the status when the provider refused. */
  async function once(useModel: string, req: ChatRequest): Promise<{ reply: ChatReply; status: number }> {
    // Hand-rolled rather than AbortSignal.timeout so the reason is ours to
    // report: an aborted fetch and a dropped connection throw the same way.
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), cfg.timeoutMs ?? TIMEOUT_MS)
    try {
      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey!}`, 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          model: useModel,
          // A help answer should not vary between two people asking the same
          // thing on the same day.
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 800,
          ...tuningFor(useModel),
          messages: req.messages.map((m) =>
            m.role === 'tool'
              ? { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? '' }
              : { role: m.role, content: m.content },
          ),
          ...(req.tools?.length
            ? {
                tools: req.tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
                tool_choice: 'auto',
              }
            : {}),
        }),
      })

      if (!res.ok) {
        const raw = await res.text().catch(() => '')
        console.error(`[ai] ${id} ${useModel} refused ${res.status}: ${raw.slice(0, 500)}`)
        return { reply: { ok: false, kind: 'refused', error: refusalSentence(res.status, raw) }, status: res.status }
      }

      const json = (await res.json().catch(() => ({}))) as WireReply
      const choice = json.choices?.[0]
      return {
        status: 200,
        reply: {
          ok: true,
          text: (choice?.message?.content ?? '').trim(),
          calls: (choice?.message?.tool_calls ?? []).flatMap((c) =>
            c.function?.name ? [{ id: c.id ?? '', name: c.function.name, args: parseArgs(c.function.arguments) }] : [],
          ),
          model: json.model || useModel,
          usage: {
            promptTokens: json.usage?.prompt_tokens ?? null,
            completionTokens: json.usage?.completion_tokens ?? null,
          },
          truncated: choice?.finish_reason === 'length',
        },
      }
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError'
      console.error(`[ai] ${id} ${useModel} ${aborted ? 'timed out' : 'threw'}`, e instanceof Error ? e.message : e)
      return {
        // 0: nothing came back, so there is no status to reason about. Treated
        // as transient, because a dropped connection usually is.
        status: 0,
        reply: {
          ok: false,
          kind: 'unreachable',
          error: aborted ? 'The AI provider did not answer in time.' : 'We could not reach the AI provider.',
        },
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    id,
    model,
    async chat(req) {
      if (!cfg.apiKey) {
        return { ok: false, kind: 'no_key', error: 'The AI assistant is not set up on the server (no API key).' }
      }

      let last: ChatReply | null = null
      // One budget for the whole walk. Without it the worst case is two models
      // by two attempts by the per-call timeout, which outlasts the browser's
      // own 30 s -- so the studio was shown a failure while the server was
      // still trying, and the log recorded an answer nobody ever saw.
      const giveUpAt = Date.now() + (cfg.totalMs ?? TOTAL_MS)

      for (const useModel of chain) {
        if (Date.now() >= giveUpAt) break
        let status = -1
        // One retry for a blip. Not more: a studio is waiting, and three
        // attempts at a provider that is down is just a slower failure.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const got = await once(useModel, req)
          if (got.reply.ok) {
            if (useModel !== model) console.warn(`[ai] ${id} answered on ${useModel}; ${model} is unavailable`)
            return got.reply
          }
          last = got.reply
          status = got.status
          // status 0 is "nothing came back": a dropped connection or a timeout,
          // which is usually worth one more go.
          if (!(status === 0 || transient(status)) || attempt === 1) break
          if (Date.now() + RETRY_PAUSE_MS >= giveUpAt) break
          await wait(RETRY_PAUSE_MS)
        }

        // Only a retired model is worth trying the next name for. A bad key or
        // a malformed request would fail identically all the way down the chain,
        // turning one clear error into three slow ones.
        if (!modelGone(status)) return last!
        console.warn(`[ai] ${id} has no model ${useModel}; trying the next one`)
      }

      return last!
    },
  }
}

/** Long enough to clear a rate-limit burst, short enough nobody notices twice. */
const RETRY_PAUSE_MS = 400

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Arguments arrive as a JSON string, and a model can send a broken one. */
function parseArgs(raw: string | undefined): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'ai'
  }
}
