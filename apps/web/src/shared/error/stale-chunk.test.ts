import { describe, expect, it } from 'vitest'
import { STALE_CHUNK } from './sentry'

describe('STALE_CHUNK', () => {
  it('matches what each browser says when a deploy removed a page file', () => {
    for (const m of [
      'TypeError: Failed to fetch dynamically imported module: https://studioautopilot.in/assets/follow-ups-Ia-SCERZ.js',
      'TypeError: Importing a module script failed.',
      'TypeError: error loading dynamically imported module: https://studioautopilot.in/assets/x.js',
      'Error: Unable to preload CSS for /assets/index-hUa24wpy.css',
      "TypeError: 'text/html' is not a valid JavaScript MIME type.",
    ])
      expect(STALE_CHUNK.test(m)).toBe(true)
  })

  it('leaves real faults alone', () => {
    for (const m of ['TypeError: Failed to fetch', "TypeError: Cannot read properties of undefined (reading 'id')"])
      expect(STALE_CHUNK.test(m)).toBe(false)
  })
})
