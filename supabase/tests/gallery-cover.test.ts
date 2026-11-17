import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0307: what a plan covers in Frameline -- Google Drive galleries, up to a number of photos kept -- and the
 * platform owner adding more for one studio.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const ADMIN = 'c3070000-0000-4000-8000-000000000001'
const OWNER = 'c3070000-0000-4000-8000-000000000002'
const S = (n: number) => `c3070000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const as = async <T>(user: string, sql: string) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await q<T>(sql)
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`)
  }
}
const cover = (id: string) => q<{ plan: string; photos: number }>(`select plan, photos from gallery_cover('${id}')`)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@p.test'), ('${OWNER}', 'o@s.test');
    insert into platform_admins (user_id) values ('${ADMIN}');
    insert into companies (id, name, owner_user_id, plan, plan_expiry, grandfathered_until) values
      ('${S(1)}', 'Pro Studio',     '${OWNER}', 'pro_yearly',     now() + interval '200 days', null),
      ('${S(2)}', 'Max Studio',     '${OWNER}', 'max_monthly',    now() + interval '20 days',  null),
      ('${S(3)}', 'Starter Studio', '${OWNER}', 'starter_yearly', now() + interval '100 days', null),
      ('${S(4)}', 'Trial Studio',   '${OWNER}', null,             null,                        now() + interval '5 days'),
      ('${S(5)}', 'Ended Studio',   '${OWNER}', 'pro_yearly',     now() - interval '1 day',    now() - interval '40 days'),
      ('${S(6)}', 'Admin Studio',   '${OWNER}', null,             null,                        '2099-12-31 23:59:59+05:30');
  `)
})

describe('what a plan covers in Frameline', () => {
  it('Pro 25,000 photos, Studio Max 75,000, the trial 3,000, until the plan or trial ends', async () => {
    expect(await cover(S(1))).toEqual([expect.objectContaining({ photos: 25000 })])
    expect(await cover(S(2))).toEqual([expect.objectContaining({ photos: 75000 })])
    expect(await cover(S(4))).toEqual([{ plan: 'Trial', photos: 3000 }])
    expect(await cover(S(6))).toEqual([{ plan: 'Open for life', photos: 75000 }])
    const [pro] = await q<{ until: Date; expiry: Date }>(`select g.until, c.plan_expiry as expiry from gallery_cover('${S(1)}') g, companies c where c.id = '${S(1)}'`)
    expect(pro!.until).toEqual(pro!.expiry)
  })

  it('covers nothing on Starter or once access has ended', async () => {
    expect(await cover(S(3))).toEqual([])
    expect(await cover(S(5))).toEqual([])
  })

  it('adds photos the team sold, only for a platform admin, never below zero', async () => {
    await expect(as(OWNER, `select platform_add_gallery_photos('${S(1)}', 10000)`)).rejects.toThrow(/platform access only/)
    const [{ extra }] = await as<{ extra: number }>(ADMIN, `select platform_add_gallery_photos('${S(1)}', 10000) as extra`)
    expect(extra).toBe(10000)
    expect(await cover(S(1))).toEqual([expect.objectContaining({ photos: 35000 })])
    await as(ADMIN, `select platform_add_gallery_photos('${S(1)}', -50000)`)
    expect(await cover(S(1))).toEqual([expect.objectContaining({ photos: 25000 })])
    expect(await q(`select 1 from billing_events where company_id = '${S(1)}' and kind = 'gallery_photos_added'`)).toHaveLength(2)
  })
})
