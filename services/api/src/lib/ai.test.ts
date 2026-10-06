import { describe, expect, it, vi } from 'vitest'
import { ASSISTANT_DEFAULT_MODEL } from '@ipc/contracts'
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
    expect(r.usage).toEqual({ promptTokens: 1200, completionTokens: 60 })
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
    expect(r.usage).toEqual({ promptTokens: null, completionTokens: null })
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
