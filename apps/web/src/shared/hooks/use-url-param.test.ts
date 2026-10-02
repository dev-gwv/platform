import { describe, expect, it } from 'vitest'
import { nextSearch, readParam } from './use-url-param'

describe('readParam', () => {
  it('reads the raw string, whatever the router parsed', () => {
    expect(readParam('?tab=billing&page=2', 'page')).toBe('2')
    expect(readParam('?tab=billing', 'q', 'all')).toBe('all')
  })
})

describe('nextSearch', () => {
  it('sets a value and keeps the rest', () => {
    expect(nextSearch({ q: 'x' }, 'tab', 'billing')).toEqual({ q: 'x', tab: 'billing' })
  })
  it('leaves the default out of the address', () => {
    expect(nextSearch({ q: 'x', tab: 'billing' }, 'tab', 'overview', 'overview')).toEqual({ q: 'x' })
    expect(nextSearch({ tab: 'billing' }, 'tab', '')).toEqual({})
  })
})
