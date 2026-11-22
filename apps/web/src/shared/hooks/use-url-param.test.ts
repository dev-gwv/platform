import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextSearch, readParam } from './use-url-param'

/**
 * CLAUDE.md "Page state in the address follows the router": useUrlParam reads
 * useRouterState and writes with navigate({ to: '.', replace: true }); never
 * window.history.replaceState (or pushState), which the router never hears of,
 * so a later link to the same page with another ?tab= could not move it.
 */
describe('the address', () => {
  it('is only ever changed through the router', () => {
    const root = resolve(import.meta.dirname, '..', '..')
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
      })
    const bad = walk(root).flatMap((p) => {
      const rel = relative(root, p).split(sep).join('/')
      return readFileSync(p, 'utf8')
        .split('\n')
        .flatMap((l, i) => (/\bhistory\.(replaceState|pushState)\s*\(/.test(l) ? [`apps/web/src/${rel}:${i + 1}: ${l.trim()}`] : []))
    })
    expect(
      bad,
      `CLAUDE.md "Page state in the address follows the router" -- use useUrlParam, or useNavigate()'s navigate({ to: '.', search, replace: true }) / navigate({ href, replace: true }):\n${bad.join('\n')}`,
    ).toEqual([])
  })
})

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
