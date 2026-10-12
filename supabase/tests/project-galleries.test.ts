import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * A project's Frameline gallery (0261): one studio never sees or writes
 * another's, and the client's page shows the gallery only through a live link
 * -- a stopped or expired link shows none.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const A_OWNER = 'f6100000-0000-4000-8000-000000000001'
const A = 'f6100000-0000-4000-8000-0000000000aa'
const B_OWNER = 'f6100000-0000-4000-8000-000000000002'
const B = 'f6100000-0000-4000-8000-0000000000bb'
const PRIYA = 'f6100000-0000-4000-8000-0000000000c1'
const WEDDING = 'f6100000-0000-4000-8000-0000000000d1'
const OTHER = 'f6100000-0000-4000-8000-0000000000d2'
const TOKEN = 'client-link-raw-token-for-the-gallery-test'

let db: PGlite
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const asUser = async <T>(uid: string, fn: () => Promise<T>) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
const galleryFor = async (raw: string) => (await q<{ g: unknown }>(`select client_portal_gallery($1) as g`, [raw]))[0]!.g

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  // Production grants table access by default privileges; RLS is what keeps studios apart.
  await db.exec(`grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;`)
  await db.exec(`
    insert into auth.users (id, email) values ('${A_OWNER}', 'a@g.test'), ('${B_OWNER}', 'b@g.test');
    insert into companies (id, name, owner_user_id) values ('${A}', 'Asha Studio', '${A_OWNER}'), ('${B}', 'Other Studio', '${B_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${A_OWNER}', '${A}', 'super_admin', 'Asha', 'a@g.test'), ('${B_OWNER}', '${B}', 'super_admin', 'Bina', 'b@g.test');
    insert into clients (id, company_id, name) values ('${PRIYA}', '${A}', 'Priya Sharma');
    insert into projects (id, company_id, client_id, name) values
      ('${WEDDING}', '${A}', '${PRIYA}', 'Priya & Rahul Wedding'), ('${OTHER}', '${A}', '${PRIYA}', 'Priya Engagement');
    insert into client_portal_links (company_id, project_id, token_hash)
      values ('${A}', '${WEDDING}', encode(sha256(convert_to('${TOKEN}', 'UTF8')), 'hex'));
  `)
})

describe('project galleries', () => {
  it('lets a studio keep its own project\'s gallery', async () => {
    await asUser(A_OWNER, () =>
      q(
        `insert into project_galleries (project_id, company_id, event_id, short_id, gallery_url, pin)
         values ($1, $2, 'ev_abc', 'AB12CD3', 'https://gallery.example/AB12CD3', '4821')`,
        [WEDDING, A],
      ),
    )
    const mine = await asUser(A_OWNER, () => q<{ short_id: string }>(`select short_id from project_galleries`))
    expect(mine).toEqual([{ short_id: 'AB12CD3' }])
  })

  it('never shows one studio another\'s gallery, nor lets it write one onto another\'s project', async () => {
    expect(await asUser(B_OWNER, () => q(`select project_id from project_galleries`))).toEqual([])
    await asUser(B_OWNER, () =>
      expect(
        q(
          `insert into project_galleries (project_id, company_id, event_id, short_id, gallery_url)
           values ($1, $2, 'ev_x', 'XX', 'https://gallery.example/XX')`,
          [OTHER, B],
        ),
      ).rejects.toThrow(),
    )
  })

  it('refuses a link that is not a web address', async () => {
    await expect(
      q(
        `insert into project_galleries (project_id, company_id, event_id, short_id, gallery_url)
         values ($1, $2, 'ev_y', 'YY', 'javascript:alert(1)')`,
        [OTHER, A],
      ),
    ).rejects.toThrow()
  })

  it('shows the client the gallery and its PIN through their live link only', async () => {
    expect(await galleryFor(TOKEN)).toEqual({ url: 'https://gallery.example/AB12CD3', pin: '4821' })
    expect(await galleryFor('not-the-token')).toBeNull()
    await q(`update client_portal_links set revoked_at = now() where project_id = $1`, [WEDDING])
    expect(await galleryFor(TOKEN)).toBeNull()
  })

  it('is not something a signed-in studio member can call for any token', async () => {
    await asUser(A_OWNER, () => expect(q(`select client_portal_gallery($1)`, [TOKEN])).rejects.toThrow())
  })
})
