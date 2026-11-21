import { describe, expect, it } from 'vitest'
import { safeRedirect } from './safe-redirect'

const ORIGIN = 'https://studioautopilot.in'

describe('safeRedirect', () => {
  it('keeps a page of this site with its query and hash', () => {
    expect(safeRedirect('/leads?x=1', ORIGIN)).toBe('/leads?x=1')
    expect(safeRedirect('/my-work?d=abc#notes', ORIGIN)).toBe('/my-work?d=abc#notes')
  })

  it('refuses anything that leaves the site', () => {
    expect(safeRedirect('//evil.com', ORIGIN)).toBeNull()
    expect(safeRedirect('/\\evil.com', ORIGIN)).toBeNull()
    expect(safeRedirect('https://evil.com', ORIGIN)).toBeNull()
    expect(safeRedirect('/\t/evil.com', ORIGIN)).toBeNull()
    expect(safeRedirect('javascript:alert(1)', ORIGIN)).toBeNull()
  })

  it('refuses nothing at all', () => {
    expect(safeRedirect('', ORIGIN)).toBeNull()
    expect(safeRedirect(null, ORIGIN)).toBeNull()
  })
})
