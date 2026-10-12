import { describe, expect, it, vi } from 'vitest'
import type { ChatProvider, ChatReply, ChatRequest } from './ai'
import { BOOK_A_CALL, CARRIED_TURNS, DEFAULT_PROMPT, ask, needsHuman } from './assistant'
import { composeHelpContext } from './help-context'

/**
 * The help assistant (0247). The provider is a stand-in in every test, so the
 * rules are checked and no question is ever sent anywhere.
 */

const HELP = composeHelpContext('How do I add my team?', [
  { question: 'Can I change a quotation after sending it?', answer: 'Yes. Edit it and send the link again.' },
])

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
  usage: { promptTokens: 1300, completionTokens: 40, cachedTokens: 1100 },
  truncated: false,
})

const toolCall = (reason: string): ChatReply => ({
  ok: true,
  text: '',
  calls: [{ id: 'c1', name: BOOK_A_CALL.name, args: { reason } }],
  model: 'stub-1',
  usage: { promptTokens: 1300, completionTokens: 12, cachedTokens: 1100 },
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

  it('still answers a question that was asked before', () => {
    // This used to escalate, and it was the single worst thing the assistant
    // did: "How do I add my team?" is the first suggested question AND an
    // article, and asking it twice was met with "I have already given you my
    // best answer on this". Since the thread survives navigation now, a repeat
    // is ordinary rather than rare.
    const history = [
      { role: 'user' as const, content: 'How do I add my team?' },
      { role: 'assistant' as const, content: 'Open Team then People.' },
    ]
    expect(needsHuman('How do I add my team?', history)).toBeNull()
    expect(needsHuman('how do i add my team', history)).toBeNull()
  })

  it('keeps escalating a money question however often it is asked', () => {
    const history = [{ role: 'user' as const, content: 'I want a refund' }]
    expect(needsHuman('I want a refund', history)).toBeTruthy()
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
    expect(p.seen[0]!.system).toContain('Adding your team')
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
      usage: { promptTokens: 1300, completionTokens: 800, cachedTokens: 1100 },
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

  it('carries only the last two exchanges, whatever the tab sent', async () => {
    // History sits after the help and is never cached, so every turn of it is
    // paid in full against the per-minute budget.
    const p = stub(answered('ok'))
    const turns = Array.from({ length: 6 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i}`,
    }))
    await ask({ provider: p, help: HELP, question: 'and then?', history: turns })
    const req = (p.chat as unknown as { mock: { calls: [{ messages: { content: string }[] }][] } }).mock.calls[0]![0]
    expect(req.messages).toHaveLength(1 + CARRIED_TURNS + 1)
    expect(req.messages.map((m) => m.content)).toContain('turn 5')
    expect(req.messages.map((m) => m.content)).not.toContain('turn 1')
  })
})

describe('answering in the language the studio picked', () => {
  it('tells the model the language last, after the help', async () => {
    const p = stub(answered('ok'))
    await ask({ provider: p, help: HELP, question: 'टीम कैसे जोड़ें?', language: 'hi' })
    const system = p.seen[0]!.system
    expect(system).toMatch(/LANGUAGE: Answer in Hindi, written in Devanagari script/)
    expect(system.trimEnd().endsWith(system.slice(system.indexOf('LANGUAGE:')).trimEnd())).toBe(true)
    expect(system.indexOf('LANGUAGE:')).toBeGreaterThan(system.indexOf(HELP.selected))
  })

  it('keeps the cached part of the prompt the same in every language', async () => {
    // The provider caches an identical prefix. If the language crept into it,
    // each language would be its own prefix and pay full price again.
    const seen: string[] = []
    for (const language of ['en', 'hi', 'hinglish'] as const) {
      const p = stub(answered('ok'))
      await ask({ provider: p, help: HELP, question: 'q', language })
      seen.push(p.seen[0]!.system)
    }
    const prefix = (s: string) => s.slice(0, s.indexOf(HELP.selected))
    expect(new Set(seen.map(prefix)).size).toBe(1)
  })

  it('asks for Hinglish in English letters, never Devanagari', async () => {
    const p = stub(answered('ok'))
    await ask({ provider: p, help: HELP, question: 'team kaise jodu', language: 'hinglish' })
    expect(p.seen[0]!.system).toContain('Never use Devanagari')
  })

  it('answers in English when no language is given, as an older tab would send', async () => {
    const p = stub(answered('ok'))
    await ask({ provider: p, help: HELP, question: 'q' })
    expect(p.seen[0]!.system).toContain('LANGUAGE: Answer in English')
  })

  it('writes its own sentences in the picked language too', async () => {
    const skipped = await ask({
      provider: stub({ ok: false, kind: 'no_key', error: 'no key' }),
      help: HELP,
      question: 'q',
      language: 'hi',
    })
    expect(skipped.answer).toBe('असिस्टेंट अभी चालू नहीं है।')

    const failed = await ask({
      provider: stub({ ok: false, kind: 'refused', error: 'x' }),
      help: HELP,
      question: 'q',
      callUrl: CALL,
      language: 'hinglish',
    })
    expect(failed.answer).toBe('Abhi jawab nahi mil saka. Aap iski jagah call book kar sakte hain.')

    const empty = await ask({ provider: stub(answered('')), help: HELP, question: 'q', callUrl: CALL, language: 'hi' })
    expect(empty.answer).toBe('हेल्प में इसका जवाब नहीं है। कॉल बुक करें, हम साथ में देख लेंगे।')
  })

  it('hands money questions to a person in Hindi and Hinglish as well', async () => {
    for (const q of ['मुझे रिफंड चाहिए', 'मेरे पैसे वापस करो', 'paise wapas chahiye', 'mera plan cancel karna hai', 'प्लान कैंसिल करना है']) {
      expect(needsHuman(q), q).toBeTruthy()
    }
    for (const q of ['मेरा सारा डेटा गायब हो गया', 'meri leads gayab ho gayi', 'हमारा अकाउंट हैक हो गया']) {
      expect(needsHuman(q), q).toBeTruthy()
    }
    const p = stub(answered('आपका पैसा 5-7 दिन में आ जाएगा।'))
    const r = await ask({ provider: p, help: HELP, question: 'मुझे रिफंड चाहिए', callUrl: CALL, language: 'hi' })
    expect(r.status).toBe('escalated')
    expect(p.chat).not.toHaveBeenCalled()
    expect(r.answer).toBe('यह हमारे लिए गए पैसों के बारे में है, इसलिए कोई व्यक्ति इसे आपके साथ देखेगा। अपनी सुविधा का समय बुक करें।')
  })

  it('ends the model\'s reason as a sentence before adding ours', async () => {
    // Seen live: a Hindi reason with no full stop ran straight into our line.
    const hi = await ask({
      provider: stub(toolCall('हेल्प में इसकी जानकारी नहीं है')),
      help: HELP,
      question: 'q',
      callUrl: CALL,
      language: 'hi',
    })
    expect(hi.answer).toBe('हेल्प में इसकी जानकारी नहीं है। अपनी सुविधा का समय बुक करें।')
    const en = await ask({ provider: stub(toolCall('The help does not cover that.')), help: HELP, question: 'q', callUrl: CALL })
    expect(en.answer).toBe('The help does not cover that. Book a time that suits you.')
  })

  it('answers "how do I delete…" in Hindi rather than calling it lost data', () => {
    // Hindi puts the verb last, so "lead delete how" looked like "leads deleted"
    // and an ordinary help question was handed to a person.
    for (const q of ['लीड डिलीट कैसे करें?', 'प्रोजेक्ट डिलीट कैसे करें', 'क्लाइंट डिलीट करना है', 'lead delete kaise kare']) {
      expect(needsHuman(q), q).toBeNull()
    }
    for (const q of ['मेरी लीड डिलीट हो गई', 'मेरा डेटा खो गया', 'क्लाइंट गायब हो गए', 'सारे प्रोजेक्ट उड़ गए']) {
      expect(needsHuman(q), q).toBeTruthy()
    }
  })

  it('leaves the studio\'s own billing alone in Hindi too', () => {
    expect(needsHuman('क्लाइंट का पेमेंट कैसे रिकॉर्ड करें')).toBeNull()
    expect(needsHuman('इनवॉइस कैसे भेजें')).toBeNull()
    expect(needsHuman('client ka payment kaise record karu')).toBeNull()
  })
})
