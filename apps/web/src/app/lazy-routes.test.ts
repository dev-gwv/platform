import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import router from './router.tsx?raw'

/**
 * CLAUDE.md, "Pages load when they are opened": every page in
 * `app/router.tsx` is `lazyRouteComponent(() => import('@/routes/x'), 'X')`,
 * never a static import, so the first load carries only the shell (1 MB, was
 * 3.3 MB). One static import of a route module pulls that page -- and
 * everything it imports -- back into the first load.
 */
const RULE = 'CLAUDE.md "Pages load when they are opened": a page joins app/router.tsx as lazyRouteComponent(() => import(\'@/routes/x\'), \'X\')'

const lines = router.split('\n')
const at = (i: number) => `app/router.tsx:${i + 1}`

/** `const X = lazyRouteComponent(() => import('@/routes/x'), 'X')` */
const LAZY = /^const (\w+) = lazyRouteComponent\(\(\) => import\('@\/routes\/([^']+)'\), '(\w+)'\)$/

describe('the router', () => {
  it('never statically imports a page', () => {
    const bad = lines.flatMap((l, i) =>
      /^\s*import\b/.test(l) && /from ['"](@\/routes\/|\.\.?\/(\.\.\/)*routes\/)/.test(l) ? [`${at(i)}: ${l.trim()}`] : [],
    )
    expect(bad, `${RULE} -- these import a page statically:\n${bad.join('\n')}`).toEqual([])
  })

  it('declares every lazy page in the one exact form, naming an export the file has', () => {
    const bad: string[] = []
    lines.forEach((l, i) => {
      if (!/lazyRouteComponent\(/.test(l) || /^\s*(import|lazyRouteComponent,)/.test(l)) return
      const m = l.trim().match(LAZY)
      if (!m) return void bad.push(`${at(i)}: not in the form const X = lazyRouteComponent(() => import('@/routes/x'), 'X'): ${l.trim()}`)
      const [, , mod, name] = m
      const base = resolve(import.meta.dirname, '..', 'routes', mod!)
      const file = ['.tsx', '.ts'].map((e) => base + e).find(existsSync)
      if (!file) return void bad.push(`${at(i)}: no file for '@/routes/${mod}'`)
      if (!new RegExp(`export (function|const|class) ${name}\\b`).test(readFileSync(file, 'utf8')))
        bad.push(`${at(i)}: '@/routes/${mod}' has no export named ${name}`)
    })
    expect(bad, `${RULE}\n${bad.join('\n')}`).toEqual([])
  })

  it('mounts only lazy pages (or the few small helpers defined in the router itself)', () => {
    const lazy = new Set(lines.map((l) => l.trim().match(LAZY)?.[1]).filter(Boolean))
    // Layouts, redirects and the 404, written in router.tsx: no page module behind them.
    const local = new Set([...router.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]))
    const builtIn = new Set(['Outlet'])
    const bad: string[] = []
    lines.forEach((l, i) => {
      for (const m of l.matchAll(/(?:\b(?:route|publicRoute)\('[^']*',\s*|^\s*component: )([A-Z]\w*)\b/g)) {
        const name = m[1]!
        if (!lazy.has(name) && !local.has(name) && !builtIn.has(name)) bad.push(`${at(i)}: ${name} is not a lazyRouteComponent page`)
      }
    })
    expect(bad, `${RULE}\n${bad.join('\n')}`).toEqual([])
  })
})
