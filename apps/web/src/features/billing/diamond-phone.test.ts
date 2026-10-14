import { describe, expect, it } from 'vitest'
import { diamondOutcomeWords } from './diamond-phone'

describe('the IPC Diamond number check', () => {
  it('says a match plainly, with the 30 days', () => {
    expect(diamondOutcomeWords('verified')).toMatchObject({ ok: true })
    expect(diamondOutcomeWords('already').line).toMatch(/30 days/)
  })
  it('never lets a miss through, and never blames the person', () => {
    for (const o of ['not_found', 'taken', 'too_many'] as const) {
      const w = diamondOutcomeWords(o)
      expect(w.ok).toBe(false)
      expect(w.line).not.toMatch(/whatsapp|message us/i)
    }
    expect(diamondOutcomeWords('not_found').line).toMatch(/regular plan/)
  })
})
