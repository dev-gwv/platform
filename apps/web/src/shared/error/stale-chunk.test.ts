import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { STALE_CHUNK, shapeEvent } from './sentry'

describe('STALE_CHUNK', () => {
  it('matches what each browser says when a deploy removed a page file', () => {
    for (const m of [
      'TypeError: Failed to fetch dynamically imported module: https://studioautopilot.in/assets/follow-ups-Ia-SCERZ.js',
      'TypeError: Importing a module script failed.',
      'TypeError: error loading dynamically imported module: https://studioautopilot.in/assets/x.js',
      'Error: Unable to preload CSS for /assets/index-hUa24wpy.css',
      "TypeError: 'text/html' is not a valid JavaScript MIME type.",
      "TypeError: Cannot read properties of undefined (reading 'ProjectQuotationPage')",
      'TypeError: can\'t access property "EmployeesPage", m is undefined',
      "TypeError: undefined is not an object (evaluating 'm.HelpPage')",
    ])
      expect(STALE_CHUNK.test(m)).toBe(true)
  })

  it('leaves real faults alone', () => {
    for (const m of ['TypeError: Failed to fetch', "TypeError: Cannot read properties of undefined (reading 'id')"])
      expect(STALE_CHUNK.test(m)).toBe(false)
  })
})

describe('shapeEvent', () => {
  const ev = (value: string) => ({ type: undefined, exception: { values: [{ type: 'Error', value }] } }) as Parameters<typeof shapeEvent>[0]

  it("drops the API's own answers: a refusal, a plan limit, a lost connection", () => {
    for (const status of [0, 401, 402, 403, 404, 409, 422, 429])
      expect(shapeEvent(ev('x'), { originalException: new ApiError(status, 'no') })).toBeNull()
  })

  it('folds a deploy restart into one warning and keeps real faults as they are', () => {
    const outage = shapeEvent(ev('HTTP Client Error with status code: 503'), {})
    expect(outage?.fingerprint).toEqual(['api-unreachable'])
    expect(outage?.level).toBe('warning')
    expect(shapeEvent(ev('x'), { originalException: new ApiError(502, 'down') })?.fingerprint).toEqual(['api-unreachable'])

    const fault = shapeEvent(ev("Cannot read properties of undefined (reading 'id')"), { originalException: new TypeError('x') })
    expect(fault?.fingerprint).toBeUndefined()
    expect(shapeEvent(ev('HTTP Client Error with status code: 500'), {})?.fingerprint).toBeUndefined()
  })
})
