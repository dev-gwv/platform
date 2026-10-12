import { describe, expect, it } from 'vitest'
import { askRequest } from './assistant'
import { setHintRequest, userHints } from './auth'

describe('the assistant\'s language', () => {
  it('is English when a question comes without one, as an older tab would send it', () => {
    expect(askRequest.parse({ question: 'How do I add my team?' }).language).toBe('en')
    expect(askRequest.parse({ question: 'टीम कैसे जोड़ें?', language: 'hi' }).language).toBe('hi')
    expect(askRequest.safeParse({ question: 'q?q', language: 'fr' }).success).toBe(false)
  })

  it('is saved as itself, not as a blank note', () => {
    // hintNote fills defaults and drops unknown keys, so if it were tried first
    // { lang: 'hi' } would be saved as { shown: 0, closed: false } and the
    // studio would be asked their language again on every device.
    expect(setHintRequest.parse({ value: { lang: 'hi' } }).value).toEqual({ lang: 'hi' })
    expect(setHintRequest.parse({ value: { shown: 2, closed: true } }).value).toEqual({ shown: 2, closed: true })
    expect(setHintRequest.safeParse({ value: { lang: 'fr' } }).data?.value).not.toEqual({ lang: 'fr' })
  })

  it('reads back from the person\'s row', () => {
    expect(userHints.parse({ assistant_lang: { lang: 'hinglish' } }).assistant_lang).toEqual({ lang: 'hinglish' })
  })
})
