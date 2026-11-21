/**
 * Apply EVERY migration, in the order deploy/db/migrate.sh applies them.
 *
 * `tenancy.test.ts` lists migration files by hand, so a new file that nobody
 * adds to that list is never executed by anything and the suite still passes.
 * That is not hypothetical: 0097-0123 shipped that way and three of them had
 * SQL that would have failed the `migrate` service on deploy — and because
 * `api` waits on `migrate` completing successfully, a failure there takes the
 * API down rather than just skipping a migration.
 *
 * This runs the whole directory against pglite so no file can be missed by
 * omission. It is not a substitute for the CI e2e job against real Postgres;
 * it is the gate that runs in a plain `bun run test` before anyone pushes.
 *
 *   bun supabase/tests/apply-all.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const files = readdirSync(migDir)
  .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
  .sort()

const db = new PGlite()
// The Supabase surface pglite lacks — same shims the tenancy suite installs.
await db.exec(`create schema if not exists auth;`)
await db.exec(
  `create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`,
)
await db.exec(
  `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
)
for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)

const failures = []
for (const f of files) {
  try {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  } catch (e) {
    failures.push(`${f}: ${String(e.message).split('\n')[0]}`)
  }
}

// Numbering, which is the other way the ledger goes wrong: migrate.sh applies
// in filename order, so two files sharing a number apply in an order nobody
// chose, and the ledger keys on the filename.
const numbers = files.map((f) => f.slice(0, 4))
const dupes = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))]
if (dupes.length) failures.push(`duplicate migration numbers: ${dupes.join(', ')}`)

// Contiguous: every number from the first to the last is present, except the
// gaps listed here on purpose (0199 was claimed, then dropped unpushed when its
// work moved to 0204; see CLAUDE.md). A new gap usually means a claim that was
// renumbered half-way.
const KNOWN_GAPS = new Set(['0199'])
const present = new Set(numbers)
const first = Number(numbers[0])
const last = Number(numbers[numbers.length - 1])
const gaps = []
for (let n = first; n <= last; n++) {
  const key = String(n).padStart(4, '0')
  if (!present.has(key) && !KNOWN_GAPS.has(key)) gaps.push(key)
}
if (gaps.length) failures.push(`missing migration numbers (a gap): ${gaps.join(', ')}`)

if (failures.length) {
  console.error(`apply-all: ${failures.length} problem(s)\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`apply-all: ${files.length} migrations applied cleanly, numbering unique and contiguous`)
// Explicit: pglite's WASM teardown otherwise leaves a non-zero exit code behind
// and the whole check reads as a failure in CI.
process.exit(0)
