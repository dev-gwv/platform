import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Migrations that think they created a table, and did not.
 *
 * 0119 declared expense_attachments with file_name / file_url / file_size /
 * mime_type / created_by using `create table if not exists`. 0012 had already
 * created that table with a single `url` column, so the statement did nothing
 * — no error, no columns — and both the reader and the writer for expense
 * receipts named columns that do not exist. A bare catch in the router turned
 * the read into "no attachments yet", so nothing ever looked wrong.
 *
 * This reads every `create table if not exists` out of the migration files and
 * checks that the table the schema actually ends up with has the columns that
 * statement asked for. It cannot be fooled by the statement being a no-op,
 * because it compares against the applied schema rather than against itself.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/** Comments first — a `-- note` inside a table body reads as column names. */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ')
}

/** `create table if not exists <name> ( ... );` with its top-level column names. */
function declaredTables(raw: string): { table: string; columns: string[] }[] {
  const sql = stripComments(raw)
  const out: { table: string; columns: string[] }[] = []
  const re = /create\s+table\s+if\s+not\s+exists\s+([a-z_][a-z0-9_]*)\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) {
    // Walk to the matching close paren so nested type/check parens are safe.
    let depth = 1
    let i = re.lastIndex
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === '(') depth++
      else if (sql[i] === ')') depth--
    }
    const body = sql.slice(re.lastIndex, i - 1)

    // Split on top-level commas only.
    const parts: string[] = []
    let d = 0
    let cur = ''
    for (const ch of body) {
      if (ch === '(') d++
      if (ch === ')') d--
      if (ch === ',' && d === 0) {
        parts.push(cur)
        cur = ''
      } else cur += ch
    }
    parts.push(cur)

    const columns = parts
      .map((p) => p.trim())
      .filter((p) => p && !/^(primary|foreign|unique|check|constraint|exclude)\b/i.test(p))
      .map((p) => p.split(/\s+/)[0]!)
      .filter((c) => /^[a-z_][a-z0-9_]*$/.test(c))
    out.push({ table: m[1]!.toLowerCase(), columns })
  }
  return out
}

let applied: Map<string, Set<string>>
let declared: { file: string; table: string; columns: string[] }[]
// Tables a later migration drops on purpose (0273 dropped 0271's support requests).
let dropped: Set<string>

beforeAll(async () => {
  const db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(
    `create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`,
  )
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)

  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
    .sort()

  declared = []
  dropped = new Set()
  for (const f of files) {
    const sql = readFileSync(join(migDir, f), 'utf8')
    await db.exec(sql)
    for (const d of declaredTables(sql)) declared.push({ file: f, ...d })
    for (const m of sql.matchAll(/^\s*drop table if exists\s+(?:public\.)?(\w+)/gim)) dropped.add(m[1]!.toLowerCase())
  }

  const rows = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  )
  applied = new Map()
  for (const r of rows.rows) {
    const set = applied.get(r.table_name) ?? new Set<string>()
    set.add(r.column_name)
    applied.set(r.table_name, set)
  }
})

describe('create table if not exists', () => {
  it('finds the statements to check', () => {
    expect(declared.length).toBeGreaterThan(5)
  })

  it('every column a migration declares actually exists on the applied table', () => {
    const drift: string[] = []
    for (const d of declared) {
      if (dropped.has(d.table)) continue
      const have = applied.get(d.table)
      if (!have) {
        drift.push(`${d.file}: ${d.table} was never created`)
        continue
      }
      const missing = d.columns.filter((c) => !have.has(c))
      if (missing.length) {
        drift.push(
          `${d.file}: ${d.table} is missing ${missing.join(', ')} — ` +
            `an earlier migration already created it with a different shape, so this ` +
            `statement did nothing. Add the columns with ALTER TABLE instead.`,
        )
      }
    }
    expect(drift).toEqual([])
  })
})
