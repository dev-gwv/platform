import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Two files whose names differ only in case and extension
 * (`Teleprompter.tsx` beside `teleprompter.ts`) are two files on Linux and
 * one on Windows and a Mac: there the import `@/features/ai/Teleprompter`
 * found the `.ts` first, Ad scripts crashed and `tsc` failed on the owner's
 * PC while CI passed (audit, 17 Nov). Give the helper file another name.
 */
describe('source file names', () => {
  it('never differ only in case or extension within a folder', () => {
    const root = resolve(import.meta.dirname, '..')
    const clashes: string[] = []
    const walk = (dir: string) => {
      const seen = new Map<string, string>()
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        const m = name.match(/^(.*?)(\.test)?\.(tsx?|jsx?)$/)
        if (!m) continue
        const key = `${m[1]!.toLowerCase()}${m[2] ?? ''}`
        const other = seen.get(key)
        if (other) clashes.push(`${join(dir, other)} <-> ${name}`)
        seen.set(key, name)
      }
    }
    walk(root)
    expect(clashes).toEqual([])
  })
})
