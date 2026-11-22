import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CLAUDE.md "Dates on screen are India dates": todayInIndia()
 * (shared/ui/days-left.ts; services/api/src/lib/dates.ts on the server), never
 * `new Date().toISOString().slice(0, 10)`, which is still yesterday until
 * 5:30 am IST. The same goes for `.slice(0, 7)` (this month is last month on
 * the 1st until 5:30 am) and `.split('T')[0]`, and for a hand-rolled
 * `new Date(Date.now() + 5.5 * 3_600_000)` copy of the helper.
 *
 * Calendar arithmetic on a date that is already a date
 * (`new Date(`${iso}T00:00:00Z`)` … `.toISOString().slice(0, 10)`) is fine and
 * is not matched: only a fresh "now" is.
 *
 * A use that genuinely wants the UTC day (a log key, a file stamp nobody
 * reads as a date) carries `// utc-ok: <reason>` on its line or the line
 * above. Tests are not scanned.
 */
const REPO = resolve(import.meta.dirname, '..', '..', '..', '..', '..')
const ROOTS = ['apps/web/src', 'services/api/src']
const HELPERS = new Set(['apps/web/src/shared/ui/days-left.ts', 'services/api/src/lib/dates.ts'])

/** A fresh Date of "now" (optionally shifted from Date.now()), cut to a day or a month. */
const NOW = String.raw`new Date\((?:Date\.now\(\)[^()]*)?\)\s*\.toISOString\(\)\s*`
const UTC_DAY = new RegExp(`${NOW}(?:\\.(?:slice|substring|substr)\\(0,\\s*(?:7|10)\\)|\\.split\\(['"]T['"]\\))`)

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })

describe('dates on screen', () => {
  it('are India dates: todayInIndia(), never a UTC slice of now', () => {
    const bad: string[] = []
    for (const root of ROOTS) {
      for (const p of walk(join(REPO, root))) {
        const rel = relative(REPO, p).split(sep).join('/')
        if (HELPERS.has(rel)) continue
        const lines = readFileSync(p, 'utf8').split('\n')
        lines.forEach((l, i) => {
          if (/^\s*(\*|\/\/)/.test(l) || !UTC_DAY.test(l)) return
          if (/utc-ok:/.test(l) || /utc-ok:/.test(lines[i - 1] ?? '')) return
          bad.push(`${rel}:${i + 1}: ${l.trim()}`)
        })
      }
    }
    expect(
      bad,
      `CLAUDE.md "Dates on screen are India dates" -- use todayInIndia() (apps/web/src/shared/ui/days-left.ts, services/api/src/lib/dates.ts); ` +
        `todayInIndia().slice(0, 7) for this month. If the UTC day is really wanted, mark the line "// utc-ok: <reason>".\n${bad.join('\n')}`,
    ).toEqual([])
  })

  it('catches the shapes it is meant to, and leaves calendar arithmetic alone', () => {
    for (const s of [
      'const t = new Date().toISOString().slice(0, 10)',
      'const m = new Date().toISOString().slice(0, 7)',
      "const t = new Date().toISOString().split('T')[0]",
      'const t = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)',
      'due: new Date(Date.now() + 2 * 86_400_000).toISOString().substring(0, 10)',
    ])
      expect(UTC_DAY.test(s), s).toBe(true)
    for (const s of [
      'return d.toISOString().slice(0, 10)',
      'const t = new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10)',
      'created_at: new Date().toISOString(),',
      "const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')",
    ])
      expect(UTC_DAY.test(s), s).toBe(false)
  })
})
