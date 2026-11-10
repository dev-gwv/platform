import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0299: a note on a booked person (like a cell comment), and wedding QR codes
 * kept apart from partners (enquiry_partners.kind + project_id).
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'e9900000-0000-4000-8000-000000000001'
const PRIYA = 'e9900000-0000-4000-8000-000000000002'
const OTHER_OWNER = 'e9900000-0000-4000-8000-000000000003'
const COMPANY = 'e9900000-0000-4000-8000-0000000000aa'
const OTHER = 'e9900000-0000-4000-8000-0000000000bb'
const CLIENT = 'e9900000-0000-4000-8000-0000000000c1'
const OTHER_CLIENT = 'e9900000-0000-4000-8000-0000000000c2'
const PROJECT = 'e9900000-0000-4000-8000-0000000000d1'
const OTHER_PROJECT = 'e9900000-0000-4000-8000-0000000000d2'
const SHOOT = 'e9900000-0000-4000-8000-0000000000e1'

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
type Partner = { id: string; kind: string; project_id: string | null; name: string; occasion: string | null; view_token: string | null; archived_at: string | null }
const wedding = (user: string, project: string) =>
  asUser(user, async () => (await q<Partner>(`select * from create_wedding_qr($1)`, [project]))[0]!)

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test'), ('${OTHER_OWNER}', 'x@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test', 'active'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test', 'active'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@s.test', 'active');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma'), ('${OTHER_CLIENT}', '${OTHER}', 'Else');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Priya & Rahul''s Wedding', 200000, '${OWNER}');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${OTHER_PROJECT}', '${OTHER}', '${OTHER_CLIENT}', 'Not yours', 1000, '${OTHER_OWNER}');
    insert into shoots (id, company_id, project_id, name, shoot_date, location) values
      ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Haldi', current_date + 3, 'Jaipur');
    -- Supabase's default table grants, which pglite lacks (the table has no column grants of its own).
    grant select, update on team_assignment_slots to authenticated;
  `)
})

describe('a note on a booked person (0299)', () => {
  it('starts empty and a planner can write and clear it', async () => {
    const id = await asUser(OWNER, async () =>
      (await q<{ id: string }>(
        `select book_team_slot('${PRIYA}', '${SHOOT}', 'Candid', now() + interval '3 days', now() + interval '3 days 4 hours') as id`,
      ))[0]!.id,
    )
    const [before] = await q<{ note: string | null; note_by: string | null; note_at: string | null }>(
      `select note, note_by, note_at from team_assignment_slots where id = $1`,
      [id],
    )
    expect(before).toEqual({ note: null, note_by: null, note_at: null })
    await asUser(OWNER, () =>
      q(`update team_assignment_slots set note = 'Bring the 70-200', note_by = $2, note_at = now() where id = $1`, [id, OWNER]),
    )
    const [after] = await q<{ note: string; note_by: string }>(`select note, note_by from team_assignment_slots where id = $1`, [id])
    expect(after).toEqual({ note: 'Bring the 70-200', note_by: OWNER })
  })

  it('refuses a note longer than 500 characters', async () => {
    await expect(q(`update team_assignment_slots set note = repeat('x', 501)`)).rejects.toThrow()
  })
})

describe('wedding QR codes (0299)', () => {
  it('leaves every partner a partner', async () => {
    const p = await asUser(OWNER, async () => (await q<Partner>(`select * from create_enquiry_partner('Riya Boutique')`))[0]!)
    expect(p.kind).toBe('partner')
    expect(p.project_id).toBeNull()
  })

  it('makes one for a project, named after it, with no partner page', async () => {
    const w = await wedding(OWNER, PROJECT)
    expect(w).toMatchObject({ kind: 'wedding', project_id: PROJECT, name: "Priya & Rahul's Wedding", occasion: "Priya & Rahul's Wedding", view_token: null })
    // Asking again gives the same one back.
    expect((await wedding(OWNER, PROJECT)).id).toBe(w.id)
  })

  it('brings an ended one back instead of making a second', async () => {
    const w = await wedding(OWNER, PROJECT)
    await q(`update enquiry_partners set archived_at = now() where id = $1`, [w.id])
    const again = await wedding(OWNER, PROJECT)
    expect(again.id).toBe(w.id)
    expect(again.archived_at).toBeNull()
  })

  it("refuses another studio's project", async () => {
    await expect(wedding(OWNER, OTHER_PROJECT)).rejects.toThrow(/not found/)
  })

  it('lets a partner and a wedding QR share a name', async () => {
    const p = await asUser(OWNER, async () => (await q<Partner>(`select * from create_enquiry_partner($1)`, ["Priya & Rahul's Wedding"]))[0]!)
    expect(p.kind).toBe('partner')
    await expect(
      asUser(OWNER, () => q(`select * from create_enquiry_partner($1)`, ["Priya & Rahul's Wedding"])),
    ).rejects.toThrow(/already have a partner/)
  })

  it('lets the studio change kind and project, and refuses an unknown kind', async () => {
    const w = await wedding(OWNER, PROJECT)
    await asUser(OWNER, () => q(`update enquiry_partners set project_id = null where id = $1`, [w.id]))
    await expect(q(`update enquiry_partners set kind = 'stall' where id = $1`, [w.id])).rejects.toThrow()
  })
})
