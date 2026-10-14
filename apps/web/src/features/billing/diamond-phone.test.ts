import { describe, expect, it } from 'vitest'
import { diamondOutcomeWords } from './diamond-phone'

describe('the IPC Diamond number check', () => {
  it('says a match plainly', () => {
    expect(diamondOutcomeWords('verified')).toMatchObject({ ok: true })
    expect(diamondOutcomeWords('already').line).toMatch(/30 days/)
  })
  it('sends every miss to WhatsApp, never blames the person', () => {
    for (const o of ['not_found', 'taken', 'too_many'] as const) {
      const w = diamondOutcomeWords(o)
      expect(w.ok).toBe(false)
      expect(w.line).toMatch(/message us/i)
    }
  })
})
