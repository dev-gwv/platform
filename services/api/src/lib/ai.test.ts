import { describe, expect, it, vi } from 'vitest'
import { ASSISTANT_DEFAULT_MODEL, assistantFallbacks } from '@ipc/contracts'
import { openAiCompatible, refusalSentence } from './ai'

/**
 * The AI engine (0247). Every test injects `fetchImpl`, so nothing here reaches
 * a provider -- the seam lib/diamond-check.ts established with its `client`
 * parameter, for the same reason: a test that needs a key is a test nobody runs.
 */

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const ok = (content: string, extra: Record<string, unknown> = {}) => ({
  model: 'llama-3.3-70b-versatile',
  choices: [{ message: { content, ...extra }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1200, completion_tokens: 60 },
})

// No default for apiKey: passing `undefined` to a defaulted parameter uses the
// default, so a "without a key" test written that way quietly runs with one.
const askIt = (fetchImpl: typeof fetch, apiKey: string | undefined = 'k') =>
  openAiCompatible({ apiKey, fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] })
const askWithNoKey = (fetchImpl: typeof fetch) =>
  openAiCompatible({ apiKey: undefined, fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] })

describe('openAiCompatible', () => {
  it('sends nothing at all without a key', async () => {
    const f = reply(ok('never asked'))
    const r = await askWithNoKey(f as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.kind).toBe('no_key')
    // The point of 'no_key' is that it is not a failure to report to a studio,
    // and that nothing was spent finding out.
    expect(f).not.toHaveBeenCalled()
  })

  it('reads the answer, the model and the usage back', async () => {
    const r = await askIt(reply(ok('Open Team then People.')) as unknown as typeof fetch)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toBe('Open Team then People.')
    expect(r.model).toBe('llama-3.3-70b-versatile')
    expect(r.usage).toEqual({ promptTokens: 1200, completionTokens: 60, cachedTokens: null })
    expect(r.truncated).toBe(false)
    expect(r.calls).toEqual([])
  })

  it('posts to the provider with the bearer key and the chosen model', async () => {
    const f = reply(ok('hello'))
    await openAiCompatible({ apiKey: 'secret', model: 'my-model', fetchImpl: f as unknown as typeof fetch }).chat({
      messages: [{ role: 'system', content: 'be brief' }],
    })
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!
    expect(url).toContain('/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret')
    expect(JSON.parse(String(init.body)).model).toBe('my-model')
  })

  it('defaults the model when none is configured', () => {
    expect(openAiCompatible({ apiKey: 'k' }).model).toBe(ASSISTANT_DEFAULT_MODEL)
  })

  it('trims a trailing slash off the base URL rather than posting to a double slash', async () => {
    const f = reply(ok('hi'))
    await openAiCompatible({
      apiKey: 'k',
      baseUrl: 'https://example.test/v1/',
      fetchImpl: f as unknown as typeof fetch,
    }).chat({ messages: [] })
    expect((f as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]).toBe('https://example.test/v1/chat/completions')
  })

  it('reports a tool call with its arguments parsed', async () => {
    const r = await askIt(
      reply(
        ok('', {
          tool_calls: [{ id: 'c1', function: { name: 'book_a_call', arguments: '{"reason":"about your bill"}' } }],
        }),
      ) as unknown as typeof fetch,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.calls).toEqual([{ id: 'c1', name: 'book_a_call', args: { reason: 'about your bill' } }])
  })

  it('survives a tool call whose arguments are not valid JSON', async () => {
    // A model does send broken JSON, and throwing here would turn a recoverable
    // escalation into a 500.
    const r = await askIt(
      reply(ok('', { tool_calls: [{ id: 'c1', function: { name: 'book_a_call', arguments: '{"reason":' } }] })) as unknown as typeof fetch,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.calls[0]).toEqual({ id: 'c1', name: 'book_a_call', args: {} })
  })

  it('marks an answer the model ran out of room for', async () => {
    const r = await askIt(
      reply({ ...ok('Open the Shoots tab and'), choices: [{ message: { content: 'Open the Shoots tab and' }, finish_reason: 'length' }] }) as unknown as typeof fetch,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.truncated).toBe(true)
  })

  it('turns a refusal into a sentence instead of a status code', async () => {
    const r = await askIt(reply({ error: { message: 'Invalid API Key' } }, 401) as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('refused')
    expect(r.error).toContain('did not accept the key')
    expect(r.error).toContain('Invalid API Key')
  })

  it('reports an unreachable provider without throwing', async () => {
    const r = await askIt((() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('unreachable')
    expect(r.error).toBe('We could not reach the AI provider.')
  })

  it('gives up on a provider that never answers, and says so', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })) as unknown as typeof fetch
    const r = await openAiCompatible({ apiKey: 'k', timeoutMs: 10, fetchImpl: hang }).chat({ messages: [] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('unreachable')
    expect(r.error).toContain('did not answer in time')
  })

  it('tolerates a body that is not the shape we expect', async () => {
    const r = await askIt(reply({}) as unknown as typeof fetch)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toBe('')
    expect(r.usage).toEqual({ promptTokens: null, completionTokens: null, cachedTokens: null })
  })

  it('only sends a tools array when there are tools', async () => {
    const f = reply(ok('hi'))
    await openAiCompatible({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch }).chat({ messages: [] })
    expect(JSON.parse(String((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body))).not.toHaveProperty('tools')
  })
})

describe('refusalSentence', () => {
  it('names the thing to check for each refusal we have seen', () => {
    expect(refusalSentence(403, '')).toContain('did not accept the key')
    expect(refusalSentence(404, '')).toContain('check the model name')
    expect(refusalSentence(400, '')).toContain('rejected the request')
    expect(refusalSentence(502, '')).toContain('having trouble')
    expect(refusalSentence(418, '')).toContain('answered 418')
  })

  it('does not send anyone off to wait a minute for a spent allowance', () => {
    // The app made exactly this mistake with Resend, reporting an exhausted
    // monthly quota as a burst limit, and someone waited for a reset that was
    // three weeks away. Both causes get named.
    const s = refusalSentence(429, '')
    expect(s).toContain('rate-limiting')
    expect(s).toContain('credit')
  })

  it('quotes what the provider said, from either body shape', () => {
    expect(refusalSentence(400, JSON.stringify({ error: { message: 'bad model' } }))).toContain('bad model')
    expect(refusalSentence(400, JSON.stringify({ error: 'plain string' }))).toContain('plain string')
    expect(refusalSentence(400, JSON.stringify({ message: 'top level' }))).toContain('top level')
  })

  it('passes through a body that is not JSON at all', () => {
    // A proxy in front of the provider answers HTML, and "undefined" in the log
    // would hide which hop refused.
    expect(refusalSentence(502, '<html>Bad Gateway</html>')).toContain('Bad Gateway')
  })

  it('keeps the sentence short enough for a log column', () => {
    expect(refusalSentence(400, JSON.stringify({ message: 'x'.repeat(5000) })).length).toBeLessThan(300)
  })
})

describe('retry and the fallback chain', () => {
  /** Answers each call from a script, and records the model each asked for. */
  function scripted(steps: { status: number; body: unknown }[]) {
    const models: string[] = []
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      models.push(JSON.parse(String(init.body)).model as string)
      const step = steps[Math.min(models.length - 1, steps.length - 1)]!
      return new Response(JSON.stringify(step.body), {
        status: step.status,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    return { f: f as unknown as typeof fetch, models }
  }

  it('tries again once after a rate limit, and succeeds', async () => {
    const { f, models } = scripted([
      { status: 429, body: { error: { message: 'slow down' } } },
      { status: 200, body: ok('Open Team then People.') },
    ])
    const r = await openAiCompatible({ apiKey: 'k', timeoutMs: 5_000, fetchImpl: f }).chat({ messages: [] })
    expect(r.ok).toBe(true)
    expect(models).toHaveLength(2)
    // The same model, not the fallback: a rate limit is a blip, not a retirement.
    expect(new Set(models).size).toBe(1)
  })

  it('gives up after one retry rather than hammering a provider that is down', async () => {
    const { f, models } = scripted([{ status: 503, body: {} }])
    const r = await openAiCompatible({
      apiKey: 'k',
      model: 'only-model',
      fallbackModels: [],
      fetchImpl: f,
    }).chat({ messages: [] })
    expect(r.ok).toBe(false)
    expect(models).toEqual(['only-model', 'only-model'])
  })

  it('does not retry a refusal that a second try cannot fix', async () => {
    // A bad key is a bad key. Retrying it just makes the failure slower.
    const { f, models } = scripted([{ status: 401, body: { error: { message: 'Invalid API Key' } } }])
    const r = await openAiCompatible({ apiKey: 'bad', fallbackModels: [], fetchImpl: f }).chat({ messages: [] })
    expect(r.ok).toBe(false)
    expect(models).toHaveLength(1)
  })

  it('moves to the next model when the chosen one has been retired', async () => {
    // Groq answers 404 for a name it has retired -- llama-3.3-70b-versatile
    // went on 16 August 2026 -- and this is the whole reason the chain exists.
    const { f, models } = scripted([
      { status: 404, body: { error: { message: 'The model `llama-3.3-70b-versatile` does not exist' } } },
      { status: 200, body: ok('Open Team then People.') },
    ])
    const r = await openAiCompatible({
      apiKey: 'k',
      model: 'llama-3.3-70b-versatile',
      fallbackModels: ['openai/gpt-oss-120b'],
      fetchImpl: f,
    }).chat({ messages: [] })
    expect(r.ok).toBe(true)
    expect(models).toEqual(['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'])
  })

  it('does not walk the chain for a failure every model would share', async () => {
    const { f, models } = scripted([{ status: 401, body: {} }])
    await openAiCompatible({
      apiKey: 'bad',
      model: 'a',
      fallbackModels: ['b', 'c'],
      fetchImpl: f,
    }).chat({ messages: [] })
    expect(models).toEqual(['a'])
  })

  it('reports the last failure when every model in the chain is gone', async () => {
    const { f, models } = scripted([{ status: 404, body: { error: { message: 'no such model' } } }])
    const r = await openAiCompatible({ apiKey: 'k', model: 'a', fallbackModels: ['b'], fetchImpl: f }).chat({ messages: [] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('check the model name')
    expect(models).toEqual(['a', 'b'])
  })

  it('never asks for the same model twice because it is also a fallback', async () => {
    const { f, models } = scripted([{ status: 404, body: {} }])
    await openAiCompatible({
      apiKey: 'k',
      model: 'openai/gpt-oss-120b',
      fallbackModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
      fetchImpl: f,
    }).chat({ messages: [] })
    expect(models).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
  })
})

describe('model-aware tuning', () => {
  const bodyOf = (f: unknown) =>
    JSON.parse(String((f as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body))

  it('switches gpt-oss reasoning off, so a help answer is not paid for twice', async () => {
    // Groq returns gpt-oss thinking in its own `reasoning` field, never in
    // content, so turning it off loses no part of the answer.
    const f = reply(ok('hi'))
    await openAiCompatible({ apiKey: 'k', model: 'openai/gpt-oss-120b', fetchImpl: f as unknown as typeof fetch }).chat({ messages: [] })
    expect(bodyOf(f)).toMatchObject({ reasoning_effort: 'low', include_reasoning: false })
  })

  it('adds nothing for a plain chat model', async () => {
    // An unknown provider may reject a field it does not know, so nothing
    // speculative goes on the wire.
    const f = reply(ok('hi'))
    await openAiCompatible({ apiKey: 'k', model: 'gpt-4o-mini', fetchImpl: f as unknown as typeof fetch }).chat({ messages: [] })
    expect(bodyOf(f)).not.toHaveProperty('reasoning_effort')
    expect(bodyOf(f)).not.toHaveProperty('include_reasoning')
  })
})

describe('assistantFallbacks', () => {
  it('offers the gpt-oss pair for the providers that serve it', () => {
    for (const url of [
      'https://api.groq.com/openai/v1',
      'https://openrouter.ai/api/v1',
      'https://api.together.xyz/v1',
    ]) {
      expect(assistantFallbacks(url)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
    }
  })

  it('never offers a model the provider does not have', () => {
    // A studio on DeepSeek used to fall back to two gpt-oss names, turning one
    // honest 404 into three.
    expect(assistantFallbacks('https://api.deepseek.com/v1')).toEqual(['deepseek-chat'])
    expect(assistantFallbacks('https://api.openai.com/v1')).toEqual(['gpt-4o-mini'])
  })

  it('offers nothing for an address we do not know', () => {
    // A local model or a proxy: one clear error beats three slow ones.
    expect(assistantFallbacks('https://llm.inside.example/v1')).toEqual([])
  })

  it('treats an empty address as the default provider', () => {
    expect(assistantFallbacks(null)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
    expect(assistantFallbacks('https://api.groq.com/openai/v1/')).toHaveLength(2)
  })
})

describe('the whole walk is bounded', () => {
  it('stops before the browser would, even with models left to try', async () => {
    // Two models by two attempts by the per-call timeout outlasts the web
    // client's own 30 s, so the studio saw a failure while the server was still
    // working and the log recorded an answer nobody read.
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })) as unknown as typeof fetch
    const started = Date.now()
    const r = await openAiCompatible({
      apiKey: 'k',
      model: 'a',
      fallbackModels: ['b', 'c', 'd'],
      timeoutMs: 40,
      totalMs: 150,
      fetchImpl: slow,
    }).chat({ messages: [] })
    expect(r.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('what the provider says about its cache', () => {
  it('reads the cached share back', async () => {
    // Groq reports it under usage.prompt_tokens_details, and it is the figure
    // that decides whether a question fits: cached tokens count against neither
    // the bill nor the 8,000-a-minute rate limit.
    const r = await askIt(
      reply({
        ...ok('hi'),
        usage: { prompt_tokens: 3_000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 2_400 } },
      }) as unknown as typeof fetch,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.usage.cachedTokens).toBe(2_400)
  })

  it('reports null, not zero, when the provider says nothing', async () => {
    // Zero is a real answer and a much worse one than "it did not tell us":
    // zero means every token was charged and counted against the rate limit.
    // The console draws them differently, so the driver must not conflate them.
    const r = await askIt(
      reply({ ...ok('hi'), usage: { prompt_tokens: 3_000, completion_tokens: 50 } }) as unknown as typeof fetch,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.usage.cachedTokens).toBeNull()
    expect(r.usage.promptTokens).toBe(3_000)
  })

  it('reports a real zero as zero', async () => {
    const r = await askIt(
      reply({
        ...ok('hi'),
        usage: { prompt_tokens: 3_000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } },
      }) as unknown as typeof fetch,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.usage.cachedTokens).toBe(0)
  })
})
