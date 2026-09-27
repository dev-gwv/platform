import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Why a lead was archived, and who did it (0200).
 *
 * 0032 recorded a boolean and a timestamp, so a lead found in the archive six
 * months later said only that somebody had archived it at some point. Four
 * different paths archive a lead — the drawer, the bulk toolbar, the
 * archive-lost-leads sweep, and the undo that reverses one of those — so who
 * did it is stamped by a trigger rather than by each caller, which is how
 * archived_at itself has worked since 0032.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const STAFF = '33333333-3333-3333-3333-333333333333'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]

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
  for (const f of readdirSync(migDir)
    .filter((x) => x.endsWith('.sql') && !x.startsWith('0000_'))
    .sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${STAFF}', 's@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${STAFF}', '${COMPANY}', 'employee', 'Staffer', 's@s.test');
  `)
})

let seq = 0
const lead = async () => {
  seq += 1
  return (
    await one<{ id: string }>(`
      insert into crm_leads (company_id, name, phone, source)
      values ('${COMPANY}', 'Lead ${seq}', '98${String(10000000 + seq)}', 'manual')
      returning id`)
  ).id
}

beforeEach(async () => {
  await db.exec(`set request.jwt.claim.sub = '${STAFF}';`)
})

describe('archiving records why and who', () => {
  it('stamps the person doing it without being asked', async () => {
    const id = await lead()
    await db.exec(`update crm_leads set is_archived = true, archive_reason = 'Wrong number' where id = '${id}'`)
    const row = await one<{ archive_reason: string; archived_by: string; archived_at: string | null }>(
      `select archive_reason, archived_by, archived_at from crm_leads where id = '${id}'`,
    )
    expect(row.archive_reason).toBe('Wrong number')
    expect(row.archived_by).toBe(STAFF)
    expect(row.archived_at).not.toBeNull()
  })

  it('accepts an archive with no reason given', async () => {
    const id = await lead()
    await db.exec(`update crm_leads set is_archived = true where id = '${id}'`)
    const row = await one<{ archive_reason: string | null; archived_by: string }>(
      `select archive_reason, archived_by from crm_leads where id = '${id}'`,
    )
    expect(row.archive_reason).toBeNull()
    expect(row.archived_by).toBe(STAFF)
  })

  it('clears both on the way back out, so a live lead carries no stale reason', async () => {
    const id = await lead()
    await db.exec(`update crm_leads set is_archived = true, archive_reason = 'Duplicate' where id = '${id}'`)
    await db.exec(`update crm_leads set is_archived = false where id = '${id}'`)
    const row = await one<{ archive_reason: string | null; archived_by: string | null }>(
      `select archive_reason, archived_by from crm_leads where id = '${id}'`,
    )
    expect(row.archive_reason).toBeNull()
    expect(row.archived_by).toBeNull()
  })

  it('refuses a reason too short to mean anything', async () => {
    const id = await lead()
    await expect(
      db.exec(`update crm_leads set is_archived = true, archive_reason = '.' where id = '${id}'`),
    ).rejects.toThrow()
  })

  it('leaves an already-archived lead’s stamp alone on a later edit', async () => {
    const id = await lead()
    await db.exec(`update crm_leads set is_archived = true, archive_reason = 'Went quiet' where id = '${id}'`)
    // Somebody else touches the lead afterwards; they did not archive it.
    await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
    await db.exec(`update crm_leads set name = 'Renamed' where id = '${id}'`)
    const row = await one<{ archived_by: string; archive_reason: string }>(
      `select archived_by, archive_reason from crm_leads where id = '${id}'`,
    )
    expect(row.archived_by).toBe(STAFF)
    expect(row.archive_reason).toBe('Went quiet')
  })
})

describe('crm_bulk_patch carries the reason', () => {
  it('archives many leads with one reason and can undo it', async () => {
    const ids = [await lead(), await lead(), await lead()]
    const arr = `array['${ids.join("','")}']::uuid[]`
    await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)

    await db.exec(`select * from crm_bulk_patch(${arr}, '{"is_archived": true, "archive_reason": "Duplicate"}'::jsonb)`)
    const after = await one<{ n: number }>(
      `select count(*)::int as n from crm_leads where id = any(${arr}) and is_archived and archive_reason = 'Duplicate' and archived_by = '${OWNER}'`,
    )
    expect(after.n).toBe(3)

    // The undo path restores is_archived, and the trigger tidies up the reason
    // that no longer describes anything -- crm_bulk_patch's snapshot does not
    // carry these two columns, so this is the only thing that can.
    await db.exec(`select * from crm_bulk_patch(${arr}, '{"is_archived": false}'::jsonb)`)
    const restored = await one<{ n: number }>(
      `select count(*)::int as n from crm_leads
        where id = any(${arr}) and not is_archived and archive_reason is null and archived_by is null`,
    )
    expect(restored.n).toBe(3)
  })
})
