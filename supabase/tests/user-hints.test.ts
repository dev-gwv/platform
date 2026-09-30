import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * User hints (0216): a person's one-time notes live on their own row, are
 * written only through set_user_hint(), and only ever to the caller's row.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e0000000-0000-4000-8000-000000000001'
const EDITOR = 'e0000000-0000-4000-8000-000000000002'
const COMPANY = 'e0000000-0000-4000-8000-0000000000aa'

let db: PGlite
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0]!
const as = (uid: string | null) => db.exec(`set request.jwt.claim.sub = '${uid ?? ''}';`)
const hintsOf = (uid: string) => one<{ hints: Record<string, unknown> }>(`select hints from users where user_id = '${uid}'`).then((r) => r.hints)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(
    `create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`,
  )
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@h.test'), ('${EDITOR}', 'e@h.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Mulberry', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@h.test'),
      ('${EDITOR}', '${COMPANY}', 'employee', 'Nitin', 'e@h.test');
  `)
})

beforeEach(async () => {
  await db.exec(`update users set hints = '{}'::jsonb;`)
  await as(OWNER)
})

describe('user hints (0216)', () => {
  it('starts empty for everyone', async () => {
    expect(await hintsOf(OWNER)).toEqual({})
    expect(await hintsOf(EDITOR)).toEqual({})
  })

  it('merges one key into the caller’s own row and returns the whole object', async () => {
    const r = await one<{ h: Record<string, unknown> }>(`select set_user_hint('assign_note', '{"shown": 1, "closed": false}') as h`)
    expect(r.h).toEqual({ assign_note: { shown: 1, closed: false } })
    await one(`select set_user_hint('other_note', '{"shown": 2}')`)
    await one(`select set_user_hint('assign_note', '{"shown": 2, "closed": true}')`)
    expect(await hintsOf(OWNER)).toEqual({ assign_note: { shown: 2, closed: true }, other_note: { shown: 2 } })
  })

  it('never touches anyone else’s row', async () => {
    await one(`select set_user_hint('assign_note', '{"shown": 5}')`)
    expect(await hintsOf(EDITOR)).toEqual({})
    await as(EDITOR)
    await one(`select set_user_hint('assign_note', '{"shown": 1}')`)
    expect(await hintsOf(OWNER)).toEqual({ assign_note: { shown: 5 } })
    expect(await hintsOf(EDITOR)).toEqual({ assign_note: { shown: 1 } })
  })

  it('removes a key when the value is null', async () => {
    await one(`select set_user_hint('assign_note', '{"shown": 3}')`)
    await one(`select set_user_hint('assign_note', null)`)
    expect(await hintsOf(OWNER)).toEqual({})
  })

  it('refuses a signed-out caller, a bad key and an oversized value', async () => {
    await as(null)
    await expect(db.query(`select set_user_hint('assign_note', '{"shown": 1}')`)).rejects.toThrow(/not signed in/)
    await as(OWNER)
    await expect(db.query(`select set_user_hint('Bad Key!', '{}')`)).rejects.toThrow(/bad hint key/)
    await expect(db.query(`select set_user_hint('assign_note', to_jsonb(repeat('x', 3000)))`)).rejects.toThrow(/too large/)
    expect(await hintsOf(OWNER)).toEqual({})
  })

  it('is not callable by anon', async () => {
    const g = await one<{ ok: boolean }>(`select has_function_privilege('anon', 'set_user_hint(text, jsonb)', 'execute') as ok`)
    expect(g.ok).toBe(false)
  })
})
