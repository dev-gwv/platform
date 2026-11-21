import { describe, expect, it } from 'vitest'
import { EMAIL_CAP_PAID, EMAIL_CAP_TRIAL, emailCapFor, emailCapMessage, overEmailCap } from './email-cap'

describe('studio email ceiling', () => {
  it('gives a paying studio more room than a trial', () => {
    expect(emailCapFor(true)).toBe(EMAIL_CAP_PAID)
    expect(emailCapFor(false)).toBe(EMAIL_CAP_TRIAL)
    expect(EMAIL_CAP_PAID).toBeGreaterThan(EMAIL_CAP_TRIAL)
  })

  it('refuses the send that would pass the ceiling, not the one before', () => {
    expect(overEmailCap(EMAIL_CAP_TRIAL - 1, false)).toBe(false)
    expect(overEmailCap(EMAIL_CAP_TRIAL, false)).toBe(true)
    expect(overEmailCap(EMAIL_CAP_TRIAL, true)).toBe(false)
    expect(overEmailCap(EMAIL_CAP_PAID, true)).toBe(true)
  })

  it('says what to do instead in plain words', () => {
    expect(emailCapMessage(30)).toMatch(/30 emails/)
    expect(emailCapMessage(30)).toMatch(/WhatsApp/)
  })
})
