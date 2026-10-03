import { describe, expect, it } from 'vitest'
import { showGettingStarted, startCountLine, startSteps } from './getting-started'

const base = {
  started_at: '2026-10-01T00:00:00Z',
  setup_closed: true,
  logo: false,
  package: false,
  enquiry: false,
  booking: false,
  quotation: false,
}
const now = new Date('2026-10-10T00:00:00Z')

describe('getting started', () => {
  it('shows after setup, for 60 days, until all five are done', () => {
    expect(showGettingStarted(base, false, now)).toBe(true)
    expect(showGettingStarted({ ...base, setup_closed: false }, false, now)).toBe(false)
    expect(showGettingStarted(base, true, now)).toBe(false)
    expect(showGettingStarted(base, false, new Date('2026-12-15T00:00:00Z'))).toBe(false)
    const all = { ...base, logo: true, package: true, enquiry: true, booking: true, quotation: true }
    expect(showGettingStarted(all, false, now)).toBe(false)
    expect(showGettingStarted(undefined, false, now)).toBe(false)
  })

  it('counts what is done', () => {
    expect(startCountLine(startSteps({ ...base, logo: true, enquiry: true }))).toBe('2 of 5 done')
  })
})
