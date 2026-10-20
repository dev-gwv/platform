import { describe, expect, it } from 'vitest'
import { isNewer, mainScriptOf } from './update'

describe('new release check', () => {
  it('reads the main script from the live page', () => {
    const html = '<script type="module" crossorigin src="/assets/index-XZSFM8hr.js"></script>'
    expect(mainScriptOf(html)).toBe('/assets/index-XZSFM8hr.js')
    expect(mainScriptOf('<html></html>')).toBeNull()
  })

  it('calls it newer only when both are known and differ', () => {
    expect(isNewer('/assets/index-a.js', '/assets/index-b.js')).toBe(true)
    expect(isNewer('/assets/index-a.js', '/assets/index-a.js')).toBe(false)
    expect(isNewer(null, '/assets/index-b.js')).toBe(false)
    expect(isNewer('/assets/index-a.js', null)).toBe(false)
  })
})
