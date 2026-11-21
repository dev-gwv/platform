#!/usr/bin/env node
/**
 * Migration numbering guard (CI, on every pull request and push to main).
 *
 * Two sessions pick "the next free number" against a moving target, and the
 * second to merge breaks the other's deploy (CLAUDE.md, "Migration numbers
 * collide"). This fails the change before it lands when:
 *
 *   1. two migration files share a number;
 *   2. a migration that already exists on the base branch has its SQL changed,
 *      is renamed or is deleted (comment-only edits are fine, and so is adding
 *      the body to a file that was a claim with no SQL yet). deploy/db/migrate.sh
 *      records files by name, so an edited applied file never runs again and a
 *      renamed one runs twice or is refused;
 *   3. a new migration's number is not higher than every number on the base.
 *
 * A file with no SQL (a claim: only its comment header) is a warning, not a
 * failure: pushing a claim to main is the protocol CLAUDE.md asks for, and
 * migrate.sh skips claims without recording them. MIGRATIONS_FAIL_ON_CLAIMS=1
 * turns the warning into a failure.
 *
 * The base is MIGRATIONS_BASE (a commit) when set, else the merge base with
 * origin/main (fetched if missing). With no base to compare against, checks
 * 2 and 3 are skipped with a warning; check 1 always runs.
 *
 *   node tools/check-migrations.mjs
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIR = 'supabase/migrations'

/** The SQL that matters: comments and whitespace removed. */
export function sqlOf(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const numberOf = (name) => (/^(\d+)_/.exec(name) ?? [])[1] ?? null
const isMigration = (name) => name.endsWith('.sql') && !name.startsWith('0000_')

/**
 * The rules, without git or the disk. `head` maps each migration file in this
 * change to its text; `base` does the same for the base commit, or is null
 * when there is nothing to compare against.
 */
export function checkMigrations(head, base) {
  const errors = []
  const warnings = []
  const files = [...head.keys()].filter(isMigration).sort()

  // ── 1. Unique numbers, and claims ───────────────────────────────────────
  const byNumber = new Map()
  for (const f of files) {
    const n = numberOf(f)
    if (!n) {
      errors.push(`${f}: a migration name must start with its number (0123_what_it_does.sql)`)
      continue
    }
    byNumber.set(n, [...(byNumber.get(n) ?? []), f])
    if (!sqlOf(head.get(f))) warnings.push(`${f} has no SQL yet (a claim). migrate.sh skips it until it has a body.`)
  }
  for (const [n, names] of byNumber) {
    if (names.length > 1) errors.push(`migration number ${n} is used by ${names.length} files: ${names.join(', ')}`)
  }
  if (!base) return { files, errors, warnings }

  const baseFiles = [...base.keys()].filter(isMigration)
  const baseMax = Math.max(0, ...baseFiles.map((f) => Number(numberOf(f) ?? 0)))

  // ── 2. Existing migrations are not changed, renamed or deleted ──────────
  for (const f of baseFiles) {
    const was = base.get(f)
    const wasClaim = !sqlOf(was)
    if (!head.has(f)) {
      if (!wasClaim) {
        errors.push(
          `${f} exists on main and was renamed or deleted here. migrate.sh records migrations by name: ` +
            'a renamed file runs again (or is refused), a deleted one leaves a database nobody can rebuild. ' +
            'Put the change in a new migration instead.',
        )
      }
      continue
    }
    if (wasClaim) continue // adding the body to a claim is how a claim is meant to end
    if (sqlOf(head.get(f)) !== sqlOf(was)) {
      errors.push(
        `${f} already exists on main and its SQL was changed here. Databases that ran it will never run it ` +
          'again. Write the change as a new migration (copy the latest definition and edit that). Comment-only edits are fine.',
      )
    }
  }

  // ── 3. New migrations come after everything on the base ────────────────
  for (const f of files) {
    if (base.has(f)) continue
    const n = Number(numberOf(f) ?? 0)
    if (n <= baseMax) {
      errors.push(
        `${f} is new here but numbered ${numberOf(f)}, not above ${String(baseMax).padStart(4, '0')}, the highest on main. ` +
          'Another session has taken numbers since you started: git fetch origin && git ls-tree --name-only origin/main ' +
          `${DIR}/ | sort | tail -3, then renumber (filename, tests that read it, comments that cite it).`,
      )
    }
  }
  return { files, errors, warnings }
}

// ── Command line: git and the disk ────────────────────────────────────────
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tryGit = (...args) => {
  try {
    return git(...args)
  } catch {
    return null
  }
}

function findBase() {
  const given = process.env.MIGRATIONS_BASE?.trim()
  if (given && !/^0+$/.test(given)) {
    if (tryGit('cat-file', '-e', `${given}^{commit}`) !== null) return given
    tryGit('fetch', '--no-tags', '--quiet', 'origin', given)
    if (tryGit('cat-file', '-e', `${given}^{commit}`) !== null) return given
    console.log(`warning: MIGRATIONS_BASE ${given} is not in this clone; falling back to origin/main`)
  }
  if (tryGit('rev-parse', '--verify', '--quiet', 'origin/main') === null) {
    tryGit('fetch', '--no-tags', '--quiet', 'origin', 'main:refs/remotes/origin/main')
  }
  if (tryGit('rev-parse', '--verify', '--quiet', 'origin/main') === null) return null
  let base = tryGit('merge-base', 'HEAD', 'origin/main')
  if (base === null) {
    // A shallow clone: deepen until the histories meet.
    tryGit('fetch', '--no-tags', '--quiet', '--unshallow', 'origin', 'main')
    base = tryGit('merge-base', 'HEAD', 'origin/main')
  }
  // On main itself the merge base is HEAD: nothing new to compare.
  return base
}

function main() {
  const head = new Map(readdirSync(DIR).filter(isMigration).map((f) => [f, readFileSync(join(DIR, f), 'utf8')]))
  const baseSha = findBase()
  let base = null
  if (baseSha) {
    base = new Map()
    const paths = (tryGit('ls-tree', '--name-only', baseSha, `${DIR}/`) ?? '').split('\n').filter(Boolean)
    for (const p of paths) {
      const f = p.slice(DIR.length + 1)
      if (isMigration(f)) base.set(f, tryGit('show', `${baseSha}:${p}`) ?? '')
    }
  }
  const { files, errors, warnings } = checkMigrations(head, base)
  if (!baseSha) warnings.push('no base commit to compare against (origin/main not reachable): only the duplicate check ran')

  const failOnClaims = process.env.MIGRATIONS_FAIL_ON_CLAIMS === '1'
  const inActions = !!process.env.GITHUB_ACTIONS
  for (const w of warnings) {
    if (failOnClaims && w.includes('(a claim)')) errors.push(w)
    else console.log(inActions ? `::warning::${w}` : `warning: ${w}`)
  }
  if (errors.length) {
    for (const e of errors) console.error(inActions ? `::error::${e}` : `error: ${e}`)
    console.error(`check-migrations: ${errors.length} problem(s)`)
    process.exit(1)
  }
  console.log(`check-migrations: ${files.length} migrations, numbers unique${baseSha ? `, checked against ${baseSha.slice(0, 12)}` : ''}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
