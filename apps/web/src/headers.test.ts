import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The live site's headers (public/_headers) must let the app do what it was
 * built to do. Twice now a feature worked everywhere but live because this
 * file forbade it: `microphone=()` blocked voice notes before the browser
 * could even ask.
 */
const headers = readFileSync(join(__dirname, '..', 'public', '_headers'), 'utf8')
const line = (name: string) => headers.split('\n').find((l) => l.trim().toLowerCase().startsWith(`${name.toLowerCase()}:`)) ?? ''

describe('live site headers', () => {
  it('let this site use the microphone and share the screen', () => {
    const policy = line('Permissions-Policy')
    expect(policy).toMatch(/microphone=\(self\)/)
    expect(policy).toMatch(/display-capture=\(self\)/)
    expect(policy).toMatch(/camera=\(\)/)
  })

  it('let voice notes play and the error monitor record', () => {
    const csp = line('Content-Security-Policy')
    expect(csp).toMatch(/media-src [^;]*blob:/)
    expect(csp).toMatch(/worker-src [^;]*blob:/)
    expect(csp).toMatch(/img-src [^;]*blob:/)
  })
})
