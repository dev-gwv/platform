import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CLAUDE.md "Big files are split by route group": the projects, crm, billing
 * and team API modules are a `router.ts` that mounts `routes-*.ts` groups, and
 * a new route joins its group's file; keep each file under ~600 lines.
 *
 * A file already past 600 is listed here with its size when this guard was
 * written. It may shrink (lower the number, or drop the line once it is under
 * 600) but not grow; split a group out instead. A file listed here that has
 * gone, or fallen under 600, passes.
 */
const MODULES = ['projects', 'crm', 'billing', 'team', 'tasks']
const LIMIT = 600
const OVER: Record<string, number> = {
  // Pipelines, stages and custom fields in one Hono chain (22 Nov 2026).
  'crm/objects.ts': 676,
}

describe('API route modules', () => {
  it(`stay under ${LIMIT} lines, or no bigger than their recorded size`, () => {
    const bad: string[] = []
    for (const m of MODULES) {
      const dir = join(import.meta.dirname, m)
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir)) {
        if (!/\.ts$/.test(f) || /\.test\.ts$/.test(f)) continue
        const rel = `${m}/${f}`
        const n = readFileSync(join(dir, f), 'utf8').trimEnd().split('\n').length
        const cap = Math.max(LIMIT, OVER[rel] ?? 0)
        if (n > cap)
          bad.push(
            `services/api/src/modules/${rel}:${cap + 1}: ${n} lines, over ${cap}` +
              (OVER[rel] ? ' (its recorded size) -- it may shrink, never grow' : ''),
          )
      }
    }
    expect(
      bad,
      `CLAUDE.md "Big files are split by route group" -- keep each file under ~${LIMIT} lines: move a group of routes into routes-<group>.ts ` +
        `and mount it from router.ts with .route('/', group) (literal paths before /:id):\n${bad.join('\n')}`,
    ).toEqual([])
  })
})
