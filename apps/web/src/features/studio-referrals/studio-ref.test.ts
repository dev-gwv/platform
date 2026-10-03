import { beforeEach, describe, expect, it } from 'vitest'
import { captureStudioRef, parseStudioRef, readStudioRef, shareText } from './studio-ref'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  }
})

describe('studio ref', () => {
  it('takes only a plain code from the address', () => {
    expect(parseStudioRef('?studio_ref=ab12cd34')).toBe('AB12CD34')
    expect(parseStudioRef('?studio_ref=x')).toBeNull()
    expect(parseStudioRef('?studio_ref=<script>')).toBeNull()
    expect(parseStudioRef('')).toBeNull()
  })

  it('remembers a code for 60 days', () => {
    const t = Date.UTC(2026, 9, 2)
    captureStudioRef('?studio_ref=AB12CD34', t)
    expect(readStudioRef(t + 59 * 86_400_000, '')).toBe('AB12CD34')
    expect(readStudioRef(t + 61 * 86_400_000, '')).toBeNull()
  })

  it('prefers the code in the address over the remembered one', () => {
    captureStudioRef('?studio_ref=AB12CD34', 0)
    expect(readStudioRef(1, '?studio_ref=ZZ99YY88')).toBe('ZZ99YY88')
  })

  it('writes a share message with the link', () => {
    expect(shareText('Asha Studio', 'https://studioautopilot.in/?studio_ref=AB12CD34')).toContain('?studio_ref=AB12CD34')
  })
})
