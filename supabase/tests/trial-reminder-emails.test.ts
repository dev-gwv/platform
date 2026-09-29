import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0211: the studio owner hears 7 days before access ends, the day before,
 * and once when it has ended -- each once per end date.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const id = (n: number) => `c2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const owner = (n: number) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const due = async () =>
  Object.fromEntries(
    (await q<{ studio: string; kind: string; is_trial: boolean }>(`select studio, kind, is_trial from access_email_due()`)).map((r) => [
      r.studio,
      `${r.kind}${r.is_trial ? '' : ':plan'}`,
    ]),
  )

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  // Each studio: [name, trial ends in N days, paid plan ends in N days, owner is platform admin, email confirmed]
  const studios: [string, number | null, number | null, boolean, boolean][] = [
    ['Week', 5, null, false, true],
    ['Tomorrow', 0.5, null, false, true],
    ['JustEnded', -1, null, false, true],
    ['LongGone', -20, null, false, true],
    ['Plenty', 25, null, false, true],
    ['PaidSoon', null, 6, false, true],
    ['Admin', 3, null, true, true],
    ['Unconfirmed', 3, null, false, false],
  ]
  let n = 0
  for (const [name, trial, paid, admin, confirmed] of studios) {
    n += 1
    await db.exec(`
      insert into auth.users (id, email) values ('${owner(n)}', '${name.toLowerCase()}@s.test');
      update auth.users set email_verified = ${confirmed} where id = '${owner(n)}';
      insert into companies (id, name, owner_user_id) values ('${id(n)}', '${name}', '${owner(n)}');
      update companies set
        grandfathered_until = ${trial === null ? 'null' : `now() + interval '${trial * 24} hours'`},
        plan_expiry = ${paid === null ? 'null' : `now() + interval '${paid} days'`},
        grace_until = null
       where id = '${id(n)}';
      ${admin ? `insert into platform_admins (user_id) values ('${owner(n)}');` : ''}
    `)
  }
})

describe('trial and plan reminder emails', () => {
  it('picks the one reminder that is due for each studio', async () => {
    expect(await due()).toEqual({
      Week: 'd7',
      Tomorrow: 'd1',
      JustEnded: 'ended',
      PaidSoon: 'd7:plan',
    })
  })

  it('sends each once per end date', async () => {
    const [w] = await q<{ company_id: string; kind: string; ends_at: string }>(`select company_id, kind, ends_at::text from access_email_due() where studio = 'Week'`)
    const mark = `select access_email_mark('${w!.company_id}', '${w!.kind}', '${w!.ends_at}'::timestamptz) as ok`
    expect((await q<{ ok: boolean }>(mark))[0]!.ok).toBe(true)
    expect((await q<{ ok: boolean }>(mark))[0]!.ok).toBe(false)
    expect(await due()).not.toHaveProperty('Week')
  })

  it('reminds again when the studio is given a new end date', async () => {
    await db.exec(`update companies set grandfathered_until = now() + interval '4 days' where name = 'Week'`)
    expect((await due())['Week']).toBe('d7')
  })

  it('is not readable by signed-in users', async () => {
    const [r] = await q<{ ok: boolean }>(`select has_function_privilege('authenticated', 'access_email_due(timestamptz)', 'execute') as ok`)
    expect(r!.ok).toBe(false)
  })
})
