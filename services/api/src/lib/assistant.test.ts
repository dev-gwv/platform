import { describe, expect, it, vi } from 'vitest'
import type { ChatProvider, ChatReply, ChatRequest } from './ai'
import { BOOK_A_CALL, DEFAULT_PROMPT, ask, needsHuman } from './assistant'
import { composeHelpContext } from './help-context'

/**
 * The help assistant (0247). The provider is a stand-in in every test, so the
 * rules are checked and no question is ever sent anywhere.
 */

const HELP = composeHelpContext([{ question: 'Can I change a quotation after sending it?', answer: 'Yes. Edit it and send the link again.' }])

const CALL = 'https://cal.example.test/studio-autopilot'

/** A provider that answers whatever it is told to, and records what it was asked. */
function stub(reply: ChatReply): ChatProvider & { seen: { system: string; last: string }[] } {
  const seen: { system: string; last: string }[] = []
  return {
    id: 'stub',
    model: 'stub-1',
    seen,
    chat: vi.fn(async (req: ChatRequest) => {
      seen.push({
        system: req.messages.find((m) => m.role === 'system')?.content ?? '',
        last: req.messages[req.messages.length - 1]?.content ?? '',
      })
      return reply
    }),
  }
}

const answered = (text: string): ChatReply => ({
  ok: true,
  text,
  calls: [],
  model: 'stub-1',
  usage: { promptTokens: 1300, completionTokens: 40 },
  truncated: false,
})

const toolCall = (reason: string): ChatReply => ({
  ok: true,
  text: '',
  calls: [{ id: 'c1', name: BOOK_A_CALL.name, args: { reason } }],
  model: 'stub-1',
  usage: { promptTokens: 1300, completionTokens: 12 },
  truncated: false,
})

describe('needsHuman', () => {
  it('sends anything about our charges to a person', () => {
    // A model asked about a refund writes a confident, plausible paragraph it
    // has no basis for. Someone's money is the worst thing to be fluent about.
    expect(needsHuman('I want a refund')).toBeTruthy()
    expect(needsHuman('you charged me twice this month')).toBeTruthy()
    expect(needsHuman('I was double charged')).toBeTruthy()
    expect(needsHuman('how do I cancel my subscription?')).toBeTruthy()
    expect(needsHuman('all my leads are gone')).toBeTruthy()
  })

  it('leaves the studio\'s own billing of its clients to the assistant', () => {
    // The whole app is invoices and payments. If these escalated, the assistant
    // would hand off most of what it exists to answer.
    expect(needsHuman('how do I send an invoice to a client?')).toBeNull()
    expect(needsHuman('where do I record a payment I received?')).toBeNull()
    expect(needsHuman('can I add GST to a quotation?')).toBeNull()
    expect(needsHuman('how do I refund a client in the app?')).toBeTruthy() // 'refund' is ours; accepted
    expect(needsHuman('how do I cancel a shoot day?')).toBeNull()
    expect(needsHuman('my client has not paid the advance')).toBeNull()
  })

  it('stops after the same question twice', () => {
    const history = [
      { role: 'user' as const, content: 'How do I assign a team to a shoot?' },
      { role: 'assistant' as const, content: 'Open the Shoots tab…' },
    ]
    expect(needsHuman('How do I assign a team to a shoot?', history)).toBeTruthy()
    // Punctuation and case are not a different question.
    expect(needsHuman('how do i assign a team to a shoot', history)).toBeTruthy()
    expect(needsHuman('How do I add an expense?', history)).toBeNull()
  })

  it('does not call a repeated "hi" a dead end', () => {
    const history = [{ role: 'user' as const, content: 'hello' }]
    expect(needsHuman('hello', history)).toBeNull()
  })
})

describe('ask', () => {
  it('answers from the help content', async () => {
    const p = stub(answered('Open Team then People, and press Add Team Member.'))
    const r = await ask({ provider: p, help: HELP, question: 'How do I add my team?', callUrl: CALL })
    expect(r.status).toBe('answered')
    expect(r.answer).toContain('Add Team Member')
    // Nothing to escalate to: an answered question must not also dangle a call
    // link, or every answer reads as "and here is who to ring instead".
    expect(r.callUrl).toBeNull()
    expect(r.promptTokens).toBe(1300)
    expect(r.model).toBe('stub-1')
  })

  it('puts the help content and the prompt in the system message, and the question last', async () => {
    const p = stub(answered('ok'))
    await ask({ provider: p, help: HELP, question: 'How do I add my team?' })
    expect(p.seen[0]!.system).toContain(DEFAULT_PROMPT.slice(0, 40))
    expect(p.seen[0]!.system).toContain('Add your team')
    expect(p.seen[0]!.system).toContain('Can I change a quotation after sending it?')
    expect(p.seen[0]!.last).toBe('How do I add my team?')
  })

  it('uses the platform\'s prompt when there is one', async () => {
    const p = stub(answered('ok'))
    await ask({ provider: p, help: HELP, question: 'q', prompt: 'Answer only in haiku.' })
    expect(p.seen[0]!.system).toContain('Answer only in haiku.')
    expect(p.seen[0]!.system).not.toContain(DEFAULT_PROMPT.slice(0, 40))
  })

  it('falls back to the built-in prompt when the platform\'s is blank', async () => {
    const p = stub(answered('ok'))
    await ask({ provider: p, help: HELP, question: 'q', prompt: '   ' })
    expect(p.seen[0]!.system).toContain(DEFAULT_PROMPT.slice(0, 40))
  })

  it('escalates without asking the model when the question is ours to answer', async () => {
    const p = stub(answered('You will get your money back within 5-7 days.'))
    const r = await ask({ provider: p, help: HELP, question: 'I want a refund please', callUrl: CALL })
    expect(r.status).toBe('escalated')
    expect(r.callUrl).toBe(CALL)
    // The model is never given the chance to invent a refund policy.
    expect(p.chat).not.toHaveBeenCalled()
    expect(r.answer).not.toContain('5-7 days')
  })

  it('escalates when the model asks for a call, in its words', async () => {
    const r = await ask({
      provider: stub(toolCall('This needs someone to look at your account.')),
      help: HELP,
      question: 'why is my dashboard empty',
      callUrl: CALL,
    })
    expect(r.status).toBe('escalated')
    expect(r.answer).toContain('look at your account')
    expect(r.answer).toContain('Book a time')
    expect(r.callUrl).toBe(CALL)
  })

  it('still escalates usefully when nobody has set a call link', async () => {
    const r = await ask({ provider: stub(toolCall('Needs a person.')), help: HELP, question: 'q' })
    expect(r.status).toBe('escalated')
    expect(r.callUrl).toBeNull()
    // No dead "book a call" that goes nowhere.
    expect(r.answer).not.toContain('Book a time')
    expect(r.answer).toContain('write to us')
  })

  it('treats an empty answer as no answer', async () => {
    // An empty bubble reads as a broken app, and counting it as 'answered'
    // would hide the problem in the log behind a healthy-looking status.
    const r = await ask({ provider: stub(answered('')), help: HELP, question: 'q', callUrl: CALL })
    expect(r.status).toBe('escalated')
    expect(r.answer).toContain('do not have an answer')
  })

  it('marks a cut-off answer rather than ending mid-sentence', async () => {
    const p = stub({
      ok: true,
      text: 'Open the Shoots tab and',
      calls: [],
      model: 'stub-1',
      usage: { promptTokens: 1300, completionTokens: 800 },
      truncated: true,
    })
    const r = await ask({ provider: p, help: HELP, question: 'q' })
    expect(r.answer).toBe('Open the Shoots tab and…')
  })

  it('reports a missing key as skipped, not as a failure', async () => {
    // 'skipped' is our configuration gap, and logging it as 'failed' would make
    // an unconfigured server look like a broken provider.
    const r = await ask({
      provider: stub({ ok: false, kind: 'no_key', error: 'no key' }),
      help: HELP,
      question: 'q',
      callUrl: CALL,
    })
    expect(r.status).toBe('skipped')
    expect(r.answer).toBe('The assistant is not switched on yet.')
    // No call offered: the studio did nothing wrong and there is nothing to
    // discuss on a call about our own missing key.
    expect(r.callUrl).toBeNull()
    expect(r.error).toBe('no key')
  })

  it('offers the call when the provider refuses, and keeps the reason out of sight', async () => {
    const r = await ask({
      provider: stub({ ok: false, kind: 'refused', error: 'the AI provider did not accept the key (Invalid API Key).' }),
      help: HELP,
      question: 'q',
      callUrl: CALL,
    })
    expect(r.status).toBe('failed')
    expect(r.callUrl).toBe(CALL)
    expect(r.answer).not.toContain('API Key')
    // …but it is kept for the log, which is where it is useful.
    expect(r.error).toContain('Invalid API Key')
  })

  it('offers the tool on every question it does send', async () => {
    const p = stub(answered('ok'))
    await ask({ provider: p, help: HELP, question: 'q' })
    const req = (p.chat as unknown as { mock: { calls: [{ tools?: unknown[] }][] } }).mock.calls[0]![0]
    expect(req.tools).toHaveLength(1)
  })

  it('points at the chapter it named, and invents no others', async () => {
    const r = await ask({ provider: stub(answered('See Add your team for the steps.')), help: HELP, question: 'q' })
    expect(r.sources.map((s) => s.title)).toEqual(['Add your team'])
    expect(r.sources[0]!.to).toBe('/employees')
  })

  it('offers no link when the answer named no chapter', async () => {
    const r = await ask({ provider: stub(answered('Press the green button.')), help: HELP, question: 'q' })
    expect(r.sources).toEqual([])
  })

  it('carries the conversation so far', async () => {
    const p = stub(answered('On mobile, the same menu is behind the ☰ button.'))
    await ask({
      provider: p,
      help: HELP,
      question: 'and on mobile?',
      history: [
        { role: 'user', content: 'How do I add my team?' },
        { role: 'assistant', content: 'Open Team then People.' },
      ],
    })
    const req = (p.chat as unknown as { mock: { calls: [{ messages: { role: string }[] }][] } }).mock.calls[0]![0]
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })
})
