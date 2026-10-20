import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0276: brands on one login. Pro has three studios, Studio Max as many as it
 * likes, Starter and a trial one; a brand rides on the first studio's plan.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e8000000-0000-4000-8000-000000000001'
const STAFF = 'e8000000-0000-4000-8000-000000000002'
const STARTER_OWNER = 'e8000000-0000-4000-8000-000000000003'
const TRIAL_OWNER = 'e8000000-0000-4000-8000-000000000004'
const PRO = 'e8000000-0000-4000-8000-0000000000aa'
const STARTER = 'e8000000-0000-4000-8000-0000000000bb'
const TRIAL = 'e8000000-0000-4000-8000-0000000000cc'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const asUser = async <T>(user: string, fn: () => Promise<T>): Promise<T> => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role;`)
  }
}
type Brands = { used: number; limit: number | null; can_add: boolean; is_owner: boolean }
const brands = (user: string) => asUser(user, async () => (await q<{ doc: Brands }>(`select my_brands() as doc`))[0]!.doc)
const add = (user: string, name: string) =>
  asUser(user, async () => (await q<{ id: string }>(`select create_brand($1) as id`, [name]))[0]!.id)

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
  const files = readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'asha@studio.test'), ('${STAFF}', 'ravi@studio.test'),
      ('${STARTER_OWNER}', 's@studio.test'), ('${TRIAL_OWNER}', 't@studio.test');
    insert into companies (id, name, owner_user_id, plan, plan_expiry, plan_period_start) values
      ('${PRO}', 'Asha Weddings', '${OWNER}', 'pro_yearly', now() + interval '200 days', now() - interval '165 days'),
      ('${STARTER}', 'Small Studio', '${STARTER_OWNER}', 'starter_yearly', now() + interval '200 days', now() - interval '165 days');
    insert into companies (id, name, owner_user_id) values ('${TRIAL}', 'Trial Studio', '${TRIAL_OWNER}');
    insert into users (user_id, company_id, role, name, email, phone) values
      ('${OWNER}', '${PRO}', 'super_admin', 'Asha Rao', 'asha@studio.test', '9876921126'),
      ('${STAFF}', '${PRO}', 'employee', 'Ravi', 'ravi@studio.test', null),
      ('${STARTER_OWNER}', '${STARTER}', 'super_admin', 'Sam', 's@studio.test', null),
      ('${TRIAL_OWNER}', '${TRIAL}', 'super_admin', 'Tia', 't@studio.test', null);
  `)
})

describe('brands on one login (0276)', () => {
  it('lets a Pro owner run three studios, each its own, on the same plan', async () => {
    expect(await brands(OWNER)).toMatchObject({ used: 1, limit: 3, can_add: true, is_owner: true })
    const profile = await add(OWNER, 'Asha Maternity')
    const [b] = await q<{ name: string; brand_of: string; plan: string; owner: string; role: string }>(
      `select c.name, c.brand_of, c.plan, c.owner_user_id as owner, u.role
         from companies c join users u on u.company_id = c.id and u.user_id = c.owner_user_id
        where c.owner_user_id = $1`,
      [profile],
    )
    expect(b).toMatchObject({ name: 'Asha Maternity', brand_of: PRO, plan: 'pro_yearly', role: 'super_admin' })
    const profiles = await q<{ company_name: string }>(`select company_name from list_login_profiles($1)`, [OWNER])
    expect(profiles.map((p) => p.company_name).sort()).toEqual(['Asha Maternity', 'Asha Weddings'])

    // Adding from inside the brand counts against the same three.
    await add(profile, 'Asha Kids')
    expect(await brands(profile)).toMatchObject({ used: 3, limit: 3, can_add: false })
    await expect(add(OWNER, 'One Too Many')).rejects.toThrow(/Pro plan has 3 brands/)
  })

  it('gives Studio Max as many as it likes, and the brands follow the plan', async () => {
    await q(`update companies set plan = 'max_yearly' where id = $1`, [PRO])
    const plans = await q<{ plan: string }>(`select plan from companies where brand_of = $1`, [PRO])
    expect(plans.map((p) => p.plan)).toEqual(['max_yearly', 'max_yearly'])
    expect(await brands(OWNER)).toMatchObject({ used: 3, limit: null, can_add: true })
    await add(OWNER, 'Asha Corporate')
  })

  it('keeps Starter and a trial to one studio, and staff cannot add', async () => {
    await expect(add(STARTER_OWNER, 'Second')).rejects.toThrow(/Pro and Studio Max/)
    await expect(add(TRIAL_OWNER, 'Second')).rejects.toThrow(/Pro and Studio Max/)
    await expect(add(STAFF, 'Mine')).rejects.toThrow(/Only the owner/)
    expect(await brands(STAFF)).toMatchObject({ is_owner: false, can_add: false })
  })
})
