import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Migration + function regression tests, run against an in-process Postgres
 * (pglite). This validates DDL correctness and the register / auth-context /
 * plan-gate LOGIC.
 *
 * NOTE: pglite runs as a superuser, which BYPASSES RLS — so this suite does
 * NOT prove RLS enforcement. Enforcement is proven by the real-Postgres RLS
 * suite (runs when DATABASE_URL points at a Supabase/Postgres instance).
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const mig = (f: string) => readFileSync(join(migDir, f), 'utf8')
/** Same read, named for the tests that re-run a migration to prove it is idempotent. */
const readMig = mig

const OWNER = '11111111-1111-1111-1111-111111111111'

async function freshDb() {
  const db = new PGlite()
  // Shim the Supabase surface pglite lacks.
  await db.exec(`create schema if not exists auth;`)
  // Matches deploy/db/00_bootstrap.sql exactly (unique not null) so a
  // migration that relaxes this, like a real deploy, is the only thing that
  // can make an insert with a null email succeed -- otherwise this shim
  // quietly diverges from production and a NOT NULL regression like 0091
  // fixes can pass here while failing for real.
  await db.exec(
    `create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`,
  )
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  await db.exec(`create role authenticated;`)
  await db.exec(`create role anon;`)
  await db.exec(`create role service_role;`)
  // Every migration on disk, in order.
  //
  // This used to be 96 hand-written `mig('00xx_....sql')` lines, and the
  // convention was that you added one whenever you added a migration. Nobody
  // did: the list stopped at 0096 while the schema reached 0152, so these 270
  // tenancy tests — the ones that prove RLS actually isolates studios — were
  // running against a database 56 migrations behind production. Every table
  // added since 0096 had its policies asserted by nothing at all.
  //
  // Reading the directory removes the convention instead of restating it. A
  // new migration is covered because it exists, not because someone
  // remembered.
  //
  // 0000_* is skipped: those are Supabase-only extension installs that PGlite
  // neither has nor needs.
  for (const f of readdirSync(migDir)
    .filter((x) => x.endsWith('.sql') && !x.startsWith('0000_'))
    .sort()) {
    await db.exec(mig(f))
  }
  return db
}

async function asUser(db: PGlite, uid: string) {
  await db.exec(`set request.jwt.claim.sub = '${uid}';`)
}

/** Insert a workflow with its steps (in order) for the current company; returns its id. */
async function workflow(
  db: PGlite,
  name: string,
  trigger: string,
  condition: Record<string, unknown>,
  steps: Array<{ kind: 'action' | 'delay' | 'branch' | 'exit'; config?: Record<string, unknown> }>,
  opts: { allow_reenroll?: boolean; exit_on_reply?: boolean } = {},
): Promise<string> {
  const id = (
    await db.query<{ id: string }>(
      `insert into crm_workflows (company_id, name, trigger, condition, allow_reenroll, exit_on_reply)
       values (get_current_company_id(), '${name}', '${trigger}', '${JSON.stringify(condition)}', ${opts.allow_reenroll ?? false}, ${opts.exit_on_reply ?? true})
       returning id;`,
    )
  ).rows[0]!.id
  for (const [i, step] of steps.entries()) {
    await db.exec(
      `insert into crm_workflow_steps (workflow_id, company_id, step_no, kind, config)
       values ('${id}', get_current_company_id(), ${i + 1}, '${step.kind}', '${JSON.stringify(step.config ?? {})}');`,
    )
  }
  return id
}

describe('tenancy migrations + functions', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
  })

  it('register_company_and_admin creates company + owner user', async () => {
    const r = await db.query<{ role: string; existing: boolean; company_id: string }>(
      `select * from register_company_and_admin('Acme Studio','Owner Name','9876543210');`,
    )
    expect(r.rows[0]?.role).toBe('super_admin')
    expect(r.rows[0]?.existing).toBe(false)
    expect(r.rows[0]?.company_id).toBeTruthy()
  })

  it('get_auth_context returns owner context', async () => {
    const r = await db.query<{ role: string; is_owner: boolean; profile_key: string | null }>(
      `select * from get_auth_context();`,
    )
    expect(r.rows[0]?.role).toBe('super_admin')
    expect(r.rows[0]?.is_owner).toBe(true)
    expect(r.rows[0]?.profile_key).toBeNull()
  })

  it('register is idempotent on the auth uid', async () => {
    const r = await db.query<{ existing: boolean }>(
      `select existing from register_company_and_admin('Dup','Dup');`,
    )
    expect(r.rows[0]?.existing).toBe(true)
  })

  it('plan gate is inactive with no live gate, active when in the future', async () => {
    // New studios get an open-ended grandfathered trial (0018); clear it to
    // test the raw gate logic.
    await db.exec(
      `update companies set grandfathered_until = null, plan_expiry = null, grace_until = null
       where id = get_current_company_id();`,
    )
    const off = await db.query<{ active: boolean }>(
      `select is_company_plan_active(get_current_company_id()) as active;`,
    )
    expect(off.rows[0]?.active).toBe(false)

    await db.exec(`update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`)
    const on = await db.query<{ active: boolean }>(
      `select is_company_plan_active(get_current_company_id()) as active;`,
    )
    expect(on.rows[0]?.active).toBe(true)
  })

  it('a second auth user with no tenant gets an empty auth context', async () => {
    const other = '22222222-2222-2222-2222-222222222222'
    await db.exec(`insert into auth.users (id, email) values ('${other}', 'nobody@x.test');`)
    await asUser(db, other)
    const r = await db.query(`select * from get_auth_context();`)
    expect(r.rows.length).toBe(0)
  })
})

describe('access control (Phase 2)', () => {
  let db: PGlite
  const owner = OWNER
  const member = '33333333-3333-3333-3333-333333333333'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@s.test'),('${member}','member@s.test');`,
    )
    // Owner registers the studio, then adds a member (admin) to the same company.
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'admin', 'Member', 'member@s.test');`,
    )
  })

  it('owner assigns a profile + override; it flows into the member auth context', async () => {
    await asUser(db, owner)
    await db.query(
      `select set_user_access('${member}', 'finance_manager',
         '[{"permission_key":"clients.edit","enabled":true}]'::jsonb);`,
    )

    // Read back as owner.
    const ga = await db.query<{ profile_key: string; overrides: unknown[] }>(
      `select * from get_user_access('${member}');`,
    )
    expect(ga.rows[0]?.profile_key).toBe('finance_manager')
    expect(ga.rows[0]?.overrides).toHaveLength(1)

    // The member's own auth context reflects it.
    await asUser(db, member)
    const ctx = await db.query<{ profile_key: string; overrides: { permission_key: string }[] }>(
      `select * from get_auth_context();`,
    )
    expect(ctx.rows[0]?.profile_key).toBe('finance_manager')
    expect(ctx.rows[0]?.overrides?.[0]?.permission_key).toBe('clients.edit')
  })

  it('a non-owner cannot call set_user_access', async () => {
    await asUser(db, member) // admin, not owner
    await expect(
      db.query(`select set_user_access('${owner}', 'photographer');`),
    ).rejects.toThrow(/owner/i)
  })

  it('clearing the profile (null) drops back to role defaults', async () => {
    await asUser(db, owner)
    await db.query(`select set_user_access('${member}', null, '[]'::jsonb);`)
    await asUser(db, member)
    const ctx = await db.query<{ profile_key: string | null }>(`select * from get_auth_context();`)
    expect(ctx.rows[0]?.profile_key).toBeNull()
  })
})

describe('projects core (Phase 4)', () => {
  let db: PGlite
  let clientId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    const c = await db.query<{ id: string }>(
      `insert into clients (company_id, name) values (get_current_company_id(), 'Wedding Co')
       returning id;`,
    )
    clientId = c.rows[0]!.id
  })

  async function totals(projectId: string) {
    const r = await db.query<{ additional_deliverables_cost: string; total_cost: string }>(
      `select additional_deliverables_cost, total_cost from projects where id = '${projectId}';`,
    )
    return {
      additional: Number(r.rows[0]!.additional_deliverables_cost),
      total: Number(r.rows[0]!.total_cost),
    }
  }

  it('create_project_with_details computes totals from qualifying deliverables only', async () => {
    const r = await db.query<{ id: string }>(
      `select create_project_with_details(
         '${clientId}', 'Sharma Wedding', 50000, 'active', true,
         '[
           {"title":"Album","is_additional_charge":true,"additional_charge_amount":5000},
           {"title":"Extra film","is_additional_charge":true,"additional_charge_amount":3000},
           {"title":"Internal cut","visibility_scope":"internal","is_additional_charge":true,"additional_charge_amount":9999},
           {"title":"Free teaser","is_additional_charge":false,"additional_charge_amount":9999}
         ]'::jsonb,
         '[{"amount":20000,"mode":"upi"}]'::jsonb
       ) as id;`,
    )
    const projectId = r.rows[0]!.id
    const t = await totals(projectId)
    expect(t.additional).toBe(8000) // 5000 + 3000 only
    expect(t.total).toBe(58000) // package 50000 + 8000

    const pay = await db.query<{ n: string }>(
      `select count(*) as n from received_payments where project_id = '${projectId}';`,
    )
    expect(Number(pay.rows[0]!.n)).toBe(1)
  })

  // Smoke-tests the hand-written router SQL (list JOIN + detail double jsonb_agg)
  // that replaced PostgREST embeds — catches column/shape typos without a live PG.
  it('router SQL: list joins client_name; detail nests deliverables + payments', async () => {
    const r = await db.query<{ id: string }>(
      `select create_project_with_details(
         '${clientId}', 'Smoke Wedding', 40000, 'active', true,
         '[{"title":"Album","is_additional_charge":true,"additional_charge_amount":6000}]'::jsonb,
         '[{"amount":15000,"mode":"upi","reference":"TXN1"}]'::jsonb
       ) as id;`,
    )
    const projectId = r.rows[0]!.id

    const listRow = await db.query<{ client_name: string; total_cost: string }>(
      `select p.id, p.name, cl.name as client_name, p.total_cost
       from projects p left join clients cl on cl.id = p.client_id
       where p.id = '${projectId}';`,
    )
    expect(listRow.rows[0]!.client_name).toBe('Wedding Co')

    const detail = await db.query<{ deliverables: unknown[]; payments: { amount: number }[] }>(
      `select p.id,
         coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at)
                   from deliverables d where d.project_id = p.id), '[]'::jsonb) as deliverables,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', rp.id, 'amount', rp.amount, 'paid_on', rp.paid_on,
                     'mode', rp.mode, 'reference', rp.reference) order by rp.paid_on)
                   from received_payments rp where rp.project_id = p.id), '[]'::jsonb) as payments
       from projects p where p.id = '${projectId}';`,
    )
    expect(detail.rows[0]!.deliverables).toHaveLength(1)
    expect(detail.rows[0]!.payments).toHaveLength(1)
    expect(Number(detail.rows[0]!.payments[0]!.amount)).toBe(15000)
  })

  it('trigger keeps totals correct when a deliverable is added, edited, deleted', async () => {
    const r = await db.query<{ id: string }>(
      `select create_project_with_details('${clientId}','Edit Test', 10000) as id;`,
    )
    const p = r.rows[0]!.id
    expect((await totals(p)).total).toBe(10000)

    // add a qualifying deliverable
    await db.query(
      `insert into deliverables (company_id, project_id, title, is_additional_charge, additional_charge_amount)
       values (get_current_company_id(), '${p}', 'Drone', true, 4000);`,
    )
    expect(await totals(p)).toEqual({ additional: 4000, total: 14000 })

    // demote it to non-charge -> drops out
    await db.query(`update deliverables set is_additional_charge = false where project_id = '${p}';`)
    expect(await totals(p)).toEqual({ additional: 0, total: 10000 })

    // re-charge then delete -> back to base
    await db.query(
      `update deliverables set is_additional_charge = true, additional_charge_amount = 2500 where project_id = '${p}';`,
    )
    expect((await totals(p)).total).toBe(12500)
    await db.query(`delete from deliverables where project_id = '${p}';`)
    expect((await totals(p)).total).toBe(10000)
  })

  it('rejects a client from another studio', async () => {
    await expect(
      db.query(`select create_project_with_details('${OWNER}', 'Bad', 1000);`),
    ).rejects.toThrow(/client not in this studio/i)
  })
})

describe('tasks & production board (Phase 5)', () => {
  let db: PGlite
  let projectId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    const c = await db.query<{ id: string }>(
      `insert into clients (company_id, name) values (get_current_company_id(), 'C') returning id;`,
    )
    const r = await db.query<{ id: string }>(
      `select create_project_with_details('${c.rows[0]!.id}', 'Proj', 10000, 'active', false,
        '[{"title":"Album"},{"title":"Film"},{"title":"Teaser"}]'::jsonb) as id;`,
    )
    projectId = r.rows[0]!.id
  })

  it('generate_tasks_for_project_deliverables makes one task per deliverable', async () => {
    const ids = await db.query<{ id: string }>(
      `select generate_tasks_for_project_deliverables('${projectId}') as id;`,
    )
    expect(ids.rows).toHaveLength(3)

    // Idempotent-ish: re-running skips deliverables that already have a task.
    const again = await db.query(
      `select generate_tasks_for_project_deliverables('${projectId}') as id;`,
    )
    expect(again.rows).toHaveLength(0)

    const count = await db.query<{ n: string }>(
      `select count(*) as n from tasks where project_id = '${projectId}';`,
    )
    expect(Number(count.rows[0]!.n)).toBe(3)
  })

  it('board lane order persists and survives a re-read', async () => {
    const tasks = await db.query<{ id: string }>(
      `select id from tasks where project_id = '${projectId}' order by created_at;`,
    )
    const ids = tasks.rows.map((t) => t.id)
    // Save a specific order (reverse), as a drag would.
    const reversed = [...ids].reverse()
    await db.query(
      `select set_board_lane_order('default', 'to_do', array['${reversed.join("','")}']::uuid[]);`,
    )

    const order = await db.query<{ task_id: string; sort_order: number }>(
      `select task_id, sort_order from production_board_card_order
       where lane_key = 'to_do' order by sort_order;`,
    )
    expect(order.rows.map((o) => o.task_id)).toEqual(reversed)
    expect(order.rows.map((o) => o.sort_order)).toEqual([0, 1, 2])
  })

  it('employee can update status of their own task, not others', async () => {
    const emp = '55555555-5555-5555-5555-555555555555'
    await db.exec(`insert into auth.users (id, email) values ('${emp}', 'emp@s.test');`)
    await asUser(db, OWNER)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${emp}', get_current_company_id(), 'employee', 'Emp', 'emp@s.test');`,
    )
    const task = await db.query<{ id: string }>(
      `select id from tasks where project_id = '${projectId}' limit 1;`,
    )
    const taskId = task.rows[0]!.id
    await db.query(`select create_task_with_assignees(null, null, 'X') ;`) // unassigned control
    await db.exec(
      `insert into task_assignees (task_id, user_id, company_id)
       values ('${taskId}', '${emp}', get_current_company_id());`,
    )

    await asUser(db, emp)
    await db.query(`select update_my_task_status('${taskId}', 'in_progress');`)
    const t = await db.query<{ status: string }>(`select status from tasks where id = '${taskId}';`)
    expect(t.rows[0]!.status).toBe('in_progress')
    // Done is not the assignee's to say: it comes from review (0192).
    await expect(db.query(`select update_my_task_status('${taskId}', 'completed');`)).rejects.toThrow(/marks it done/)

    // A task not assigned to the employee is rejected.
    await asUser(db, OWNER)
    const other = await db.query<{ id: string }>(
      `select id from tasks where project_id = '${projectId}' and id <> '${taskId}' limit 1;`,
    )
    await asUser(db, emp)
    await expect(
      db.query(`select update_my_task_status('${other.rows[0]!.id}', 'completed');`),
    ).rejects.toThrow(/not your task/i)
  })
})

describe('team allocation — no double booking (Phase 6)', () => {
  let db: PGlite
  const member = '66666666-6666-6666-6666-666666666666'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(`insert into auth.users (id,email) values ('${member}','m@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Shooter', 'm@s.test');`,
    )
  })

  it('books a slot, then rejects an overlapping booking for the same member', async () => {
    await db.query(
      `select book_team_slot('${member}', null, 'Photographer',
        '2026-07-01T10:00:00Z', '2026-07-01T14:00:00Z', 5000);`,
    )
    await expect(
      db.query(
        `select book_team_slot('${member}', null, 'Photographer',
          '2026-07-01T12:00:00Z', '2026-07-01T16:00:00Z', 5000);`,
      ),
    ).rejects.toThrow(/double_booking/i)
  })

  it('allows a back-to-back booking (touching edges)', async () => {
    const r = await db.query<{ book_team_slot: string }>(
      `select book_team_slot('${member}', null, 'Photographer',
        '2026-07-01T14:00:00Z', '2026-07-01T16:00:00Z', 5000);`,
    )
    expect(r.rows[0]!.book_team_slot).toBeTruthy()
  })

  it('a released slot no longer blocks that window', async () => {
    // Release the 10-14 booking, then the overlapping 12-16 becomes bookable.
    await db.query(
      `select set_team_slot_status(id, 'released') from team_assignment_slots
       where start_at = '2026-07-01T10:00:00Z';`,
    )
    const r = await db.query<{ book_team_slot: string }>(
      `select book_team_slot('${member}', null, 'Editor',
        '2026-07-01T11:00:00Z', '2026-07-01T13:00:00Z', 3000);`,
    )
    expect(r.rows[0]!.book_team_slot).toBeTruthy()
  })
})

describe('data custody (Phase 7)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('tracks a card through primary + backup to verified with attribution', async () => {
    const loc = await db.query<{ id: string }>(
      `insert into storage_locations (company_id, name, kind)
       values (get_current_company_id(), 'RAID-1', 'nas') returning id;`,
    )
    const rec = await db.query<{ id: string }>(
      `insert into shoot_data_records (company_id, data_label, card_count, size_gb,
         primary_status, primary_location_id, copied_by_uid)
       values (get_current_company_id(), 'CF Card A', 2, 64.5, 'copied', '${loc.rows[0]!.id}', auth.uid())
       returning id;`,
    )
    const id = rec.rows[0]!.id

    // Verify primary only — record is not fully verified yet.
    await db.query(`select verify_data_record('${id}', 'primary');`)
    let row = await db.query<{ primary_status: string; verified_at: string | null }>(
      `select primary_status, verified_at from shoot_data_records where id = '${id}';`,
    )
    expect(row.rows[0]!.primary_status).toBe('verified')
    expect(row.rows[0]!.verified_at).toBeNull()

    // Copy + verify backup — now verified_at stamps.
    // A backup copy says where it went (0173).
    await db.query(`update shoot_data_records set backup_status = 'copied', backup_folder_path = '/backup/CF-A' where id = '${id}';`)
    await db.query(`select verify_data_record('${id}', 'backup');`)
    row = await db.query(
      `select primary_status, backup_status, verified_at, copied_by_uid from shoot_data_records where id = '${id}';`,
    )
    expect((row.rows[0] as { backup_status: string }).backup_status).toBe('verified')
    expect((row.rows[0] as { verified_at: string | null }).verified_at).not.toBeNull()
    expect((row.rows[0] as { copied_by_uid: string }).copied_by_uid).toBe(OWNER)
  })
})

describe('work submission -> review -> tokenised delivery (Phase 8)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
  })

  it('runs submit -> approve -> deliver, and the token resolves to the submission', async () => {
    const sub = await db.query<{ submit_work: string }>(
      `select submit_work(null, null, 'https://drive/x', 'first cut');`,
    )
    const subId = sub.rows[0]!.submit_work

    // 0115 relaxed this deliberately: a studio can send the client work that
    // is still 'submitted', and the submission becomes 'sent'. Only a REJECTED
    // one is refused. (Before 0155 this path raised a check-constraint
    // violation instead, because 'sent' was not an allowed status.)
    const early = await db.query<{ deliver_work_to_client: string }>(
      `select deliver_work_to_client('${subId}') as deliver_work_to_client;`,
    )
    expect(early.rows[0]!.deliver_work_to_client).toBeTruthy()
    expect(
      (await db.query<{ status: string }>(`select status from team_work_submissions where id = '${subId}';`))
        .rows[0]!.status,
    ).toBe('sent')

    await db.query(`select review_work('${subId}', true, 'looks good');`)
    const token = await db.query<{ deliver_work_to_client: string }>(
      `select deliver_work_to_client('${subId}', 'email', 168);`,
    )
    const raw = token.rows[0]!.deliver_work_to_client
    expect(raw).toBeTruthy()

    // Public resolution (anon path) returns the submission id.
    const resolved = await db.query<{ resolve_access_token: string }>(
      `select resolve_access_token('work_delivery', '${raw}');`,
    )
    expect(resolved.rows[0]!.resolve_access_token).toBe(subId)

    // A wrong token resolves to nothing.
    const bad = await db.query<{ resolve_access_token: string | null }>(
      `select resolve_access_token('work_delivery', 'not-a-real-token');`,
    )
    expect(bad.rows[0]!.resolve_access_token).toBeNull()

    // One row per send, and this submission was sent twice — once while still
    // submitted, once after approval. Each delivery is its own record with its
    // own token and expiry, which is what makes "when did we send this, and
    // which link did they open" answerable.
    const del = await db.query<{ n: string }>(
      `select count(*) as n from team_work_client_deliveries where submission_id = '${subId}';`,
    )
    expect(Number(del.rows[0]!.n)).toBe(2)
  })

  it('consume_access_token is one-time', async () => {
    const sub = await db.query<{ submit_work: string }>(
      `select submit_work(null, null, 'https://drive/y');`,
    )
    const subId = sub.rows[0]!.submit_work
    await db.query(`select review_work('${subId}', true);`)
    const raw = (
      await db.query<{ deliver_work_to_client: string }>(
        `select deliver_work_to_client('${subId}');`,
      )
    ).rows[0]!.deliver_work_to_client

    const first = await db.query<{ consume_access_token: string | null }>(
      `select consume_access_token('work_delivery', '${raw}');`,
    )
    expect(first.rows[0]!.consume_access_token).toBe(subId)
    const second = await db.query<{ consume_access_token: string | null }>(
      `select consume_access_token('work_delivery', '${raw}');`,
    )
    expect(second.rows[0]!.consume_access_token).toBeNull()
  })
})

describe('billing & invoicing (Phase 9)', () => {
  let db: PGlite
  let clientId: string
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days', state = 'Maharashtra'
       where id = get_current_company_id();`,
    )
    const c = await db.query<{ id: string }>(
      `insert into clients (company_id, name) values (get_current_company_id(), 'C') returning id;`,
    )
    clientId = c.rows[0]!.id
  })

  it('assigns sequential invoice numbers and persists totals', async () => {
    const items = JSON.stringify([
      { description: 'Photography', quantity: 1, rate: 100000, amount: 100000, gst_rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 },
    ])
    const r1 = await db.query<{ id: string; invoice_number: string }>(
      `select * from create_invoice('${clientId}', null, '27', current_date, null,
        100000, 0, 100000, 18000, 118000, '${items}'::jsonb, null);`,
    )
    expect(r1.rows[0]!.invoice_number).toBe('INV-0001')

    const r2 = await db.query<{ invoice_number: string }>(
      `select * from create_invoice('${clientId}', null, '27', current_date, null,
        100000, 0, 100000, 18000, 118000, '${items}'::jsonb, null);`,
    )
    expect(r2.rows[0]!.invoice_number).toBe('INV-0002')

    const inv = await db.query<{ total: string; balance_due: string; status: string }>(
      `select total, balance_due, status from invoices where id = '${r1.rows[0]!.id}';`,
    )
    expect(Number(inv.rows[0]!.total)).toBe(118000)
    expect(Number(inv.rows[0]!.balance_due)).toBe(118000)

    const it = await db.query<{ n: string }>(
      `select count(*) as n from invoice_items where invoice_id = '${r1.rows[0]!.id}';`,
    )
    expect(Number(it.rows[0]!.n)).toBe(1)
  })

  it('a custom invoice number does not consume the auto-numbered sequence, and a duplicate is refused', async () => {
    const items = JSON.stringify([
      { description: 'Custom-numbered', quantity: 1, rate: 1000, amount: 1000, gst_rate: 0, taxable: 1000, cgst: 0, sgst: 0, igst: 0 },
    ])
    const custom = await db.query<{ invoice_number: string }>(`
      select * from create_invoice(
        p_client_id => '${clientId}', p_project_id => null, p_place_of_supply => '27',
        p_invoice_date => current_date, p_due_date => null,
        p_subtotal => 1000, p_discount => 0, p_taxable => 1000, p_tax => 0, p_total => 1000,
        p_items => '${items}'::jsonb, p_invoice_number => 'CUSTOM-001'
      );`)
    expect(custom.rows[0]!.invoice_number).toBe('CUSTOM-001')

    const auto = await db.query<{ invoice_number: string }>(
      `select * from create_invoice('${clientId}', null, '27', current_date, null,
        1000, 0, 1000, 0, 1000, '${items}'::jsonb, null);`,
    )
    // Still the next sequential number -- the custom one above did not burn a slot.
    expect(auto.rows[0]!.invoice_number).toBe('INV-0003')

    await expect(
      db.query(`
        select * from create_invoice(
          p_client_id => '${clientId}', p_project_id => null, p_place_of_supply => '27',
          p_invoice_date => current_date, p_due_date => null,
          p_subtotal => 1000, p_discount => 0, p_taxable => 1000, p_tax => 0, p_total => 1000,
          p_items => '${items}'::jsonb, p_invoice_number => 'CUSTOM-001'
        );`),
    ).rejects.toThrow()
  })

  it('a line item keeps its subtext underneath the description, and an old line without one round-trips as null', async () => {
    const items = JSON.stringify([
      { description: 'Wedding Photography Package', subtext: 'Haldi + Wedding + Reception coverage', quantity: 1, rate: 1000, amount: 1000, gst_rate: 0, taxable: 1000, cgst: 0, sgst: 0, igst: 0 },
      { description: 'Travel Charges', quantity: 1, rate: 500, amount: 500, gst_rate: 0, taxable: 500, cgst: 0, sgst: 0, igst: 0 },
    ])
    const inv = await db.query<{ id: string }>(`
      select * from create_invoice(
        p_client_id => '${clientId}', p_project_id => null, p_place_of_supply => '27',
        p_invoice_date => current_date, p_due_date => null,
        p_subtotal => 1500, p_discount => 0, p_taxable => 1500, p_tax => 0, p_total => 1500,
        p_items => '${items}'::jsonb
      );`)
    const rows = await db.query<{ description: string; subtext: string | null }>(
      `select description, subtext from invoice_items where invoice_id = '${inv.rows[0]!.id}' order by sort_order;`,
    )
    expect(rows.rows).toEqual([
      { description: 'Wedding Photography Package', subtext: 'Haldi + Wedding + Reception coverage' },
      { description: 'Travel Charges', subtext: null },
    ])
  })

  it('records payments and moves status partial -> paid', async () => {
    const items = JSON.stringify([
      { description: 'Album', quantity: 1, rate: 10000, amount: 10000, gst_rate: 12, taxable: 10000, cgst: 600, sgst: 600, igst: 0 },
    ])
    const inv = await db.query<{ id: string }>(
      `select id from create_invoice('${clientId}', null, '27', current_date, null,
        10000, 0, 10000, 1200, 11200, '${items}'::jsonb, null);`,
    )
    const id = inv.rows[0]!.id

    await db.query(`select record_invoice_payment('${id}', 5000, current_date, 'upi', 'A1');`)
    let row = await db.query<{ status: string; balance_due: string }>(
      `select status, balance_due from invoices where id = '${id}';`,
    )
    expect(row.rows[0]!.status).toBe('partial')
    expect(Number(row.rows[0]!.balance_due)).toBe(6200)

    await db.query(`select record_invoice_payment('${id}', 6200, current_date, 'cash', 'A2');`)
    row = await db.query(`select status, balance_due from invoices where id = '${id}';`)
    expect(row.rows[0]!.status).toBe('paid')
    expect(Number(row.rows[0]!.balance_due)).toBe(0)
  })

  it('a mistake on a freshly created invoice -- wrong client, wrong line item -- can still be corrected', async () => {
    const wrongClient = await db.query<{ id: string }>(
      `insert into clients (company_id, name) values (get_current_company_id(), 'Wrong Client') returning id;`,
    )
    const items = JSON.stringify([
      { description: 'Typo Package', quantity: 1, rate: 5000, amount: 5000, gst_rate: 18, taxable: 5000, cgst: 450, sgst: 450, igst: 0 },
    ])
    const inv = await db.query<{ id: string }>(
      `select id from create_invoice('${wrongClient.rows[0]!.id}', null, '27', current_date, null,
        5000, 0, 5000, 900, 5900, '${items}'::jsonb, 'v1');`,
    )
    const id = inv.rows[0]!.id

    const newItems = JSON.stringify([
      { description: 'Wedding Package', quantity: 1, rate: 100000, amount: 100000, gst_rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 },
    ])
    await db.query(`
      select update_invoice(
        p_invoice_id => '${id}', p_client_id => '${clientId}', p_project_id => null,
        p_place_of_supply => '27', p_intra_state => true, p_invoice_date => null, p_due_date => null,
        p_subtotal => 100000, p_discount => 0, p_taxable => 100000, p_tax => 18000, p_total => 118000,
        p_items => '${newItems}'::jsonb, p_notes => 'v2'
      );
    `)
    const row = await db.query<{ client_id: string; total: string; notes: string }>(
      `select client_id, total, notes from invoices where id = '${id}';`,
    )
    expect(row.rows[0]).toEqual({ client_id: clientId, total: '118000.00', notes: 'v2' })
    const lineItems = await db.query<{ description: string }>(`select description from invoice_items where invoice_id = '${id}';`)
    expect(lineItems.rows.map((r) => r.description)).toEqual(['Wedding Package'])
  })

  it('an invoice with a recorded payment can no longer be edited or deleted', async () => {
    const items = JSON.stringify([
      { description: 'Retainer', quantity: 1, rate: 20000, amount: 20000, gst_rate: 18, taxable: 20000, cgst: 1800, sgst: 1800, igst: 0 },
    ])
    const inv = await db.query<{ id: string }>(
      `select id from create_invoice('${clientId}', null, '27', current_date, null,
        20000, 0, 20000, 3600, 23600, '${items}'::jsonb, null);`,
    )
    const id = inv.rows[0]!.id
    await db.query(`select record_invoice_payment('${id}', 5000);`)

    await expect(
      db.query(`
        select update_invoice(
          p_invoice_id => '${id}', p_client_id => '${clientId}', p_project_id => null,
          p_place_of_supply => '27', p_intra_state => true, p_invoice_date => null, p_due_date => null,
          p_subtotal => 0, p_discount => 0, p_taxable => 0, p_tax => 0, p_total => 0,
          p_items => '[]'::jsonb, p_notes => null
        );
      `),
    ).rejects.toThrow(/cannot be edited/)

    // The API's delete guard mirrors update_invoice's own rule (amount_paid = 0).
    const attempted = await db.query(`delete from invoices where id = '${id}' and amount_paid = 0 returning id;`)
    expect(attempted.rows.length).toBe(0)
    const stillThere = await db.query(`select id from invoices where id = '${id}';`)
    expect(stillThere.rows.length).toBe(1)
  })

  it('an invoice can be created and edited with a template, and the old no-template call shape still works', async () => {
    const companyId = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const tpl = await db.query<{ id: string }>(
      `insert into invoice_templates (company_id, name, layout_json)
       values ('${companyId}', 'Letterhead', '{"show_header": false}'::jsonb) returning id;`,
    )
    const templateId = tpl.rows[0]!.id

    // The pre-0078 call shape (no p_template_id) must still resolve unambiguously.
    const untemplated = await db.query<{ id: string }>(`
      select * from create_invoice(
        p_client_id => '${clientId}', p_project_id => null, p_place_of_supply => '27',
        p_invoice_date => null, p_due_date => null,
        p_subtotal => 1000, p_discount => 0, p_taxable => 1000, p_tax => 180, p_total => 1180,
        p_items => '[]'::jsonb, p_notes => 'no template'
      );
    `)
    expect(
      (await db.query<{ template_id: string | null }>(`select template_id from invoices where id = '${untemplated.rows[0]!.id}';`)).rows[0]!
        .template_id,
    ).toBeNull()

    const created = await db.query<{ id: string }>(`
      select * from create_invoice(
        p_client_id => '${clientId}', p_project_id => null, p_place_of_supply => '27',
        p_invoice_date => null, p_due_date => null,
        p_subtotal => 1000, p_discount => 0, p_taxable => 1000, p_tax => 180, p_total => 1180,
        p_items => '[]'::jsonb, p_notes => 'with template', p_template_id => '${templateId}'
      );
    `)
    const id = created.rows[0]!.id
    expect((await db.query<{ template_id: string }>(`select template_id from invoices where id = '${id}';`)).rows[0]!.template_id).toBe(
      templateId,
    )

    await db.query(`
      select update_invoice(
        p_invoice_id => '${id}', p_client_id => '${clientId}', p_project_id => null,
        p_place_of_supply => '27', p_intra_state => true, p_invoice_date => null, p_due_date => null,
        p_subtotal => 2000, p_discount => 0, p_taxable => 2000, p_tax => 360, p_total => 2360,
        p_items => '[]'::jsonb, p_notes => 'template cleared', p_template_id => null
      );
    `)
    expect((await db.query<{ template_id: string | null }>(`select template_id from invoices where id = '${id}';`)).rows[0]!.template_id).toBeNull()
  })

  it("an invoice's template resolves to its own choice, else falls back to the company default", async () => {
    const companyId = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`update invoice_templates set is_default = false where company_id = '${companyId}';`)
    await db.exec(
      `insert into invoice_templates (company_id, name, layout_json, is_default)
       values ('${companyId}', 'Default Layout', '{"show_gst": true}'::jsonb, true);`,
    )
    const own = await db.query<{ id: string }>(
      `insert into invoice_templates (company_id, name, layout_json)
       values ('${companyId}', 'No GST Layout', '{"show_gst": false}'::jsonb) returning id;`,
    )

    const withOwn = await db.query<{ id: string }>(`
      select * from create_invoice(
        p_client_id => '${clientId}', p_project_id => null, p_place_of_supply => '27',
        p_invoice_date => null, p_due_date => null, p_subtotal => 500, p_discount => 0,
        p_taxable => 500, p_tax => 0, p_total => 500, p_items => '[]'::jsonb,
        p_notes => null, p_template_id => '${own.rows[0]!.id}'
      );
    `)
    const withoutOwn = await db.query<{ id: string }>(`
      select * from create_invoice(
        p_client_id => '${clientId}', p_project_id => null, p_place_of_supply => '27',
        p_invoice_date => null, p_due_date => null, p_subtotal => 500, p_discount => 0,
        p_taxable => 500, p_tax => 0, p_total => 500, p_items => '[]'::jsonb, p_notes => null
      );
    `)

    const resolve = async (invoiceId: string) =>
      (
        await db.query<{ show_gst_text: string }>(`
          select coalesce(
            (select it.layout_json from invoice_templates it where it.id = i.template_id),
            (select it.layout_json from invoice_templates it where it.company_id = i.company_id and it.is_default = true limit 1)
          ) ->> 'show_gst' as show_gst_text
          from invoices i where i.id = '${invoiceId}';
        `)
      ).rows[0]!.show_gst_text

    expect(await resolve(withOwn.rows[0]!.id)).toBe('false')
    expect(await resolve(withoutOwn.rows[0]!.id)).toBe('true')
  })

  it('a Notes snippet library sits alongside print-layout templates, independent of them', async () => {
    const companyId = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const a = await db.query<{ id: string }>(
      `insert into invoice_note_templates (company_id, title, content, is_default)
       values ('${companyId}', 'Standard terms', 'Payment due within 15 days.', true) returning id;`,
    )
    await db.exec(
      `insert into invoice_note_templates (company_id, title, content) values ('${companyId}', 'Thank you note', 'Thank you for booking with us!');`,
    )
    const active = await db.query<{ title: string }>(
      `select title from invoice_note_templates where company_id = '${companyId}' and is_active = true order by is_default desc, created_at desc;`,
    )
    expect(active.rows.map((r) => r.title)).toEqual(['Standard terms', 'Thank you note'])

    // Soft-deleted, not gone -- an invoice that already used its text keeps meaning what it said.
    await db.exec(`update invoice_note_templates set is_active = false where id = '${a.rows[0]!.id}';`)
    const stillActive = await db.query<{ title: string }>(
      `select title from invoice_note_templates where company_id = '${companyId}' and is_active = true;`,
    )
    expect(stillActive.rows.map((r) => r.title)).toEqual(['Thank you note'])
    const row = await db.query<{ content: string }>(`select content from invoice_note_templates where id = '${a.rows[0]!.id}';`)
    expect(row.rows[0]!.content).toBe('Payment due within 15 days.')
  })
})

describe('financials — profit view (Phase 10)', () => {
  let db: PGlite
  let projectId: string
  const member = '77777777-7777-7777-7777-777777777777'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
    await db.exec(`insert into auth.users (id,email) values ('${member}','m@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Shooter', 'm@s.test');`,
    )
    const c = await db.query<{ id: string }>(
      `insert into clients (company_id, name) values (get_current_company_id(), 'C') returning id;`,
    )
    const r = await db.query<{ id: string }>(
      `select create_project_with_details('${c.rows[0]!.id}', 'Proj', 200000) as id;`,
    )
    projectId = r.rows[0]!.id
  })

  it('reproduces Gross Profit = revenue - direct team cost - project expenses', async () => {
    // A shoot + a booked slot (direct team cost) + a project expense.
    const shoot = await db.query<{ id: string }>(
      `insert into shoots (company_id, project_id, name) values (get_current_company_id(), '${projectId}', 'Day 1') returning id;`,
    )
    await db.query(
      `select book_team_slot('${member}', '${shoot.rows[0]!.id}', 'Photographer',
        '2026-08-01T04:00:00Z', '2026-08-01T12:00:00Z', 40000);`,
    )
    await db.exec(
      `insert into expenses (company_id, project_id, category, amount)
       values (get_current_company_id(), '${projectId}', 'Travel', 15000);`,
    )

    const f = await db.query<{ revenue: string; direct_team_cost: string; project_expenses: string }>(
      `select revenue, direct_team_cost, project_expenses from project_financials where project_id = '${projectId}';`,
    )
    const row = f.rows[0]!
    expect(Number(row.revenue)).toBe(200000)
    expect(Number(row.direct_team_cost)).toBe(40000)
    expect(Number(row.project_expenses)).toBe(15000)
    // gross = 200000 - 40000 - 15000 = 145000
    expect(Number(row.revenue) - Number(row.direct_team_cost) - Number(row.project_expenses)).toBe(145000)
  })

  it('a cancelled slot is excluded from direct team cost', async () => {
    await db.query(
      `select set_team_slot_status(id, 'cancelled') from team_assignment_slots
       where company_id = get_current_company_id();`,
    )
    const f = await db.query<{ direct_team_cost: string }>(
      `select direct_team_cost from project_financials where project_id = '${projectId}';`,
    )
    expect(Number(f.rows[0]!.direct_team_cost)).toBe(0)
  })
})

describe('CRM — capture, dedupe, auto-assign (Phase 11)', () => {
  let db: PGlite
  const a = '88888888-8888-8888-8888-888888888888'
  const b = '99999999-9999-9999-9999-999999999999'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    for (const [id, name] of [
      [a, 'Sales A'],
      [b, 'Sales B'],
    ]) {
      await db.exec(`insert into auth.users (id,email) values ('${id}','${id}@s.test');`)
      await db.exec(
        `insert into users (user_id, company_id, role, name, email)
         values ('${id}', get_current_company_id(), 'employee', '${name}', '${id}@s.test');`,
      )
      await db.exec(
        `insert into crm_distribution_rules (company_id, user_id) values (get_current_company_id(), '${id}');`,
      )
    }
    await db.exec(
      `insert into crm_webhook_sources (company_id, source_key, kind)
       values (get_current_company_id(), 'meta-page-1', 'meta');`,
    )
  })

  it('a Meta lead flows to an assigned CRM lead, balanced across the team', async () => {
    const l1 = await db.query<{ capture_lead: string }>(
      `select capture_lead('meta-page-1', 'Lead One', '9876500001', 'one@x.in',
        '{"ad":"summer"}'::jsonb);`,
    )
    const l2 = await db.query<{ capture_lead: string }>(
      `select capture_lead('meta-page-1', 'Lead Two', '9876500002');`,
    )
    const rows = await db.query<{ source: string; assigned_to: string; status: string }>(
      `select source, assigned_to, status from crm_leads order by created_at;`,
    )
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows[0]!.source).toBe('facebook')
    expect(rows.rows[0]!.status).toBe('new')
    // Balanced: the two leads go to two different assignees.
    expect(rows.rows[0]!.assigned_to).not.toBe(rows.rows[1]!.assigned_to)
    expect(l1.rows[0]!.capture_lead).not.toBe(l2.rows[0]!.capture_lead)
  })

  it('dedupes on normalized phone (10-digit vs +91 form)', async () => {
    const first = await db.query<{ capture_lead: string }>(
      `select capture_lead('meta-page-1', 'Dup', '9876511111');`,
    )
    const dup = await db.query<{ capture_lead: string }>(
      `select capture_lead('meta-page-1', 'Dup Again', '+91 98765 11111');`,
    )
    expect(dup.rows[0]!.capture_lead).toBe(first.rows[0]!.capture_lead)
  })

  it('rejects an unknown source key', async () => {
    await expect(db.query(`select capture_lead('nope', 'X', '9000000000');`)).rejects.toThrow(
      /unknown or inactive source/i,
    )
  })
})

describe('HR — geo-fenced attendance + payout ledger (Phase 12)', () => {
  let db: PGlite
  const emp = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  // Studio at Mumbai; a point ~50m away and one ~15km away.
  const STUDIO = { lat: 19.076, lng: 72.8777 }

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
    await db.exec(
      `insert into company_location (company_id, lat, lng, radius_m)
       values (get_current_company_id(), ${STUDIO.lat}, ${STUDIO.lng}, 150);`,
    )
    await db.exec(`insert into auth.users (id,email) values ('${emp}','emp@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${emp}', get_current_company_id(), 'employee', 'Emp', 'emp@s.test');`,
    )
  })

  it('checks in inside the fence and is blocked outside it', async () => {
    await asUser(db, emp)
    const ok = await db.query<{ check_in: string }>(`select check_in(19.0764, 72.8777);`) // ~44m
    expect(ok.rows[0]!.check_in).toBeTruthy()

    // Reset the day would need a new date; instead a far point on a fresh member.
    await expect(db.query(`select check_in(19.2, 72.9);`)).rejects.toThrow(/outside_fence/i)
  })

  it('absent backstop never marks the owner, nor overwrites a day someone worked', async () => {
    // The owner does not check in to their own studio (0176), and the sweep
    // marks the day that has just ended, never the one someone is working.
    await db.query(`select mark_absent_backstop();`)
    await asUser(db, OWNER)
    const rows = await db.query<{ status: string }>(
      `select status from attendance where user_id = '${OWNER}';`,
    )
    expect(rows.rows).toHaveLength(0)
    const e = await db.query<{ status: string }>(
      `select status from attendance where user_id = '${emp}';`,
    )
    expect(e.rows[0]?.status).toBe('present')
  })

  /**
   * The per-member credit/debit ledger from 0014 is gone.
   *
   * settle_payout() and payout_balance() wrote and read team_payout_settlements,
   * a ledger nothing in the API or the web app has touched since team payouts
   * moved to being settled per BOOKING SLOT. 0143 dropped both functions after
   * confirming they had no caller, and commented the table SUPERSEDED rather
   * than dropping it, because a table drop cannot be undone.
   *
   * The two tests that stood here exercised those functions. They are not
   * replaced by weaker assertions — the live ledger is covered in full by
   * "team payout settlements (0090)" further down this file, which tests
   * partial payment, over-collection, reversal, the paid-total aggregate and
   * the adjustment exemption against team_slot_settlements.
   *
   * What is worth asserting here is that the retired pair really is gone, so
   * nobody reintroduces a second money ledger by restoring one of them.
   */
  it('the superseded per-member payout ledger functions are gone', async () => {
    const left = await db.query<{ proname: string }>(
      `select proname from pg_proc
        where proname in ('settle_payout', 'payout_balance')
          and pronamespace = 'public'::regnamespace;`,
    )
    expect(left.rows.map((r) => r.proname)).toEqual([])
  })
})

describe('notifications & idempotent cron (Phase 13)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
    // A due reminder + a future one.
    await db.exec(
      `insert into reminders (company_id, user_id, title, due_at)
       values (get_current_company_id(), '${OWNER}', 'Call client', now() - interval '1 hour'),
              (get_current_company_id(), '${OWNER}', 'Later task', now() + interval '2 days');`,
    )
  })

  it('cron is idempotent on re-run and its result is queryable', async () => {
    const first = await db.query<{ run_reminder_cron: { reminders_due: number; notifications_created: number } }>(
      `select run_reminder_cron(false);`,
    )
    expect(first.rows[0]!.run_reminder_cron.reminders_due).toBe(1)
    expect(first.rows[0]!.run_reminder_cron.notifications_created).toBe(1)

    // Re-run: same due reminder, but the notification de-dupes -> 0 created.
    const second = await db.query<{ run_reminder_cron: { notifications_created: number } }>(
      `select run_reminder_cron(false);`,
    )
    expect(second.rows[0]!.run_reminder_cron.notifications_created).toBe(0)

    // Exactly one notification exists for the owner.
    const n = await db.query<{ n: string }>(
      `select count(*) as n from notifications where recipient_uid = '${OWNER}';`,
    )
    expect(Number(n.rows[0]!.n)).toBe(1)

    // Both runs are recorded and queryable.
    const runs = await db.query<{ n: string }>(
      `select count(*) as n from cron_runs where job_name = 'reminder_cron';`,
    )
    expect(Number(runs.rows[0]!.n)).toBe(2)
  })

  it('dry_run reports due work without creating notifications', async () => {
    const dry = await db.query<{ run_reminder_cron: { reminders_due: number; notifications_created: number; dry_run: boolean } }>(
      `select run_reminder_cron(true);`,
    )
    expect(dry.rows[0]!.run_reminder_cron.dry_run).toBe(true)
    expect(dry.rows[0]!.run_reminder_cron.notifications_created).toBe(0)
  })
})

describe('subscription — activation + replay safety (Phase 14)', () => {
  let db: PGlite
  let planId: string
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    const p = await db.query<{ id: string }>(
      `insert into plans (key, name, price, billing_interval) values ('pro','Pro', 5000, 'monthly') returning id;`,
    )
    planId = p.rows[0]!.id
  })

  it('a paid order activates the plan; a replay changes nothing', async () => {
    const order = await db.query<{ order_id: string; amount: string }>(
      `select * from create_payment_order('${planId}');`,
    )
    // Server-side price + 18% GST: 5000 * 1.18 = 5900.
    expect(Number(order.rows[0]!.amount)).toBe(5900)
    const orderId = order.rows[0]!.order_id

    const act = await db.query<{ duplicate: boolean; expires_at: string }>(
      `select * from activate_subscription('${orderId}', 'pay_123');`,
    )
    expect(act.rows[0]!.duplicate).toBe(false)
    const expiry1 = act.rows[0]!.expires_at

    // Plan expiry advanced ~1 month; the tenant is now active.
    const active = await db.query<{ active: boolean }>(
      `select is_company_plan_active(get_current_company_id()) as active;`,
    )
    expect(active.rows[0]!.active).toBe(true)

    // Replay the SAME order -> duplicate, no new transaction, expiry unchanged.
    const replay = await db.query<{ duplicate: boolean; expires_at: string }>(
      `select * from activate_subscription('${orderId}', 'pay_123');`,
    )
    expect(replay.rows[0]!.duplicate).toBe(true)
    expect(new Date(replay.rows[0]!.expires_at).getTime()).toBe(new Date(expiry1).getTime())

    const txns = await db.query<{ n: string }>(
      `select count(*) as n from payment_transactions where order_id = '${orderId}';`,
    )
    expect(Number(txns.rows[0]!.n)).toBe(1)
  })

  it('a replayed webhook event is recorded only once', async () => {
    const first = await db.query<{ record_webhook_event: boolean }>(
      `select record_webhook_event('evt_abc', '{"x":1}'::jsonb);`,
    )
    expect(first.rows[0]!.record_webhook_event).toBe(true)
    const second = await db.query<{ record_webhook_event: boolean }>(
      `select record_webhook_event('evt_abc', '{"x":1}'::jsonb);`,
    )
    expect(second.rows[0]!.record_webhook_event).toBe(false)
  })
})

describe('terms acknowledgement via public link (Phase 15)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
  })

  it('client acknowledges terms via token and the evidence is recorded', async () => {
    const issued = await db.query<{ document_id: string; token: string }>(
      `select * from issue_terms_document(null, 'You agree to the terms.', null, 336);`,
    )
    const { document_id, token } = issued.rows[0]!

    // Public display works.
    const body = await db.query<{ get_terms_for_token: string }>(
      `select get_terms_for_token('${token}');`,
    )
    expect(body.rows[0]!.get_terms_for_token).toContain('agree to the terms')

    // Acknowledge with evidence.
    const ack = await db.query<{ acknowledge_terms: boolean }>(
      `select acknowledge_terms('${token}', 'Priya Sharma', 'priya@x.in', '1.2.3.4', 'Mozilla/5.0');`,
    )
    expect(ack.rows[0]!.acknowledge_terms).toBe(true)

    const doc = await db.query<{ acknowledged_by_name: string; acknowledged_ip: string; acknowledged_at: string | null }>(
      `select acknowledged_by_name, acknowledged_ip, acknowledged_at
       from project_terms_documents where id = '${document_id}';`,
    )
    expect(doc.rows[0]!.acknowledged_by_name).toBe('Priya Sharma')
    expect(doc.rows[0]!.acknowledged_ip).toBe('1.2.3.4')
    expect(doc.rows[0]!.acknowledged_at).not.toBeNull()

    // The token is one-time: a second acknowledgement fails.
    const again = await db.query<{ acknowledge_terms: boolean }>(
      `select acknowledge_terms('${token}', 'Someone Else');`,
    )
    expect(again.rows[0]!.acknowledge_terms).toBe(false)
  })

  it('a freshly issued link shows as active, not "expired" (0093)', async () => {
    // access_tokens deliberately has no select policy for `authenticated` --
    // the studio-facing list must read it through a SECURITY DEFINER
    // function, not a plain query, or has_active_link is always false.
    const issued = await db.query<{ document_id: string }>(
      `select * from issue_terms_document(null, 'Fresh terms.', null, 336);`,
    )
    const list = await db.query<{ id: string; has_active_link: boolean; link_expires_at: string | null }>(
      `select * from list_project_terms_documents();`,
    )
    const row = list.rows.find((r) => r.id === issued.rows[0]!.document_id)
    expect(row?.has_active_link).toBe(true)
    expect(row?.link_expires_at).not.toBeNull()
  })
})

describe('platform console (Phase 14 follow-up)', () => {
  let db: PGlite
  const owner = OWNER
  const vendor = '44444444-4444-4444-4444-444444444444'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@s.test'),('${vendor}','vendor@ipc.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Studio A','Owner');`)
    // A second tenant, so the cross-tenant list has more than one row.
    await asUser(db, vendor)
    await db.query(`select register_company_and_admin('Studio B','Vendor');`)
  })

  it('a studio owner is NOT a platform admin and is refused', async () => {
    await asUser(db, owner)
    const flag = await db.query<{ is_platform_admin: boolean }>(`select * from get_auth_context();`)
    expect(flag.rows[0]?.is_platform_admin).toBe(false)
    await expect(db.query(`select * from platform_list_studios();`)).rejects.toThrow(/platform access/i)
    await expect(db.query(`select * from platform_usage_summary();`)).rejects.toThrow(/platform access/i)
  })

  it('an allowlisted platform admin sees every tenant, cross-tenant', async () => {
    await db.exec(`insert into platform_admins (user_id) values ('${vendor}');`)
    await asUser(db, vendor)

    const flag = await db.query<{ is_platform_admin: boolean }>(`select * from get_auth_context();`)
    expect(flag.rows[0]?.is_platform_admin).toBe(true)

    const studios = await db.query<{ name: string; owner_email: string; user_count: number }>(
      `select name, owner_email, user_count from platform_list_studios() order by name;`,
    )
    expect(studios.rows.map((r) => r.name)).toEqual(['Studio A', 'Studio B'])
    expect(studios.rows[0]?.owner_email).toBe('owner@s.test')

    const usage = await db.query<{ studio_count: number; active_studio_count: number; total_users: number }>(
      `select * from platform_usage_summary();`,
    )
    expect(Number(usage.rows[0]?.studio_count)).toBe(2)
    // Both new studios get an open-ended grandfathered trial (0018) → active.
    expect(Number(usage.rows[0]?.active_studio_count)).toBe(2)
    expect(Number(usage.rows[0]?.total_users)).toBe(2)
  })
})

describe('platform ops — plan mutations (Phase 14 follow-up)', () => {
  let db: PGlite
  const vendor = '44444444-4444-4444-4444-444444444444'
  const owner = OWNER
  let studioB: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@s.test'),('${vendor}','vendor@ipc.test');`,
    )
    await asUser(db, vendor)
    const b = await db.query<{ company_id: string }>(
      `select company_id from register_company_and_admin('Studio B','Vendor');`,
    )
    studioB = b.rows[0]!.company_id
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Studio A','Owner');`)
  })

  async function gate(companyId: string) {
    const r = await db.query<{ gate: string }>(
      `select platform_plan_gate(plan_expiry, grandfathered_until, grace_until) as gate
       from companies where id = '${companyId}';`,
    )
    return r.rows[0]?.gate
  }

  it('a non-platform-admin owner is refused every op', async () => {
    await asUser(db, owner)
    await expect(db.query(`select platform_extend_plan('${studioB}', 12);`)).rejects.toThrow(/platform access/i)
    await expect(db.query(`select platform_expire_plan('${studioB}');`)).rejects.toThrow(/platform access/i)
    await expect(db.query(`select platform_grant_trial('${studioB}');`)).rejects.toThrow(/platform access/i)
  })

  it('platform admin extends, expires, and re-grants a trial', async () => {
    await db.exec(`insert into platform_admins (user_id) values ('${vendor}');`)
    await asUser(db, vendor)

    // Extend → plan_expiry in the future → active.
    const ext = await db.query<{ platform_extend_plan: string }>(`select platform_extend_plan('${studioB}', 12);`)
    expect(new Date(ext.rows[0]!.platform_extend_plan).getTime()).toBeGreaterThan(Date.now())
    expect(await gate(studioB)).toBe('active')

    // Expire → all gates cleared/past → expired.
    await db.query(`select platform_expire_plan('${studioB}');`)
    expect(await gate(studioB)).toBe('expired')

    // Grant trial → grandfathered.
    await db.query(`select platform_grant_trial('${studioB}');`)
    expect(await gate(studioB)).toBe('grandfathered')

    // Each mutation logged a billing_event.
    const ev = await db.query<{ n: number }>(
      `select count(*)::int as n from billing_events
       where company_id = '${studioB}' and kind like 'platform_%';`,
    )
    expect(ev.rows[0]!.n).toBe(3)
  })

  it('extend rejects an out-of-range month count', async () => {
    await asUser(db, vendor)
    await expect(db.query(`select platform_extend_plan('${studioB}', 0);`)).rejects.toThrow(/between 1 and 60/i)
  })
})

describe('email verification (0021)', () => {
  let db: PGlite
  const uid = '55555555-5555-5555-5555-555555555555'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${uid}', 'verify@s.test');`)
  })

  it('issue -> consume flips the user to verified, one-time', async () => {
    // Newly inserted (post-migration) user starts unverified.
    const before = await db.query<{ v: boolean }>(
      `select email_verified as v from auth.users where id = '${uid}';`,
    )
    expect(before.rows[0]!.v).toBe(false)

    const issued = await db.query<{ token: string }>(
      `select issue_email_verification('${uid}') as token;`,
    )
    const token = issued.rows[0]!.token
    expect(token.length).toBeGreaterThan(20)

    const consumed = await db.query<{ uid: string | null }>(
      `select consume_email_verification('${token}') as uid;`,
    )
    expect(consumed.rows[0]!.uid).toBe(uid)

    const after = await db.query<{ v: boolean }>(
      `select email_verified as v from auth.users where id = '${uid}';`,
    )
    expect(after.rows[0]!.v).toBe(true)

    // Second use is rejected.
    const replay = await db.query<{ uid: string | null }>(
      `select consume_email_verification('${token}') as uid;`,
    )
    expect(replay.rows[0]!.uid).toBeNull()
  })

  it('a bad token returns null', async () => {
    const r = await db.query<{ uid: string | null }>(
      `select consume_email_verification('not-a-real-token') as uid;`,
    )
    expect(r.rows[0]!.uid).toBeNull()
  })
})

describe('password reset (0022)', () => {
  let db: PGlite
  const uid = '66666666-6666-6666-6666-666666666666'

  const issue = async () =>
    (await db.query<{ token: string }>(`select issue_password_reset('${uid}') as token;`)).rows[0]!
      .token

  const consume = async (raw: string, hash = 'argon2-hash-new') =>
    (
      await db.query<{ uid: string | null }>(
        `select consume_password_reset('${raw}', '${hash}') as uid;`,
      )
    ).rows[0]!.uid

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email, encrypted_password) values ('${uid}', 'reset@s.test', 'argon2-hash-old');`,
    )
    // Simulate an account created before this migration: never had a reset.
    await db.exec(`update auth.users set email_verified = false where id = '${uid}';`)
  })

  it('consume swaps the password, verifies the email, and stamps the change', async () => {
    const token = await issue()
    expect(token.length).toBeGreaterThan(20)
    expect(await consume(token)).toBe(uid)

    const after = await db.query<{
      pw: string
      verified: boolean
      changed: string | null
    }>(
      `select encrypted_password as pw, email_verified as verified, password_changed_at as changed
         from auth.users where id = '${uid}';`,
    )
    expect(after.rows[0]!.pw).toBe('argon2-hash-new')
    // Completing a reset proves mailbox control.
    expect(after.rows[0]!.verified).toBe(true)
    expect(after.rows[0]!.changed).not.toBeNull()
  })

  it('a token is one-time', async () => {
    const token = await issue()
    expect(await consume(token, 'hash-a')).toBe(uid)
    expect(await consume(token, 'hash-b')).toBeNull()
    const pw = await db.query<{ pw: string }>(
      `select encrypted_password as pw from auth.users where id = '${uid}';`,
    )
    expect(pw.rows[0]!.pw).toBe('hash-a') // the replay did not overwrite
  })

  it('issuing a new token kills the previous one', async () => {
    const first = await issue()
    const second = await issue()
    expect(await consume(first, 'hash-first')).toBeNull()
    expect(await consume(second, 'hash-second')).toBe(uid)
  })

  it('an expired token is refused', async () => {
    const token = await issue()
    await db.exec(
      `update password_reset_tokens set expires_at = now() - interval '1 minute' where consumed_at is null;`,
    )
    expect(await consume(token)).toBeNull()
  })

  it('a bad token returns null', async () => {
    expect(await consume('not-a-real-token')).toBeNull()
  })

  it('each reset bumps password_version, stranding older tokens', async () => {
    const before = await db.query<{ v: number }>(
      `select password_version as v from auth.users where id = '${uid}';`,
    )
    expect(await consume(await issue())).toBe(uid)
    const after = await db.query<{ v: number }>(
      `select password_version as v from auth.users where id = '${uid}';`,
    )
    expect(after.rows[0]!.v).toBe(before.rows[0]!.v + 1)
  })

  it('get_auth_context exposes the reset stamp + version for session invalidation', async () => {
    const owner = '77777777-7777-7777-7777-777777777777'
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'ctx@s.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Ctx Studio', 'Ctx Owner', null);`)

    const before = await db.query<{ password_changed_at: string | null; password_version: number }>(
      `select password_changed_at, password_version from get_auth_context();`,
    )
    expect(before.rows[0]!.password_changed_at).toBeNull()
    // A fresh account matches the default the API reads for claim-less tokens.
    expect(before.rows[0]!.password_version).toBe(0)

    const t = (await db.query<{ token: string }>(`select issue_password_reset('${owner}') as token;`))
      .rows[0]!.token
    await db.query(`select consume_password_reset('${t}', 'hash-ctx') as uid;`)

    const after = await db.query<{ password_changed_at: string | null; password_version: number }>(
      `select password_changed_at, password_version from get_auth_context();`,
    )
    expect(after.rows[0]!.password_changed_at).not.toBeNull()
    expect(after.rows[0]!.password_version).toBe(1)
  })
})

describe('refresh tokens (0024)', () => {
  let db: PGlite
  const uid = '88888888-8888-8888-8888-888888888888'

  const issue = async () =>
    (await db.query<{ token: string }>(`select issue_refresh_token('${uid}') as token;`)).rows[0]!
      .token

  const rotate = async (raw: string) =>
    (
      await db.query<{ user_id: string | null; token: string | null }>(
        `select * from rotate_refresh_token('${raw}');`,
      )
    ).rows[0]!

  // "Live" means usable: unrevoked AND unexpired. The revoke functions skip
  // already-expired rows, which cannot be presented anyway.
  const liveCount = async () =>
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from refresh_tokens
          where user_id = '${uid}' and revoked_at is null and expires_at > now();`,
      )
    ).rows[0]!.n

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${uid}', 'refresh@s.test');`)
  })

  it('rotation returns a new token and spends the old one', async () => {
    const first = await issue()
    const r = await rotate(first)
    expect(r.user_id).toBe(uid)
    expect(r.token).not.toBeNull()
    expect(r.token).not.toBe(first)

    // The successor works.
    const second = await rotate(r.token!)
    expect(second.user_id).toBe(uid)
  })

  it('the successor inherits the original expiry — refreshing cannot extend a session forever', async () => {
    const raw = await issue()
    await db.exec(
      `update refresh_tokens set expires_at = now() + interval '3 days'
        where consumed_at is null and revoked_at is null and user_id = '${uid}';`,
    )
    const before = await db.query<{ exp: string }>(
      `select expires_at as exp from refresh_tokens
        where token_hash = encode(sha256(convert_to('${raw}', 'UTF8')), 'hex');`,
    )
    const r = await rotate(raw)
    const after = await db.query<{ exp: string }>(
      `select expires_at as exp from refresh_tokens
        where token_hash = encode(sha256(convert_to('${r.token}', 'UTF8')), 'hex');`,
    )
    // Compared to the predecessor's exact timestamp, not to a window: minting a
    // fresh `now() + 30 days` would still land inside any day-granularity bound.
    expect(after.rows[0]!.exp).toEqual(before.rows[0]!.exp)
  })

  it('stale reuse revokes the whole family', async () => {
    const raw = await issue()
    const r = await rotate(raw)
    // Age the consumption past the race grace window.
    await db.exec(
      `update refresh_tokens set consumed_at = now() - interval '5 minutes' where consumed_at is not null;`,
    )
    const replay = await rotate(raw)
    expect(replay.user_id).toBeNull()

    // The successor handed out earlier is dead too — that is the point.
    const after = await rotate(r.token!)
    expect(after.user_id).toBeNull()
  })

  it('a same-moment double refresh does NOT kill the family (two tabs)', async () => {
    const raw = await issue()
    const r = await rotate(raw)
    const replay = await rotate(raw) // still inside the grace window
    expect(replay.user_id).toBeNull()
    // The winner's token survives.
    expect((await rotate(r.token!)).user_id).toBe(uid)
  })

  it('an expired or revoked token is refused', async () => {
    const expired = await issue()
    await db.exec(
      `update refresh_tokens set expires_at = now() - interval '1 minute'
        where token_hash = encode(sha256(convert_to('${expired}', 'UTF8')), 'hex');`,
    )
    expect((await rotate(expired)).user_id).toBeNull()

    const revoked = await issue()
    await db.query(`select revoke_refresh_family('${revoked}');`)
    expect((await rotate(revoked)).user_id).toBeNull()
  })

  it('revoke_all_sessions kills every family and bumps password_version', async () => {
    await issue()
    await issue()
    expect(await liveCount()).toBeGreaterThan(0)

    const before = await db.query<{ v: number }>(
      `select password_version as v from auth.users where id = '${uid}';`,
    )
    const bumped = await db.query<{ v: number }>(`select revoke_all_sessions('${uid}') as v;`)

    expect(await liveCount()).toBe(0)
    expect(bumped.rows[0]!.v).toBe(before.rows[0]!.v + 1)
  })
})

describe('team directory + invitations (0026)', () => {
  let db: PGlite
  const owner = '77777777-7777-7777-7777-777777777777'
  let companyId: string
  let roleId: string

  /** Insert a pending invitation and return its id. */
  const invite = async (email: string, raw: string) => {
    const r = await db.query<{ id: string }>(
      `insert into user_invitations (company_id, email, token_hash, role, pending_name,
         pending_phone, pending_salary, pending_engagement_type, pending_role_ids, expires_at)
       values ('${companyId}', '${email}',
         encode(sha256(convert_to('${raw}', 'UTF8')), 'hex'), 'employee', 'Ravi Kumar',
         '9876543210', 42000, 'freelancer', array['${roleId}']::uuid[], now() + interval '7 days')
       returning id;`,
    )
    return r.rows[0]!.id
  }

  const consume = async (raw: string, hash = 'argon2-invitee') =>
    (
      await db.query<{ uid: string | null }>(
        `select consume_user_invitation('${raw}', '${hash}') as uid;`,
      )
    ).rows[0]!.uid

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@team.test');`)
    await asUser(db, owner)
    const c = await db.query<{ company_id: string }>(
      `select company_id from register_company_and_admin('Team Studio','Owner');`,
    )
    companyId = c.rows[0]!.company_id
    const r = await db.query<{ id: string }>(
      `insert into employee_roles (company_id, type_name, role_code)
       values ('${companyId}', 'Photographer', 'photographer') returning id;`,
    )
    roleId = r.rows[0]!.id
  })

  it('a directory-only member needs no email and no password', async () => {
    await db.exec(
      `insert into auth.users (id, email, encrypted_password)
       values ('88888888-8888-8888-8888-888888888888', null, null);`,
    )
    await db.exec(
      `insert into users (user_id, company_id, role, name, email, phone, engagement_type, login_enabled)
       values ('88888888-8888-8888-8888-888888888888', '${companyId}', 'employee',
               'Offline Crew', null, '9000000000', 'freelancer', false);`,
    )
    const r = await db.query<{ login_enabled: boolean; email: string | null }>(
      `select login_enabled, email from users where name = 'Offline Crew';`,
    )
    expect(r.rows[0]!.login_enabled).toBe(false)
    expect(r.rows[0]!.email).toBeNull()
  })

  it('a second directory-only member with no email does not collide on uniqueness', async () => {
    // Two null emails are not "equal" for a unique constraint -- this is the
    // exact real-world shape the add-member wizard hits every time a second
    // freelancer is added with only a phone number.
    await expect(
      db.exec(
        `insert into auth.users (id, email, encrypted_password)
         values ('99999999-9999-9999-9999-999999999999', null, null);`,
      ),
    ).resolves.not.toThrow()
  })

  it('engagement_type only accepts the two the wizard offers', async () => {
    await expect(
      db.exec(
        `update users set engagement_type = 'contractor' where user_id = '${owner}';`,
      ),
    ).rejects.toThrow()
  })

  it('peek shows the invite without leaking the salary', async () => {
    const raw = 'raw-token-peek'
    await invite('ravi@crew.test', raw)
    const r = await db.query<Record<string, unknown>>(
      `select * from peek_user_invitation('${raw}');`,
    )
    expect(r.rows[0]!.email).toBe('ravi@crew.test')
    expect(r.rows[0]!.company_name).toBe('Team Studio')
    expect(Object.keys(r.rows[0]!)).not.toContain('pending_salary')
  })

  it('consume creates the identity, the member row and their job roles', async () => {
    const raw = 'raw-token-consume'
    const id = await invite('meera@crew.test', raw)
    const uid = await consume(raw)
    expect(uid).toBeTruthy()

    const m = await db.query<{
      name: string
      company_id: string
      salary: number
      engagement_type: string
      status: string
    }>(`select name, company_id, salary, engagement_type, status from users where user_id = '${uid}';`)
    expect(m.rows[0]!.name).toBe('Ravi Kumar')
    expect(m.rows[0]!.company_id).toBe(companyId)
    expect(Number(m.rows[0]!.salary)).toBe(42000)
    expect(m.rows[0]!.engagement_type).toBe('freelancer')
    expect(m.rows[0]!.status).toBe('active')

    // Acceptance proves mailbox control, so the account is usable immediately.
    const a = await db.query<{ verified: boolean; pw: string }>(
      `select email_verified as verified, encrypted_password as pw from auth.users where id = '${uid}';`,
    )
    expect(a.rows[0]!.verified).toBe(true)
    expect(a.rows[0]!.pw).toBe('argon2-invitee')

    const roles = await db.query(
      `select 1 from employee_role_assignments where user_id = '${uid}' and role_id = '${roleId}';`,
    )
    expect(roles.rows.length).toBe(1)

    const inv = await db.query<{ accepted_at: string | null }>(
      `select accepted_at from user_invitations where id = '${id}';`,
    )
    expect(inv.rows[0]!.accepted_at).not.toBeNull()
  })

  it('a token is one-time, and a dead one peeks as nothing', async () => {
    const raw = 'raw-token-replay'
    await invite('once@crew.test', raw)
    expect(await consume(raw)).toBeTruthy()
    expect(await consume(raw)).toBeNull()
    const peek = await db.query(`select * from peek_user_invitation('${raw}');`)
    expect(peek.rows.length).toBe(0)
  })

  it('expired and revoked invitations are refused', async () => {
    const expired = 'raw-token-expired'
    const id = await invite('late@crew.test', expired)
    await db.exec(
      `update user_invitations set expires_at = now() - interval '1 day' where id = '${id}';`,
    )
    expect(await consume(expired)).toBeNull()

    const revoked = 'raw-token-revoked'
    const rid = await invite('gone@crew.test', revoked)
    await db.exec(`update user_invitations set revoked_at = now() where id = '${rid}';`)
    expect(await consume(revoked)).toBeNull()
  })

  it('only one live invitation per address, and revoking frees the address', async () => {
    await invite('dup@crew.test', 'raw-dup-1')
    await expect(invite('dup@crew.test', 'raw-dup-2')).rejects.toThrow()

    await db.exec(`update user_invitations set revoked_at = now() where email = 'dup@crew.test';`)
    await expect(invite('dup@crew.test', 'raw-dup-3')).resolves.toBeTruthy()
  })
})

describe('theme presets renamed (0027)', () => {
  let db: PGlite
  const owner = '99999999-9999-9999-9999-999999999999'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@theme.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Theme Studio','Owner');`)
  })

  it('carries a studio on an old preset over to its named theme', async () => {
    // Re-run the mapping against a row that predates 0027, the way a live
    // database looks when the migration lands.
    await db.exec(
      `insert into company_theme_settings (company_id, preset_key)
       values (get_current_company_id(), 'amber')
       on conflict (company_id) do update set preset_key = 'amber';`,
    )
    await db.exec(readMig('0027_theme_fonts.sql'))

    const r = await db.query<{ preset_key: string; font_key: string | null }>(
      `select preset_key, font_key from company_theme_settings
        where company_id = get_current_company_id();`,
    )
    expect(r.rows[0]!.preset_key).toBe('luxury_gold')
    // No font means "whatever the theme ships with" — never a hardcoded face.
    expect(r.rows[0]!.font_key).toBeNull()
  })

  it('leaves a key it does not recognise alone', async () => {
    await db.exec(
      `update company_theme_settings set preset_key = 'ocean_blue'
        where company_id = get_current_company_id();`,
    )
    await db.exec(readMig('0027_theme_fonts.sql'))
    const r = await db.query<{ preset_key: string }>(
      `select preset_key from company_theme_settings where company_id = get_current_company_id();`,
    )
    expect(r.rows[0]!.preset_key).toBe('ocean_blue')
  })
})

describe('CRM manual lead entry (0028)', () => {
  let db: PGlite
  const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@crm.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM Studio','Owner');`)
  })

  it('creates a lead scoped to the calling company', async () => {
    const id = await add('Aanya', '9876500001')
    const r = await db.query<{ company_id: string; status: string; source: string }>(
      `select company_id, status, source from crm_leads where id = '${id}';`,
    )
    expect(r.rows[0]!.status).toBe('new')
    expect(r.rows[0]!.source).toBe('enquiry')
    expect(r.rows[0]!.company_id).toBe(
      (await db.query<{ id: string }>(`select get_current_company_id() as id;`)).rows[0]!.id,
    )
  })

  it('hands back the existing lead when the number is already known', async () => {
    // The same client ringing twice is one conversation, not two rows.
    const first = await add('Aanya', '9876500002')
    const again = await add('Aanya Sharma', '98765 00002')
    expect(again).toBe(first)
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from crm_leads where phone = '9876500002' or phone = '98765 00002';`,
    )
    expect(count.rows[0]!.n).toBe(1)
  })

  it('hands a new lead to the rota member carrying the least', async () => {
    const [a, b] = ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc']
    for (const [i, uid] of [a!, b!].entries()) {
      await db.exec(`insert into auth.users (id, email) values ('${uid}', 'm${i}@crm.test');`)
      await db.exec(
        `insert into users (user_id, company_id, role, name, email)
         values ('${uid}', get_current_company_id(), 'employee', 'Member ${i}', 'm${i}@crm.test');`,
      )
      await db.exec(
        `insert into crm_distribution_rules (company_id, user_id, priority)
         values (get_current_company_id(), '${uid}', ${i});`,
      )
    }
    // First goes to whoever is empty; the second must not pile onto the same person.
    const one = await add('Lead one', '9000000001')
    const two = await add('Lead two', '9000000002')
    const owners = await db.query<{ assigned_to: string }>(
      `select assigned_to from crm_leads where id in ('${one}', '${two}');`,
    )
    const assigned = owners.rows.map((r) => r.assigned_to)
    expect(new Set(assigned).size).toBe(2)
  })

  it('accepts the proposal_sent stage the inbox filters on', async () => {
    const id = await add('Quoted', '9000000003')
    await db.exec(`update crm_leads set status = 'proposal_sent' where id = '${id}';`)
    const r = await db.query<{ status: string }>(`select status from crm_leads where id = '${id}';`)
    expect(r.rows[0]!.status).toBe('proposal_sent')
    await expect(
      db.exec(`update crm_leads set status = 'ghosted' where id = '${id}';`),
    ).rejects.toThrow()
  })
})

describe('lead sources (0029)', () => {
  let db: PGlite
  const owner = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@src.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Source Studio','Owner');`)
  })

  it('mints a key nobody chose, scoped to the calling company', async () => {
    const r = await db.query<{ source_key: string; kind: string; label: string; company_id: string }>(
      `select * from create_lead_source('Website contact form', 'webform');`,
    )
    const row = r.rows[0]!
    expect(row.label).toBe('Website contact form')
    expect(row.kind).toBe('webform')
    // Long enough that guessing one is not worth anybody's afternoon.
    expect(row.source_key.length).toBeGreaterThan(50)
    expect(row.company_id).toBe(
      (await db.query<{ id: string }>(`select get_current_company_id() as id;`)).rows[0]!.id,
    )
  })

  it('refuses a kind the webhook cannot serve', async () => {
    await expect(db.query(`select * from create_lead_source('Carrier pigeon', 'pigeon');`)).rejects.toThrow()
  })

  it('records which source a captured lead came through', async () => {
    // 'facebook' vs 'webform' cannot tell two campaigns apart, and "which
    // campaign is working" is the only question this page exists to answer.
    const a = (
      await db.query<{ source_key: string }>(`select * from create_lead_source('Campaign A', 'meta');`)
    ).rows[0]!.source_key
    const b = (
      await db.query<{ source_key: string }>(`select * from create_lead_source('Campaign B', 'meta');`)
    ).rows[0]!.source_key

    await db.query(`select capture_lead('${a}', 'From A', '9000000011', null, '{}'::jsonb);`)
    await db.query(`select capture_lead('${b}', 'From B', '9000000012', null, '{}'::jsonb);`)

    const rows = await db.query<{ name: string; source: string; source_key: string }>(
      `select name, source, source_key from crm_leads where source_key in ('${a}', '${b}') order by name;`,
    )
    expect(rows.rows.map((r) => r.source)).toEqual(['facebook', 'facebook'])
    expect(rows.rows[0]!.source_key).toBe(a)
    expect(rows.rows[1]!.source_key).toBe(b)
  })

  it('stops accepting leads once a source is paused', async () => {
    const key = (
      await db.query<{ source_key: string }>(`select * from create_lead_source('Old form', 'webform');`)
    ).rows[0]!.source_key
    await db.exec(`update crm_webhook_sources set is_active = false where source_key = '${key}';`)
    await expect(
      db.query(`select capture_lead('${key}', 'Late', '9000000013', null, '{}'::jsonb);`),
    ).rejects.toThrow()
  })
})

describe('attendance check-out and fence (0030)', () => {
  let db: PGlite
  const owner = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@hr.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('HR Studio','Owner');`)
  })

  it('refuses to check out of a day that was never checked into', async () => {
    // Silently creating a row here would invent a shift nobody worked.
    await expect(db.query(`select check_out();`)).rejects.toThrow()
  })

  it('closes the day it was opened on', async () => {
    await db.query(`select check_in(19.076, 72.8777);`)
    const id = (await db.query<{ id: string }>(`select check_out() as id;`)).rows[0]!.id

    const r = await db.query<{ check_in_at: string; check_out_at: string; a_date: string }>(
      `select check_in_at, check_out_at, a_date from attendance where id = '${id}';`,
    )
    expect(r.rows[0]!.check_out_at).not.toBeNull()
    // One row per person per day: checking out must not open a second one.
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from attendance where user_id = '${owner}';`,
    )
    expect(count.rows[0]!.n).toBe(1)
  })

  it('will not check out twice', async () => {
    await expect(db.query(`select check_out();`)).rejects.toThrow()
  })

  it('stores a fence and refuses a radius that would be useless', async () => {
    const r = await db.query<{ radius_m: number; timezone: string }>(
      `select radius_m, timezone from set_company_location(19.076, 72.8777, 200, 'Asia/Kolkata');`,
    )
    expect(r.rows[0]!.radius_m).toBe(200)
    expect(r.rows[0]!.timezone).toBe('Asia/Kolkata')

    // Under 20m GPS drift alone locks people out; over 5km is not a fence.
    await expect(db.query(`select set_company_location(19.076, 72.8777, 5, 'Asia/Kolkata');`)).rejects.toThrow()
    await expect(db.query(`select set_company_location(19.076, 72.8777, 9000, 'Asia/Kolkata');`)).rejects.toThrow()
  })

  it('moves the fence rather than stacking a second one', async () => {
    await db.query(`select set_company_location(28.6139, 77.209, 300, 'Asia/Kolkata');`)
    const r = await db.query<{ n: number; lat: number }>(
      `select count(*)::int as n, max(lat) as lat from company_location;`,
    )
    expect(r.rows[0]!.n).toBe(1)
    expect(Number(r.rows[0]!.lat)).toBeCloseTo(28.6139, 3)
  })

  it('keeps the fence out once it is set', async () => {
    // Same coordinates the fence was just moved away from.
    await expect(db.query(`select check_in(19.076, 72.8777);`)).rejects.toThrow()
  })

  it('a fence can be turned off without deleting it, and back on again', async () => {
    // The fence is currently at Delhi (28.6139, 77.209); Mumbai (19.076, 72.8777) is outside it.
    await db.query(`select set_company_location(28.6139, 77.209, 300, 'Asia/Kolkata', false);`)
    const id = (await db.query<{ id: string }>(`select check_in(19.076, 72.8777) as id;`)).rows[0]!.id
    expect(id).toBeTruthy()
    await db.exec(`delete from attendance where id = '${id}';`) // undo, so the next test starts clean

    await db.query(`select set_company_location(28.6139, 77.209, 300, 'Asia/Kolkata', true);`)
    await expect(db.query(`select check_in(19.076, 72.8777);`)).rejects.toThrow(/outside_fence/)

    const row = await db.query<{ is_active: boolean }>(`select is_active from company_location;`)
    expect(row.rows[0]!.is_active).toBe(true)
  })
})

describe('task bundles (0031)', () => {
  let db: PGlite
  const owner = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
  let bundle: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@bundle.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Bundle Studio','Owner');`)

    const b = await db.query<{ id: string }>(
      `insert into task_bundles (company_id, name)
       values (get_current_company_id(), 'Wedding editing') returning id;`,
    )
    bundle = b.rows[0]!.id
    for (const [i, title] of ['Cull and select', 'Colour grade', 'Album layout'].entries()) {
      await db.exec(
        `insert into task_bundle_items (bundle_id, company_id, title, priority, sort_order)
         values ('${bundle}', get_current_company_id(), '${title}', 'medium', ${i});`,
      )
    }
  })

  it('stamps out one task per item, keeping the checklist order', async () => {
    const count = (
      await db.query<{ n: number }>(`select apply_task_bundle('${bundle}', null, '{}') as n;`)
    ).rows[0]!.n
    expect(count).toBe(3)

    const tasks = await db.query<{ title: string; status: string }>(
      `select title, status from tasks order by created_at, title;`,
    )
    expect(tasks.rows).toHaveLength(3)
    expect(tasks.rows.every((t) => t.status === 'to_do')).toBe(true)
  })

  it('can raise the same checklist against a project', async () => {
    const client = (
      await db.query<{ id: string }>(
        `insert into clients (company_id, name) values (get_current_company_id(), 'Sharma') returning id;`,
      )
    ).rows[0]!.id
    const project = (
      await db.query<{ id: string }>(
        `insert into projects (company_id, client_id, name)
         values (get_current_company_id(), '${client}', 'Sharma Wedding') returning id;`,
      )
    ).rows[0]!.id

    await db.query(`select apply_task_bundle('${bundle}', '${project}', '{}');`)
    const linked = await db.query<{ n: number }>(
      `select count(*)::int as n from tasks where project_id = '${project}';`,
    )
    expect(linked.rows[0]!.n).toBe(3)
  })

  it('refuses a bundle or project belonging to someone else', async () => {
    // SECURITY DEFINER bypassed RLS to get here, so the function has to do the
    // tenant check itself — an id alone must not reach across studios.
    await expect(
      db.query(`select apply_task_bundle('${owner}'::uuid, null, '{}');`),
    ).rejects.toThrow()
    await expect(
      db.query(`select apply_task_bundle('${bundle}', '${owner}'::uuid, '{}');`),
    ).rejects.toThrow()
  })

  it('writes bundles through the admin/manager policy 0007 set', async () => {
    // The tables were always policied; only a way to use them was missing.
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where tablename in ('task_bundles', 'task_bundle_items');`,
    )
    expect(policies.rows.map((p) => p.policyname).sort()).toEqual([
      'task_bundle_items_select',
      'task_bundle_items_write',
      'task_bundles_select',
      'task_bundles_write',
    ])
  })
})

describe('shoot details (0038)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('gives a shoot somewhere to keep its map link', async () => {
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'shoots' and column_name = 'map_link';`,
    )
    expect(cols.rows).toHaveLength(1)
  })

  it('policies presets the way every other company-scoped table is', async () => {
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies where tablename = 'shoot_presets';`,
    )
    expect(policies.rows.map((p) => p.policyname).sort()).toEqual([
      'shoot_presets_select',
      'shoot_presets_write',
    ])
  })

  // "Save preset" under a name that exists is an overwrite, not a second row.
  it('keeps one preset per name and kind', async () => {
    const company = await db.query<{ id: string }>(`select id from companies limit 1;`)
    const id = company.rows[0]!.id
    await db.query(
      `insert into shoot_presets (company_id, kind, name, payload)
       values ('${id}', 'shoot', 'Wedding day', '{"requirements": []}'::jsonb);`,
    )
    await expect(
      db.query(
        `insert into shoot_presets (company_id, kind, name, payload)
         values ('${id}', 'shoot', 'Wedding day', '{}'::jsonb);`,
      ),
    ).rejects.toThrow()
    // Same name, different kind, is a different preset.
    await db.query(
      `insert into shoot_presets (company_id, kind, name, payload)
       values ('${id}', 'internal_work', 'Wedding day', '{}'::jsonb);`,
    )
    const rows = await db.query(`select 1 from shoot_presets;`)
    expect(rows.rows).toHaveLength(2)
  })

  it('rejects a kind nobody handles', async () => {
    const company = await db.query<{ id: string }>(`select id from companies limit 1;`)
    await expect(
      db.query(
        `insert into shoot_presets (company_id, kind, name)
         values ('${company.rows[0]!.id}', 'moodboard', 'x');`,
      ),
    ).rejects.toThrow()
  })

  it('a shoot round-trips its map link and start/end time, and both can be corrected after scheduling', async () => {
    const company = await db.query<{ id: string }>(`select id from companies limit 1;`)
    const companyId = company.rows[0]!.id
    await db.exec(`insert into clients (company_id, name) values ('${companyId}', 'Shoot client');`)
    const client = await db.query<{ id: string }>(`select id from clients where name = 'Shoot client';`)
    const proj = await db.query<{ id: string }>(
      `select create_project_with_details('${client.rows[0]!.id}', 'Shoot Proj', 50000) as id;`,
    )
    const shoot = await db.query<{ id: string }>(
      `insert into shoots (company_id, project_id, name, shoot_date, start_at, end_at, map_link)
       values ('${companyId}', '${proj.rows[0]!.id}', 'Wedding day', '2026-05-01',
               '2026-05-01T09:00:00Z', '2026-05-01T18:00:00Z', 'https://maps.example.com/wrong')
       returning id;`,
    )
    const id = shoot.rows[0]!.id
    await db.exec(`update shoots set map_link = 'https://maps.example.com/right', end_at = '2026-05-01T20:00:00Z' where id = '${id}';`)
    const row = await db.query<{ map_link: string; start_at: Date; end_at: Date }>(
      `select map_link, start_at, end_at from shoots where id = '${id}';`,
    )
    expect(row.rows[0]!.map_link).toBe('https://maps.example.com/right')
    expect(row.rows[0]!.end_at.toISOString()).toBe('2026-05-01T20:00:00.000Z')
  })
})

describe('deliverable sets (0039)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('policies sets the way every other company-scoped table is', async () => {
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies where tablename = 'deliverable_sets';`,
    )
    expect(policies.rows.map((p) => p.policyname).sort()).toEqual([
      'deliverable_sets_select',
      'deliverable_sets_write',
    ])
  })

  it('keeps one set per name, so saving over a package replaces it', async () => {
    const company = await db.query<{ id: string }>(`select id from companies limit 1;`)
    const id = company.rows[0]!.id
    await db.query(
      `insert into deliverable_sets (company_id, name, items)
       values ('${id}', 'Premium', '[{"title": "Photo Album"}]'::jsonb);`,
    )
    await expect(
      db.query(
        `insert into deliverable_sets (company_id, name, items)
         values ('${id}', 'Premium', '[]'::jsonb);`,
      ),
    ).rejects.toThrow()
  })

  it('goes with the company', async () => {
    const before = await db.query(`select 1 from deliverable_sets;`)
    expect(before.rows.length).toBeGreaterThan(0)
    await db.exec(`delete from companies;`)
    const after = await db.query(`select 1 from deliverable_sets;`)
    expect(after.rows).toHaveLength(0)
  })
})

describe('plan gate sits on feature access, not identity (0034)', () => {
  let db: PGlite
  const owner = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const member = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  let planId: string

  const rotate = async (raw: string) =>
    (
      await db.query<{ user_id: string | null; token: string | null }>(
        `select * from rotate_refresh_token('${raw}');`,
      )
    ).rows[0]!

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@gate.test'),('${member}','member@gate.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Gate Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Member', 'member@gate.test');`,
    )
    const p = await db.query<{ id: string }>(
      `insert into plans (key, name, price, billing_interval) values ('renew','Renew', 1000, 'monthly') returning id;`,
    )
    planId = p.rows[0]!.id
    // Lapse the plan entirely: no expiry, no trial, no grace.
    await db.exec(
      `update companies set grandfathered_until = null, plan_expiry = null, grace_until = null
       where id = get_current_company_id();`,
    )
  })

  it('an expired studio still resolves its tenant, but is not "active"', async () => {
    await asUser(db, owner)
    const r = await db.query<{ company: string | null; active: boolean; owner: boolean }>(
      `select get_current_company_id() as company, is_current_user_active() as active, is_current_owner() as owner;`,
    )
    expect(r.rows[0]!.company).not.toBeNull()
    expect(r.rows[0]!.active).toBe(false)
    expect(r.rows[0]!.owner).toBe(true)
  })

  it('the owner can start checkout while expired — the recovery path', async () => {
    await asUser(db, owner)
    const order = await db.query<{ order_id: string }>(
      `select * from create_payment_order('${planId}');`,
    )
    expect(order.rows[0]!.order_id).toBeTruthy()
    await db.query(`select * from activate_subscription('${order.rows[0]!.order_id}', 'pay_renew');`)
    const active = await db.query<{ active: boolean }>(`select is_current_user_active() as active;`)
    expect(active.rows[0]!.active).toBe(true)
    // Back to lapsed for the tests below.
    await db.exec(`update companies set plan_expiry = null where id = get_current_company_id();`)
  })

  it('get_auth_context reports the lapse so the app can route to renewal', async () => {
    await asUser(db, owner)
    const ctx = await db.query<{ plan_gate: string; company_id: string }>(
      `select * from get_auth_context();`,
    )
    expect(ctx.rows[0]!.plan_gate).toBe('expired')
    expect(ctx.rows[0]!.company_id).toBeTruthy()
  })

  it('a refresh session survives a lapsed plan', async () => {
    const raw = (await db.query<{ t: string }>(`select issue_refresh_token('${owner}') as t;`))
      .rows[0]!.t
    const r = await rotate(raw)
    expect(r.user_id).toBe(owner)
    expect(r.token).not.toBeNull()
  })

  it('a refresh session does NOT survive a removed member', async () => {
    const raw = (await db.query<{ t: string }>(`select issue_refresh_token('${member}') as t;`))
      .rows[0]!.t
    await db.exec(
      `update users set deleted_at = now(), status = 'inactive' where user_id = '${member}';`,
    )
    const r = await rotate(raw)
    expect(r.user_id).toBeNull()
    const live = await db.query<{ n: number }>(
      `select count(*)::int as n from refresh_tokens where user_id = '${member}' and revoked_at is null;`,
    )
    expect(live.rows[0]!.n).toBe(0)
    // And the identity oracle no longer resolves them at all.
    await asUser(db, member)
    const ctx = await db.query(`select * from get_auth_context();`)
    expect(ctx.rows.length).toBe(0)
    const company = await db.query<{ c: string | null }>(`select get_current_company_id() as c;`)
    expect(company.rows[0]!.c).toBeNull()
  })

  it('audit_log_write stamps the caller and their own studio', async () => {
    await asUser(db, owner)
    const id = (
      await db.query<{ id: string }>(
        `select audit_log_write('company.update', 'company', 'x', '{"name":"a"}'::jsonb, '{"name":"b"}'::jsonb, '127.0.0.1', 'req-1') as id;`,
      )
    ).rows[0]!.id
    const row = await db.query<{
      company_id: string
      actor_user_id: string
      action: string
      correlation_id: string
    }>(`select company_id, actor_user_id, action, correlation_id from audit_logs where id = '${id}';`)
    expect(row.rows[0]!.actor_user_id).toBe(owner)
    expect(row.rows[0]!.action).toBe('company.update')
    expect(row.rows[0]!.correlation_id).toBe('req-1')
    expect(row.rows[0]!.company_id).toBe(
      (await db.query<{ c: string }>(`select get_current_company_id() as c;`)).rows[0]!.c,
    )
  })

  it('audit_log_write refuses a caller with no studio', async () => {
    await asUser(db, '99999999-9999-9999-9999-999999999999')
    await expect(db.query(`select audit_log_write('x', 'y');`)).rejects.toThrow(/no company/i)
  })
})

describe('CRM v2 — events, archive, merge, stats (0032 + 0034)', () => {
  let db: PGlite
  const owner = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id

  /**
   * The lead's own timeline, minus the automation chatter.
   *
   * A studio is seeded with default workflows, and those enrol on lead
   * creation and write their own events ("workflow: ... · notify_assignee").
   * They are real history and belong on the lead — but they are not what these
   * tests are about, and counting them made the assertions here depend on how
   * many default workflows the seed happens to ship.
   */
  const events = async (leadId: string) =>
    (
      await db.query<{ from_status: string | null; to_status: string | null; note: string | null }>(
        `select from_status, to_status, note from crm_lead_events
          where lead_id = '${leadId}' and coalesce(note, '') not like 'workflow:%'
          order by created_at;`,
      )
    ).rows

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@crm2.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM2 Studio','Owner');`)
  })

  it('a lead history starts at creation and records every stage move', async () => {
    const id = await add('Aanya', '9876600001')
    expect(await events(id)).toEqual([{ from_status: null, to_status: 'new', note: 'created' }])
    await db.exec(`update crm_leads set status = 'contacted' where id = '${id}';`)
    const trail = await events(id)
    expect(trail).toHaveLength(2)
    expect(trail[1]).toMatchObject({ from_status: 'new', to_status: 'contacted' })
    const stamped = await db.query<{ stage_changed_at: string | null }>(
      `select stage_changed_at from crm_leads where id = '${id}';`,
    )
    expect(stamped.rows[0]!.stage_changed_at).not.toBeNull()
  })

  it('archiving stamps archived_at, restoring clears it', async () => {
    const id = await add('Rahul', '9876600002')
    await db.exec(`update crm_leads set is_archived = true where id = '${id}';`)
    let r = await db.query<{ archived_at: string | null }>(
      `select archived_at from crm_leads where id = '${id}';`,
    )
    expect(r.rows[0]!.archived_at).not.toBeNull()
    await db.exec(`update crm_leads set is_archived = false where id = '${id}';`)
    r = await db.query<{ archived_at: string | null }>(
      `select archived_at from crm_leads where id = '${id}';`,
    )
    expect(r.rows[0]!.archived_at).toBeNull()
  })

  it('crm_stats counts only unarchived leads', async () => {
    const stats = await db.query<{ s: { total: number; byStatus: Record<string, number> } }>(
      `select crm_stats(current_date - 30, current_date) as s;`,
    )
    expect(stats.rows[0]!.s.total).toBe(2)
    expect(stats.rows[0]!.s.byStatus.contacted).toBe(1)
  })

  it('merge_leads archives the duplicates and notes it on the survivor', async () => {
    // Two rows for one number only happen when a typo is corrected later, so
    // seed the collision directly.
    const a = await add('Priya', '9876600003')
    const b = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, phone_norm, source, notes)
         values (get_current_company_id(), 'Priya S', '9876600003', crm_normalize_phone('9876600003'), 'manual', 'from the second form')
         returning id;`,
      )
    ).rows[0]!.id
    const groups = await db.query<{ lead_count: number }>(`select * from crm_duplicate_groups();`)
    expect(groups.rows[0]!.lead_count).toBe(2)

    const merged = await db.query<{ n: number }>(
      `select merge_leads('${a}', array['${b}']::uuid[]) as n;`,
    )
    expect(merged.rows[0]!.n).toBe(1)
    const dup = await db.query<{ is_archived: boolean }>(
      `select is_archived from crm_leads where id = '${b}';`,
    )
    expect(dup.rows[0]!.is_archived).toBe(true)
    const survivor = await db.query<{ notes: string }>(`select notes from crm_leads where id = '${a}';`)
    expect(survivor.rows[0]!.notes).toContain('from the second form')
    expect((await db.query(`select * from crm_duplicate_groups();`)).rows).toHaveLength(0)
  })
})

describe('CRM v3 — merge/unmerge, import, bulk undo, ranged stats, automations (0035)', () => {
  let db: PGlite
  const owner = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  const member = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id

  const lead = async (id: string) =>
    (
      await db.query<{
        status: string
        is_archived: boolean
        merged_into: string | null
        assigned_to: string | null
        is_hot: boolean
        follow_up_at: string | null
        notes: string | null
      }>(
        `select status, is_archived, merged_into, assigned_to, is_hot, follow_up_at, notes from crm_leads where id = '${id}';`,
      )
    ).rows[0]!

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@crm3.test'),('${member}','member@crm3.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM3 Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Meera', 'member@crm3.test');`,
    )
  })

  it('merge keeps the duplicate status, records merged_into, and unmerge puts it all back', async () => {
    const a = await add('Priya', '9876700001')
    const b = (
      await db.query<{ id: string }>(
        `insert into crm_leads (company_id, name, phone, phone_norm, source, status, notes)
         values (get_current_company_id(), 'Priya S', '9876700001', crm_normalize_phone('9876700001'), 'manual', 'qualified', 'second form')
         returning id;`,
      )
    ).rows[0]!.id

    const groups = await db.query<{ leads: { id: string; name: string }[] }>(
      `select * from crm_duplicate_groups();`,
    )
    expect(groups.rows[0]!.leads.map((l) => l.name)).toEqual(['Priya', 'Priya S'])

    await db.query(`select merge_leads('${a}', array['${b}']::uuid[]);`)
    let dup = await lead(b)
    expect(dup.is_archived).toBe(true)
    expect(dup.merged_into).toBe(a)
    expect(dup.status).toBe('qualified') // not forced to lost
    expect((await lead(a)).notes).toContain('[merged from')

    const restored = await db.query<{ n: number }>(`select unmerge_leads('${a}') as n;`)
    expect(restored.rows[0]!.n).toBe(1)
    dup = await lead(b)
    expect(dup.is_archived).toBe(false)
    expect(dup.merged_into).toBeNull()
    expect((await lead(a)).notes).toBeNull()
  })

  it('import is one transaction and counts duplicates honestly', async () => {
    await add('Known', '9876700002')
    const rows = JSON.stringify([
      { name: 'Known again', phone: '98767 00002' },
      { name: 'Fresh', phone: '9876700003', email: 'f@x.in', notes: 'from sheet' },
      { name: 'Junk', phone: '12' },
    ])
    const r = await db.query<{ r: { created: number; skipped: number; invalid: number; ids: string[] } }>(
      `select crm_import_leads('${rows}'::jsonb, true) as r;`,
    )
    expect(r.rows[0]!.r).toMatchObject({ created: 1, skipped: 1, invalid: 1 })
    expect(r.rows[0]!.r.ids).toHaveLength(1)
    const fresh = await db.query<{ source_key: string; notes: string }>(
      `select source_key, notes from crm_leads where id = '${r.rows[0]!.r.ids[0]}';`,
    )
    expect(fresh.rows[0]).toEqual({ source_key: 'csv_import', notes: 'from sheet' })
    // Not skipping inserts beside the existing row, for the duplicates tab.
    // Before 0156 this call silently skipped instead: p_mode defaulted to
    // 'skip', so the coalesce that was meant to fall back to this boolean
    // never reached it.
    const again = await db.query<{ r: { created: number; skipped: number } }>(
      `select crm_import_leads('[{"phone":"9876700002"}]'::jsonb, false) as r;`,
    )
    expect(again.rows[0]!.r).toMatchObject({ created: 1, skipped: 0 })
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from crm_leads where phone_norm = crm_normalize_phone('9876700002');`,
    )
    expect(count.rows[0]!.n).toBe(2)
  })

  it('bulk patch hands back a snapshot that restores exactly', async () => {
    const x = await add('Bulk A', '9876700010')
    const y = await add('Bulk B', '9876700011')
    const snap = await db.query<{ id: string; status: string; is_hot: boolean; is_archived: boolean }>(
      `select * from crm_bulk_patch(array['${x}','${y}']::uuid[], '{"status":"proposal_sent","is_hot":true}'::jsonb);`,
    )
    expect(snap.rows).toHaveLength(2)
    expect(snap.rows.every((r) => r.status === 'new' && r.is_hot === false)).toBe(true)
    expect((await lead(x)).status).toBe('proposal_sent')
    expect((await lead(x)).is_hot).toBe(true)

    const restored = await db.query<{ n: number }>(
      `select crm_restore_leads('${JSON.stringify(snap.rows)}'::jsonb) as n;`,
    )
    expect(restored.rows[0]!.n).toBe(2)
    expect((await lead(x)).status).toBe('new')
    expect((await lead(y)).is_hot).toBe(false)
  })

  it('bulk patch refuses a status the pipeline does not have', async () => {
    const x = await add('Bulk C', '9876700012')
    await expect(
      db.query(`select * from crm_bulk_patch(array['${x}']::uuid[], '{"status":"won"}'::jsonb);`),
    ).rejects.toThrow(/unknown status/)
  })

  it('ranged stats and the team view count the window, not all time', async () => {
    const w = await add('Won lead', '9876700020')
    await db.exec(`update crm_leads set assigned_to = '${member}' where id = '${w}';`)
    await db.exec(`update crm_leads set status = 'converted' where id = '${w}';`)
    const stats = await db.query<{ s: { won: number; created: number; conversion_rate: number } }>(
      `select crm_stats(current_date - 7, current_date) as s;`,
    )
    expect(stats.rows[0]!.s.won).toBe(1)
    expect(stats.rows[0]!.s.created).toBeGreaterThan(1)
    const old = await db.query<{ s: { won: number; created: number } }>(
      `select crm_stats(current_date - 30, current_date - 8) as s;`,
    )
    expect(old.rows[0]!.s).toMatchObject({ won: 0, created: 0 })
    await expect(db.query(`select crm_stats(current_date, current_date - 1);`)).rejects.toThrow(/range/)

    const team = await db.query<{ user_name: string; won: number; open: number }>(
      `select * from crm_team_stats(current_date - 7, current_date);`,
    )
    const meera = team.rows.find((r) => r.user_name === 'Meera')!
    expect(meera.won).toBe(1)
    expect(meera.open).toBe(0)
  })

  it('a one-step workflow fires on arrival, and its own update does not re-fire it', async () => {
    await workflow(db, 'Hot enquiries', 'lead_created', { source: 'enquiry' }, [{ kind: 'action', config: { action: 'mark_hot' } }])
    await workflow(db, 'Assign Meera', 'lead_created', {}, [{ kind: 'action', config: { action: 'assign_to', user_id: member } }])
    await workflow(db, 'Quote follow-up', 'stage_changed', { to_status: 'proposal_sent' }, [
      { kind: 'action', config: { action: 'set_follow_up_days', days: 2 } },
    ])
    const id = await add('Auto', '9876700030')
    const l = await lead(id)
    expect(l.is_hot).toBe(true)
    expect(l.assigned_to).toBe(member)
    // Scoped to the workflows this test built. A studio is seeded with default
    // workflows of its own ("New lead not contacted", "Unassigned lead", ...)
    // which enrol on arrival too and write their own lines — real history, but
    // not what is under test, and counting them would tie this assertion to
    // however many defaults the seed happens to ship.
    const ours = `note in ('workflow: Hot enquiries · mark_hot', 'workflow: Assign Meera · assign_to', 'workflow: Quote follow-up · set_follow_up_days')`
    const trail = await db.query<{ note: string | null }>(
      `select note from crm_lead_events where lead_id = '${id}' and ${ours} order by created_at;`,
    )
    expect(trail.rows.map((r) => r.note)).toEqual(['workflow: Hot enquiries · mark_hot', 'workflow: Assign Meera · assign_to'])

    await db.exec(`update crm_leads set status = 'proposal_sent' where id = '${id}';`)
    expect((await lead(id)).follow_up_at).not.toBeNull()
    // Exactly one application per workflow: the nested updates did not loop.
    const applied = await db.query<{ n: number }>(
      `select count(*)::int as n from crm_lead_events where lead_id = '${id}' and ${ours};`,
    )
    expect(applied.rows[0]!.n).toBe(3)
  })

  it('the follow-up sweep notifies the owner once a day and records a run', async () => {
    const id = await add('Late', '9876700040')
    await db.exec(
      `update crm_leads set assigned_to = '${member}', follow_up_at = now() - interval '2 days' where id = '${id}';`,
    )
    const first = await db.query<{ s: { overdue: number; notified: number } }>(
      `select run_crm_followup_cron(false) as s;`,
    )
    expect(first.rows[0]!.s.overdue).toBeGreaterThanOrEqual(1)
    expect(first.rows[0]!.s.notified).toBeGreaterThanOrEqual(1)
    const second = await db.query<{ s: { notified: number } }>(`select run_crm_followup_cron(false) as s;`)
    expect(second.rows[0]!.s.notified).toBe(0)
    const runs = await db.query<{ n: number }>(
      `select count(*)::int as n from cron_runs where job_name = 'crm_followup_cron' and finished_at is not null;`,
    )
    expect(runs.rows[0]!.n).toBe(2)
    const notif = await db.query<{ type: string }>(
      `select type from notifications where recipient_uid = '${member}' and entity_id = '${id}';`,
    )
    expect(notif.rows[0]!.type).toBe('crm_overdue')
  })

  it('an owner can correct attendance; an employee cannot; a stranger is refused', async () => {
    await asUser(db, owner)
    const id = (
      await db.query<{ id: string }>(
        `select set_attendance_manual('${member}', current_date, 'present',
           now() - interval '8 hours', now(), 'Forgot to tap in') as id;`,
      )
    ).rows[0]!.id
    const row = await db.query<{ status: string; corrected_by: string; correction_note: string }>(
      `select status, corrected_by, correction_note from attendance where id = '${id}';`,
    )
    expect(row.rows[0]).toEqual({ status: 'present', corrected_by: owner, correction_note: 'Forgot to tap in' })
    // Correcting again replaces rather than duplicating.
    await db.query(`select set_attendance_manual('${member}', current_date, 'late', null, null, null);`)
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from attendance where user_id = '${member}' and a_date = current_date;`,
    )
    expect(count.rows[0]!.n).toBe(1)

    await expect(
      db.query(
        `select set_attendance_manual('${owner}', current_date, 'present', now(), now() - interval '1 hour');`,
      ),
    ).rejects.toThrow(/before/)
    await expect(
      db.query(
        `select set_attendance_manual('99999999-9999-9999-9999-999999999999', current_date, 'present');`,
      ),
    ).rejects.toThrow(/unknown_member/)

    await asUser(db, member)
    await expect(
      db.query(`select set_attendance_manual('${member}', current_date, 'present');`),
    ).rejects.toThrow(/not allowed/)
  })
})

describe('CRM v4 — saved views, SLA, cadences, conversion (0036)', () => {
  let db: PGlite
  const owner = '12121212-1212-1212-1212-121212121212'
  const member = '34343434-3434-3434-3434-343434343434'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@crm4.test'),('${member}','member@crm4.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM4 Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Meera', 'member@crm4.test');`,
    )
  })

  it('a saved view belongs to one person and one name', async () => {
    await asUser(db, owner)
    await db.exec(
      `insert into crm_saved_views (company_id, user_id, name, query)
       values (get_current_company_id(), '${owner}', 'My overdue', '{"filters":["overdue"]}');`,
    )
    await expect(
      db.exec(
        `insert into crm_saved_views (company_id, user_id, name, query)
         values (get_current_company_id(), '${owner}', 'My overdue', '{}');`,
      ),
    ).rejects.toThrow()
    // Another person may use the same name.
    await db.exec(
      `insert into crm_saved_views (company_id, user_id, name, query)
       values (get_current_company_id(), '${member}', 'My overdue', '{}');`,
    )
    const n = await db.query<{ n: number }>(`select count(*)::int as n from crm_saved_views;`)
    expect(n.rows[0]!.n).toBe(2)
  })

  it('the SLA target defaults to 24h and follows the settings row', async () => {
    await asUser(db, owner)
    expect((await db.query<{ h: number }>(`select crm_sla_hours() as h;`)).rows[0]!.h).toBe(24)
    await db.exec(`insert into crm_settings (company_id, sla_hours) values (get_current_company_id(), 4);`)
    expect((await db.query<{ h: number }>(`select crm_sla_hours() as h;`)).rows[0]!.h).toBe(4)
    await expect(db.exec(`update crm_settings set sla_hours = 0;`)).rejects.toThrow()
  })

  it('converting a lead creates the client and the project and marks the lead', async () => {
    await asUser(db, owner)
    const lead = await add('Aanya Sharma', '9876800001')
    const r = await db.query<{ client_id: string; project_id: string }>(
      `select * from convert_lead_to_project('${lead}', null, '{"city":"Mumbai"}'::jsonb,
         '{"name":"Aanya wedding","package_cost":150000}'::jsonb);`,
    )
    const { client_id, project_id } = r.rows[0]!
    const client = await db.query<{ name: string; phone: string; city: string }>(
      `select name, phone, city from clients where id = '${client_id}';`,
    )
    expect(client.rows[0]).toEqual({ name: 'Aanya Sharma', phone: '9876800001', city: 'Mumbai' })
    const project = await db.query<{ name: string; package_cost: number; client_id: string }>(
      `select name, package_cost, client_id from projects where id = '${project_id}';`,
    )
    expect(project.rows[0]).toMatchObject({ name: 'Aanya wedding', client_id })
    expect(Number(project.rows[0]!.package_cost)).toBe(150000)
    const l = await db.query<{ status: string; converted_project_id: string; converted_at: string | null }>(
      `select status, converted_project_id, converted_at from crm_leads where id = '${lead}';`,
    )
    expect(l.rows[0]!.status).toBe('converted')
    expect(l.rows[0]!.converted_project_id).toBe(project_id)
    expect(l.rows[0]!.converted_at).not.toBeNull()
    // Twice is refused; an existing client is honoured.
    await expect(db.query(`select * from convert_lead_to_project('${lead}');`)).rejects.toThrow(/already/)
    const lead2 = await add('Rahul', '9876800002')
    const r2 = await db.query<{ client_id: string }>(
      `select * from convert_lead_to_project('${lead2}', '${client_id}', '{}', '{"name":"Second shoot"}');`,
    )
    expect(r2.rows[0]!.client_id).toBe(client_id)
  })

  it('a cadence schedules each step in turn, and stops when the lead closes', async () => {
    await asUser(db, owner)
    const cad = (
      await db.query<{ id: string }>(
        `insert into crm_cadences (company_id, name) values (get_current_company_id(), 'Wedding follow-up') returning id;`,
      )
    ).rows[0]!.id
    await db.exec(
      `insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, note)
       values ('${cad}', get_current_company_id(), 1, 0, 'Call'), ('${cad}', get_current_company_id(), 2, 3, 'Send quote');`,
    )
    const lead = await add('Cadence lead', '9876800010')
    await db.exec(`update crm_leads set assigned_to = '${member}' where id = '${lead}';`)
    await db.query(`select start_lead_cadence('${lead}', '${cad}');`)
    let lc = await db.query<{ step_no: number; next_at: string }>(
      `select step_no, next_at from crm_lead_cadences where lead_id = '${lead}';`,
    )
    expect(lc.rows[0]!.step_no).toBe(1)
    const follow = await db.query<{ f: string }>(`select follow_up_at as f from crm_leads where id = '${lead}';`)
    expect(new Date(follow.rows[0]!.f).getTime()).toBe(new Date(lc.rows[0]!.next_at).getTime())

    // Make step 1 due and sweep: notification to the owner, moved to step 2.
    await db.exec(`update crm_lead_cadences set next_at = now() - interval '1 minute' where lead_id = '${lead}';`)
    const sweep = await db.query<{ s: { cadences: { due: number; advanced: number; completed: number } } }>(
      `select run_crm_followup_cron(false) as s;`,
    )
    expect(sweep.rows[0]!.s.cadences).toMatchObject({ due: 1, advanced: 1, completed: 0 })
    lc = await db.query<{ step_no: number; next_at: string }>(
      `select step_no, next_at from crm_lead_cadences where lead_id = '${lead}';`,
    )
    expect(lc.rows[0]!.step_no).toBe(2)
    const notif = await db.query<{ type: string; title: string }>(
      `select type, title from notifications where recipient_uid = '${member}' and entity_id = '${lead}' and type = 'crm_cadence';`,
    )
    expect(notif.rows[0]!.title).toContain('step 1')

    // Final step completes it.
    await db.exec(`update crm_lead_cadences set next_at = now() - interval '1 minute' where lead_id = '${lead}';`)
    await db.query(`select run_crm_followup_cron(false);`)
    const done = await db.query<{ completed_at: string | null }>(
      `select completed_at from crm_lead_cadences where lead_id = '${lead}';`,
    )
    expect(done.rows[0]!.completed_at).not.toBeNull()

    // A lead that closes mid-cadence is taken off it.
    const lead2 = await add('Closes early', '9876800011')
    await db.query(`select start_lead_cadence('${lead2}', '${cad}');`)
    await db.exec(`update crm_leads set status = 'lost', lost_reason = 'Went elsewhere' where id = '${lead2}';`)
    const stopped = await db.query<{ stopped_at: string | null }>(
      `select stopped_at from crm_lead_cadences where lead_id = '${lead2}';`,
    )
    expect(stopped.rows[0]!.stopped_at).not.toBeNull()
    expect(
      (await db.query<{ ok: boolean }>(`select stop_lead_cadence('${lead2}') as ok;`)).rows[0]!.ok,
    ).toBe(false)
  })

  it('a workflow can start a cadence on arrival', async () => {
    await asUser(db, owner)
    const cad = (
      await db.query<{ id: string }>(
        `select id from crm_cadences where name = 'Wedding follow-up';`,
      )
    ).rows[0]!.id
    await workflow(db, 'Auto cadence', 'lead_created', { source: 'enquiry' }, [
      { kind: 'action', config: { action: 'start_cadence', cadence_id: cad } },
    ])
    const lead = await add('Auto cadence lead', '9876800020')
    const lc = await db.query<{ cadence_id: string }>(`select cadence_id from crm_lead_cadences where lead_id = '${lead}';`)
    expect(lc.rows[0]!.cadence_id).toBe(cad)
  })

  it('losing a lead needs its reason, and leaving lost clears it', async () => {
    await asUser(db, owner)
    const lead = await add('Slips away', '9876800040')
    await expect(db.exec(`update crm_leads set status = 'lost' where id = '${lead}';`)).rejects.toThrow(
      /lost_reason required/,
    )
    await expect(db.exec(`update crm_leads set status = 'lost', lost_reason = 'No' where id = '${lead}';`)).rejects.toThrow(
      /lost_reason required/,
    )
    await db.exec(`update crm_leads set status = 'lost', lost_reason = 'No response' where id = '${lead}';`)
    const reason = await db.query<{ lost_reason: string }>(`select lost_reason from crm_leads where id = '${lead}';`)
    expect(reason.rows[0]!.lost_reason).toBe('No response')
    await db.exec(`update crm_leads set status = 'contacted' where id = '${lead}';`)
    const cleared = await db.query<{ lost_reason: string | null }>(
      `select lost_reason from crm_leads where id = '${lead}';`,
    )
    expect(cleared.rows[0]!.lost_reason).toBeNull()
  })

  it('a bulk move to lost carries its reason, and undo puts the stage back', async () => {
    await asUser(db, owner)
    const a = await add('Bulk lost A', '9876800041')
    const b = await add('Bulk lost B', '9876800042')
    await expect(
      db.query(`select * from crm_bulk_patch(array['${a}','${b}']::uuid[], '{"status":"lost"}');`),
    ).rejects.toThrow(/lost_reason required/)
    const before = await db.query<{ id: string; lost_reason: string | null }>(
      `select * from crm_bulk_patch(array['${a}','${b}']::uuid[], '{"status":"lost","lost_reason":"Budget"}');`,
    )
    expect(before.rows).toHaveLength(2)
    expect(before.rows[0]!.lost_reason).toBeNull()
    const after = await db.query<{ status: string; lost_reason: string }>(
      `select status, lost_reason from crm_leads where id in ('${a}','${b}') order by id;`,
    )
    expect(after.rows.map((r) => [r.status, r.lost_reason])).toEqual([
      ['lost', 'Budget'],
      ['lost', 'Budget'],
    ])
    await db.query(`select crm_restore_leads('${JSON.stringify(before.rows)}');`)
    const restored = await db.query<{ status: string; lost_reason: string | null }>(
      `select status, lost_reason from crm_leads where id in ('${a}','${b}');`,
    )
    expect(restored.rows.every((r) => r.status === 'new')).toBe(true)
    expect(restored.rows.every((r) => r.lost_reason === null)).toBe(true)
  })

  it('a new lead arrives with a probability and an SLA deadline', async () => {
    await asUser(db, owner)
    const lead = await add('Fresh arrival', '9876800043')
    const row = await db.query<{ probability: number; sla_due_at: string | null }>(
      `select probability, sla_due_at from crm_leads where id = '${lead}';`,
    )
    expect(row.rows[0]!.probability).toBe(10)
    expect(row.rows[0]!.sla_due_at).not.toBeNull()
  })

  it('the team view counts first contact within the SLA', async () => {
    await asUser(db, owner)
    const fast = await add('Fast', '9876800030')
    const slow = await add('Slow', '9876800031')
    await db.exec(`update crm_leads set assigned_to = '${member}' where id in ('${fast}','${slow}');`)
    await db.exec(`update crm_leads set status = 'contacted' where id = '${fast}';`)
    // Contacted 10 hours after arrival, against the 4h target set above.
    await db.exec(
      `update crm_leads set status = 'contacted', last_contacted_at = created_at + interval '10 hours' where id = '${slow}';`,
    )
    const team = await db.query<{ user_name: string; within_sla: number; sla_hours: number }>(
      `select user_name, within_sla, sla_hours from crm_team_stats(current_date - 7, current_date);`,
    )
    const meera = team.rows.find((r) => r.user_name === 'Meera')!
    expect(meera.sla_hours).toBe(4)
    expect(meera.within_sla).toBe(1)
  })
})

describe('CRM objects — pipelines, stages, contacts, forecast, SLA sweep (0038)', () => {
  let db: PGlite
  const owner = '56565656-5656-5656-5656-565656565656'
  const member = '78787878-7878-7878-7878-787878787878'
  const stages: Record<string, string> = {}
  let pipeline = ''

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id
  const lead = async (id: string) =>
    (
      await db.query<{
        status: string
        stage_id: string
        pipeline_id: string
        contact_id: string
        probability: number
        lost_reason: string | null
        phone_norm: string | null
      }>(`select status, stage_id, pipeline_id, contact_id, probability, lost_reason, phone_norm from crm_leads where id = '${id}';`)
    ).rows[0]!

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@crm5.test'),('${member}','member@crm5.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM5 Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Meera', 'member@crm5.test');`,
    )
    const rows = await db.query<{ id: string; key: string; pipeline_id: string }>(
      `select id, key, pipeline_id from crm_pipeline_stages where company_id = get_current_company_id() order by position;`,
    )
    for (const r of rows.rows) stages[r.key] = r.id
    pipeline = rows.rows[0]!.pipeline_id
  })

  it('a new studio gets the Sales pipeline, six stages and a lost-reason list', async () => {
    expect(Object.keys(stages)).toEqual(['new', 'contacted', 'qualified', 'proposal_sent', 'converted', 'lost'])
    const p = await db.query<{ name: string; is_default: boolean }>(`select name, is_default from crm_pipelines;`)
    expect(p.rows).toEqual([{ name: 'Sales', is_default: true }])
    const reasons = await db.query<{ n: number }>(`select count(*)::int as n from crm_lost_reasons;`)
    expect(reasons.rows[0]!.n).toBe(5)
  })

  it('a lead lands in the default pipeline, in the stage for its status, with a contact', async () => {
    const id = await add('Aanya', '9876900001')
    const l = await lead(id)
    expect(l.pipeline_id).toBe(pipeline)
    expect(l.stage_id).toBe(stages.new)
    expect(l.probability).toBe(10)
    expect(l.contact_id).not.toBeNull()
    const c = await db.query<{ name: string; phone_norm: string; lifecycle: string }>(
      `select name, phone_norm, lifecycle from crm_contacts where id = '${l.contact_id}';`,
    )
    expect(c.rows[0]).toEqual({ name: 'Aanya', phone_norm: '919876900001', lifecycle: 'lead' })

    // A second row with the same number (an import beside a known lead) shares the contact.
    await db.exec(
      `insert into crm_leads (company_id, name, phone, phone_norm, source) values (get_current_company_id(), 'Aanya again', '9876900001', null, 'manual');`,
    )
    const shared = await db.query<{ n: number }>(
      `select count(distinct contact_id)::int as n from crm_leads where phone_norm = '919876900001';`,
    )
    expect(shared.rows[0]!.n).toBe(1)
  })

  it('moving the stage derives the status, and moving the status derives the stage', async () => {
    const id = await add('Stage lead', '9876900002')
    await db.exec(`update crm_leads set stage_id = '${stages.qualified}' where id = '${id}';`)
    let l = await lead(id)
    expect(l.status).toBe('qualified')
    expect(l.probability).toBe(50)
    const events = await db.query<{ to_status: string }>(
      `select to_status from crm_lead_events where lead_id = '${id}' and from_status = 'new';`,
    )
    expect(events.rows[0]!.to_status).toBe('qualified')

    await db.exec(`update crm_leads set status = 'converted' where id = '${id}';`)
    l = await lead(id)
    expect(l.stage_id).toBe(stages.converted)
    expect(l.probability).toBe(100)
    const c = await db.query<{ lifecycle: string }>(`select lifecycle from crm_contacts where id = '${l.contact_id}';`)
    expect(c.rows[0]!.lifecycle).toBe('customer')
  })

  it('crm_move_stage refuses lost without a reason, another pipeline, a full stage and missing fields', async () => {
    const id = await add('Move lead', '9876900003')
    await expect(db.query(`select crm_move_stage('${id}', '${stages.lost}');`)).rejects.toThrow(/lost_reason/)
    expect(
      (await db.query<{ s: string }>(`select crm_move_stage('${id}', '${stages.lost}', 'Budget', 'Other Studio') as s;`)).rows[0]!.s,
    ).toBe('lost')
    const l = await db.query<{ lost_reason: string; lost_competitor: string }>(
      `select lost_reason, lost_competitor from crm_leads where id = '${id}';`,
    )
    expect(l.rows[0]).toEqual({ lost_reason: 'Budget', lost_competitor: 'Other Studio' })
    // Back to open clears the reason.
    await db.query(`select crm_move_stage('${id}', '${stages.contacted}');`)
    expect((await lead(id)).lost_reason).toBeNull()

    // A stage from another pipeline is refused.
    const other = (
      await db.query<{ id: string }>(
        `insert into crm_pipelines (company_id, name) values (get_current_company_id(), 'Corporate') returning id;`,
      )
    ).rows[0]!.id
    const foreign = (
      await db.query<{ id: string }>(
        `insert into crm_pipeline_stages (pipeline_id, company_id, name, key, position) values ('${other}', get_current_company_id(), 'Brief', 'brief', 0) returning id;`,
      )
    ).rows[0]!.id
    await expect(db.query(`select crm_move_stage('${id}', '${foreign}');`)).rejects.toThrow(/another pipeline/)

    // WIP limit counts the deals already there.
    await db.exec(`update crm_pipeline_stages set wip_limit = 1 where id = '${stages.qualified}';`)
    const second = await add('Second', '9876900004')
    await db.query(`select crm_move_stage('${id}', '${stages.qualified}');`)
    await expect(db.query(`select crm_move_stage('${second}', '${stages.qualified}');`)).rejects.toThrow(/full/)
    await db.exec(`update crm_pipeline_stages set wip_limit = null where id = '${stages.qualified}';`)

    // Required fields gate the move until they are filled.
    await db.exec(`update crm_pipeline_stages set required_fields = '{deal_value,close_date}' where id = '${stages.proposal_sent}';`)
    await expect(db.query(`select crm_move_stage('${second}', '${stages.proposal_sent}');`)).rejects.toThrow(/deal_value, close_date/)
    await db.exec(`update crm_leads set deal_value = 50000, close_date = current_date + 30 where id = '${second}';`)
    expect(
      (await db.query<{ s: string }>(`select crm_move_stage('${second}', '${stages.proposal_sent}') as s;`)).rows[0]!.s,
    ).toBe('proposal_sent')
  })

  it('a custom open stage still maps to a legacy status by rank', async () => {
    const custom = (
      await db.query<{ id: string }>(
        `insert into crm_pipeline_stages (pipeline_id, company_id, name, key, position, kind, probability_default)
         values ('${pipeline}', get_current_company_id(), 'Negotiation', 'negotiation', 3, 'open', 80) returning id;`,
      )
    ).rows[0]!.id
    expect((await db.query<{ s: string }>(`select crm_stage_status('${custom}') as s;`)).rows[0]!.s).toBe('proposal_sent')
    const id = await add('Custom stage', '9876900005')
    await db.exec(`update crm_leads set stage_id = '${custom}' where id = '${id}';`)
    const l = await lead(id)
    expect(l.status).toBe('proposal_sent')
    expect(l.probability).toBe(80)
    await db.exec(`delete from crm_pipeline_stages where id = '${custom}';`)
  })

  it('editing the phone re-normalises it and relinks the contact', async () => {
    const id = await add('Renumber', '9876900006')
    const before = await lead(id)
    await db.exec(`update crm_leads set phone = '+91 98769 00007' where id = '${id}';`)
    const after = await lead(id)
    expect(after.phone_norm).toBe('919876900007')
    expect(after.contact_id).not.toBe(before.contact_id)
  })

  it('a bulk edit can lose leads with a reason, and undo puts the deal fields back', async () => {
    const a = await add('Bulk lost A', '9876900010')
    const b = await add('Bulk lost B', '9876900011')
    await db.exec(`update crm_leads set deal_value = 12000 where id = '${a}';`)
    await expect(
      db.query(`select * from crm_bulk_patch(array['${a}','${b}']::uuid[], '{"status":"lost"}'::jsonb);`),
    ).rejects.toThrow(/lost_reason/)
    const snap = await db.query<{ id: string; deal_value: string | null; stage_id: string; lost_reason: string | null }>(
      `select * from crm_bulk_patch(array['${a}','${b}']::uuid[], '{"status":"lost","lost_reason":"No response"}'::jsonb);`,
    )
    expect(snap.rows).toHaveLength(2)
    expect(Number(snap.rows.find((r) => r.id === a)!.deal_value)).toBe(12000)
    expect((await lead(a)).status).toBe('lost')
    expect((await lead(a)).lost_reason).toBe('No response')
    await db.query(`select crm_restore_leads('${JSON.stringify(snap.rows)}'::jsonb);`)
    const restored = await lead(a)
    expect(restored.status).toBe('new')
    expect(restored.stage_id).toBe(stages.new)
    expect(restored.lost_reason).toBeNull()

    // Moving by stage works the same way.
    const snap2 = await db.query(
      `select * from crm_bulk_patch(array['${b}']::uuid[], '{"stage_id":"${stages.contacted}"}'::jsonb);`,
    )
    expect(snap2.rows).toHaveLength(1)
    expect((await lead(b)).status).toBe('contacted')
  })

  it('two people can share a team view under the same name; one person cannot repeat a private name', async () => {
    await asUser(db, owner)
    await db.exec(
      `insert into crm_saved_views (company_id, user_id, name, query, visibility) values (get_current_company_id(), '${owner}', 'Hot this week', '{}', 'private');`,
    )
    await expect(
      db.exec(
        `insert into crm_saved_views (company_id, user_id, name, query, visibility) values (get_current_company_id(), '${owner}', 'Hot this week', '{}', 'private');`,
      ),
    ).rejects.toThrow()
    await db.exec(
      `insert into crm_saved_views (company_id, user_id, name, query, visibility) values (get_current_company_id(), '${owner}', 'Team overdue', '{}', 'team');`,
    )
    // The old unique (user_id, name) would have refused this second row.
    await db.exec(
      `insert into crm_saved_views (company_id, user_id, name, query, visibility) values (get_current_company_id(), '${member}', 'Hot this week', '{}', 'private');`,
    )
    const n = await db.query<{ n: number }>(`select count(*)::int as n from crm_saved_views where name = 'Hot this week';`)
    expect(n.rows[0]!.n).toBe(2)
  })

  it('the forecast weights open deals by probability and groups by stage', async () => {
    const x = await add('Forecast X', '9876900020')
    const y = await add('Forecast Y', '9876900021')
    await db.exec(`update crm_leads set deal_value = 100000, stage_id = '${stages.qualified}' where id = '${x}';`)
    await db.exec(`update crm_leads set deal_value = 40000, stage_id = '${stages.converted}' where id = '${y}';`)
    const f = await db.query<{
      f: { count: number; total_value: number; weighted: number; won_value: number; by_stage: Array<{ name: string; count: number }> }
    }>(`select crm_forecast(current_date - 1, current_date + 1) as f;`)
    const r = f.rows[0]!.f
    expect(Number(r.won_value)).toBe(40000)
    expect(Number(r.total_value)).toBeGreaterThanOrEqual(140000)
    // 100000 at 50% + 40000 at 100%, plus whatever earlier leads carry.
    expect(Number(r.weighted)).toBeGreaterThanOrEqual(90000)
    expect(r.by_stage.find((s) => s.name === 'Won')!.count).toBeGreaterThanOrEqual(1)
  })

  it('the SLA sweep notifies once a day and writes the breach once', async () => {
    const id = await add('SLA lead', '9876900030')
    await db.exec(`update crm_leads set sla_due_at = now() - interval '2 hours', assigned_to = null where id = '${id}';`)
    const first = await db.query<{ s: { sla: { breached: number; notified: number } } }>(`select run_crm_followup_cron(false) as s;`)
    expect(first.rows[0]!.s.sla.breached).toBeGreaterThanOrEqual(1)
    expect(first.rows[0]!.s.sla.notified).toBeGreaterThanOrEqual(1)
    const again = await db.query<{ s: { sla: { notified: number } } }>(`select run_crm_followup_cron(false) as s;`)
    expect(again.rows[0]!.s.sla.notified).toBe(0)
    // Unassigned: the studio owner hears about it.
    const notif = await db.query<{ n: number }>(
      `select count(*)::int as n from notifications where recipient_uid = '${owner}' and entity_id = '${id}' and type = 'crm_sla';`,
    )
    expect(notif.rows[0]!.n).toBe(1)
    const ev = await db.query<{ n: number }>(
      `select count(*)::int as n from crm_lead_events where lead_id = '${id}' and note = 'SLA breached';`,
    )
    expect(ev.rows[0]!.n).toBe(1)
  })

  it('changing the SLA target moves the deadline on every lead still waiting', async () => {
    const id = await add('SLA target', '9876900031')
    await db.query(`select crm_set_sla_hours(4);`)
    const l = await db.query<{ ok: boolean }>(
      `select sla_due_at = created_at + interval '4 hours' as ok from crm_leads where id = '${id}';`,
    )
    expect(l.rows[0]!.ok).toBe(true)
    await asUser(db, member)
    await expect(db.query(`select crm_set_sla_hours(8);`)).rejects.toThrow(/not allowed/)
    await asUser(db, owner)
  })
})

describe('CRM activities — timeline, replies, tasks, integrations (0039)', () => {
  let db: PGlite
  const owner = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a'
  const member = '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@crm6.test'),('${member}','member@crm6.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM6 Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Meera', 'member@crm6.test');`,
    )
  })

  it('an activity takes its actor, contact and task owner from context', async () => {
    const lead = await add('Activity lead', '9876950001')
    await db.exec(`update crm_leads set assigned_to = '${member}' where id = '${lead}';`)
    const a = await db.query<{ actor_id: string; contact_id: string; assigned_to: string; duration_s: number }>(
      `insert into crm_activities (company_id, lead_id, type, direction, subject, started_at, ended_at)
       values (get_current_company_id(), '${lead}', 'call', 'out', 'Intro call', now() - interval '10 minutes', now())
       returning actor_id, contact_id, assigned_to, duration_s;`,
    )
    expect(a.rows[0]!.actor_id).toBe(owner)
    expect(a.rows[0]!.contact_id).not.toBeNull()
    expect(a.rows[0]!.duration_s).toBe(600)
    const t = await db.query<{ assigned_to: string }>(
      `insert into crm_activities (company_id, lead_id, type, subject, due_at)
       values (get_current_company_id(), '${lead}', 'task', 'Send quote', now() + interval '1 day') returning assigned_to;`,
    )
    expect(t.rows[0]!.assigned_to).toBe(member)
    // An outbound call is the first contact.
    const l = await db.query<{ last_contacted_at: string | null }>(`select last_contacted_at from crm_leads where id = '${lead}';`)
    expect(l.rows[0]!.last_contacted_at).not.toBeNull()
  })

  it('an inbound reply stops the cadence and notes it on the trail', async () => {
    const cad = (
      await db.query<{ id: string }>(
        `insert into crm_cadences (company_id, name) values (get_current_company_id(), 'Reply test') returning id;`,
      )
    ).rows[0]!.id
    await db.exec(
      `insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, note) values ('${cad}', get_current_company_id(), 1, 0, 'Call');`,
    )
    const lead = await add('Replies', '9876950002')
    await db.query(`select start_lead_cadence('${lead}', '${cad}');`)
    await db.exec(
      `insert into crm_activities (company_id, lead_id, type, direction, subject) values (get_current_company_id(), '${lead}', 'whatsapp', 'in', 'Yes please');`,
    )
    const lc = await db.query<{ stopped_at: string | null }>(`select stopped_at from crm_lead_cadences where lead_id = '${lead}';`)
    expect(lc.rows[0]!.stopped_at).not.toBeNull()
    const ev = await db.query<{ note: string }>(
      `select note from crm_lead_events where lead_id = '${lead}' and note like 'replied via whatsapp%';`,
    )
    expect(ev.rows[0]!.note).toContain('cadence stopped: Reply test')
  })

  it('a due task notifies its owner once a day through the hourly tick', async () => {
    const lead = await add('Task lead', '9876950003')
    await db.exec(
      `insert into crm_activities (company_id, lead_id, type, subject, due_at, assigned_to)
       values (get_current_company_id(), '${lead}', 'task', 'Call back', now() - interval '1 hour', '${member}');`,
    )
    const first = await db.query<{ s: { tasks: { due: number; notified: number } } }>(`select run_crm_followup_cron(false) as s;`)
    expect(first.rows[0]!.s.tasks).toMatchObject({ due: 1, notified: 1 })
    const again = await db.query<{ s: { tasks: { notified: number } } }>(`select run_crm_followup_cron(false) as s;`)
    expect(again.rows[0]!.s.tasks.notified).toBe(0)
    const n = await db.query<{ title: string }>(
      `select title from notifications where recipient_uid = '${member}' and type = 'crm_task';`,
    )
    expect(n.rows[0]!.title).toBe('Task due: Call back')
    // Done tasks are not chased.
    await db.exec(`update crm_activities set done_at = now() where type = 'task' and lead_id = '${lead}';`)
    const dry = await db.query<{ s: { tasks: { due: number } } }>(`select run_crm_followup_cron(true) as s;`)
    expect(dry.rows[0]!.s.tasks.due).toBe(0)
  })

  it('a synced message is filed once per provider id', async () => {
    const lead = await add('Synced', '9876950004')
    const ins = `insert into crm_activities (company_id, lead_id, type, direction, subject, provider, external_id)
       values (get_current_company_id(), '${lead}', 'email', 'in', 'Re: quote', 'gmail', 'msg-1')
       on conflict (company_id, provider, external_id) where external_id is not null do nothing returning id;`
    expect((await db.query(ins)).rows).toHaveLength(1)
    expect((await db.query(ins)).rows).toHaveLength(0)
  })

  it('one integration row per provider', async () => {
    await asUser(db, owner)
    await db.exec(
      `insert into crm_integrations (company_id, provider, status, connected_by) values (get_current_company_id(), 'twilio', 'connected', '${owner}');`,
    )
    const r = await db.query<{ status: string }>(`select status from crm_integrations where provider = 'twilio';`)
    expect(r.rows[0]!.status).toBe('connected')
    await expect(
      db.exec(`insert into crm_integrations (company_id, provider, status) values (get_current_company_id(), 'twilio', 'error');`),
    ).rejects.toThrow()
  })
})

describe('CRM workflows — delays, branches, replies, scoring, outbox (0040)', () => {
  let db: PGlite
  const owner = '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c'
  const member = '6d6d6d6d-6d6d-4d6d-8d6d-6d6d6d6d6d6d'

  const add = async (name: string, phone: string, email: string | null = null, source = 'enquiry') =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', ${email ? `'${email}'` : 'null'}, '${source}', null, null) as id;`,
      )
    ).rows[0]!.id
  const enrollment = async (wf: string, lead: string) =>
    (
      await db.query<{ status: string; current_step: number; next_at: string | null; exit_reason: string | null; steps_run: number }>(
        `select status, current_step, next_at, exit_reason, steps_run from crm_workflow_enrollments where workflow_id = '${wf}' and lead_id = '${lead}' order by enrolled_at desc limit 1;`,
      )
    ).rows[0]!

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${owner}','owner@crm7.test'),('${member}','member@crm7.test');`,
    )
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM7 Studio','Owner');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', get_current_company_id(), 'employee', 'Meera', 'member@crm7.test');`,
    )
  })

  it('existing rules were migrated into one-step workflows and switched off', async () => {
    // The migration ran before this studio existed; prove the shape by hand.
    await db.exec(
      `insert into crm_automation_rules (company_id, name, trigger, condition, action, action_value)
       values (get_current_company_id(), 'Legacy rule', 'lead_created', '{}', 'mark_hot', '{}');`,
    )
    await db.exec(readMig('0047_crm_workflows.sql'))
    const wf = await db.query<{ name: string; is_active: boolean; kind: string; config: { action: string } }>(
      `select w.name, w.is_active, s.kind, s.config from crm_workflows w join crm_workflow_steps s on s.workflow_id = w.id where w.name = 'Legacy rule';`,
    )
    expect(wf.rows[0]).toMatchObject({ name: 'Legacy rule', is_active: true, kind: 'action', config: { action: 'mark_hot' } })
    const rule = await db.query<{ is_active: boolean }>(`select is_active from crm_automation_rules where name = 'Legacy rule';`)
    expect(rule.rows[0]!.is_active).toBe(false)
    await db.exec(`update crm_workflows set is_active = false where name = 'Legacy rule';`)
  })

  it('a delay pauses the enrollment and a branch picks the path when it resumes', async () => {
    const wf = await workflow(db, 'Nurture', 'lead_created', {}, [
      { kind: 'action', config: { action: 'add_note', note: 'welcome' } },
      { kind: 'delay', config: { amount: 1, unit: 'hours' } },
      { kind: 'branch', config: { conditions: [{ field: 'is_hot', op: 'eq', value: true }], yes_step: 4, no_step: 5 } },
      { kind: 'action', config: { action: 'add_score', points: 10 } },
      { kind: 'exit' },
    ])
    const cold = await add('Cold', '9876960001')
    const hot = await add('Hot', '9876960002')
    let e = await enrollment(wf, cold)
    expect(e.status).toBe('active')
    expect(e.current_step).toBe(3)
    expect(e.next_at).not.toBeNull()
    expect((await db.query<{ notes: string }>(`select notes from crm_leads where id = '${cold}';`)).rows[0]!.notes).toContain('welcome')

    // Nothing runs before the delay is up.
    const early = await db.query<{ s: { workflows: { due: number } } }>(`select run_crm_followup_cron(false) as s;`)
    expect(early.rows[0]!.s.workflows.due).toBe(0)

    await db.exec(`update crm_leads set is_hot = true where id = '${hot}';`)
    await db.exec(`update crm_workflow_enrollments set next_at = now() - interval '1 minute' where workflow_id = '${wf}';`)
    const run = await db.query<{ s: { workflows: { due: number; ran: number; completed: number } } }>(`select run_crm_followup_cron(false) as s;`)
    expect(run.rows[0]!.s.workflows).toMatchObject({ due: 2, ran: 2, completed: 2 })
    e = await enrollment(wf, cold)
    expect(e.status).toBe('completed')
    e = await enrollment(wf, hot)
    expect(e.status).toBe('completed')
    const adj = await db.query<{ id: string; score_adjust: number }>(
      `select id, score_adjust from crm_leads where id in ('${cold}','${hot}') order by name;`,
    )
    expect(adj.rows.find((r) => r.id === cold)!.score_adjust).toBe(0)
    expect(adj.rows.find((r) => r.id === hot)!.score_adjust).toBe(10)
    await db.exec(`update crm_workflows set is_active = false where id = '${wf}';`)
  })

  it('a reply from the lead exits the enrollment', async () => {
    const wf = await workflow(db, 'Chase', 'lead_created', {}, [
      { kind: 'delay', config: { amount: 2, unit: 'days' } },
      { kind: 'action', config: { action: 'notify_assignee' } },
    ])
    const lead = await add('Chased', '9876960003')
    expect((await enrollment(wf, lead)).status).toBe('active')
    await db.exec(
      `insert into crm_activities (company_id, lead_id, type, direction, subject) values (get_current_company_id(), '${lead}', 'email', 'in', 'Sounds good');`,
    )
    const e = await enrollment(wf, lead)
    expect(e.status).toBe('exited')
    expect(e.exit_reason).toBe('replied')
    await db.exec(`update crm_workflows set is_active = false where id = '${wf}';`)
  })

  it('manual enrollment runs at once and does not double-enroll an active lead', async () => {
    const wf = await workflow(db, 'By hand', 'manual', {}, [
      { kind: 'action', config: { action: 'create_task', subject: 'Send brochure', days: 1 } },
      { kind: 'delay', config: { amount: 1, unit: 'days' } },
    ])
    const lead = await add('Manual', '9876960004')
    expect((await db.query<{ n: number }>(`select crm_enroll_manual('${wf}', array['${lead}']::uuid[]) as n;`)).rows[0]!.n).toBe(1)
    expect((await db.query<{ n: number }>(`select crm_enroll_manual('${wf}', array['${lead}']::uuid[]) as n;`)).rows[0]!.n).toBe(0)
    const task = await db.query<{ subject: string; assigned_to: string | null }>(
      `select subject, assigned_to from crm_activities where lead_id = '${lead}' and type = 'task';`,
    )
    expect(task.rows[0]!.subject).toBe('Send brochure')
    await asUser(db, member)
    await expect(db.query(`select crm_enroll_manual('${wf}', array['${lead}']::uuid[]);`)).resolves.toBeDefined()
    await asUser(db, owner)
  })

  it('an overdue follow-up enrolls once a day', async () => {
    const wf = await workflow(db, 'Overdue nudge', 'follow_up_overdue', {}, [{ kind: 'action', config: { action: 'notify_assignee' } }], { allow_reenroll: true })
    const lead = await add('Overdue', '9876960005')
    await db.exec(`update crm_leads set assigned_to = '${member}', follow_up_at = now() - interval '1 day' where id = '${lead}';`)
    await db.query(`select run_crm_followup_cron(false);`)
    await db.query(`select run_crm_followup_cron(false);`)
    const n = await db.query<{ n: number }>(`select count(*)::int as n from crm_workflow_enrollments where workflow_id = '${wf}' and lead_id = '${lead}';`)
    expect(n.rows[0]!.n).toBe(1)
    await db.exec(`update crm_workflows set is_active = false where id = '${wf}';`)
  })

  it('scoring follows the studio rules and a score change can start a workflow', async () => {
    const rules = await db.query<{ n: number }>(`select count(*)::int as n from crm_scoring_rules;`)
    expect(rules.rows[0]!.n).toBe(7)
    const wf = await workflow(db, 'Hot score', 'score_changed', { conditions: [{ field: 'score', op: 'gte', value: 40 }] }, [
      { kind: 'action', config: { action: 'mark_hot' } },
    ])
    const lead = await add('Scored', '9876960006', 'scored@x.in', 'referral')
    // email +10, referral +15
    let l = await db.query<{ score: number; is_hot: boolean }>(`select score, is_hot from crm_leads where id = '${lead}';`)
    expect(l.rows[0]!.score).toBe(25)
    expect(l.rows[0]!.is_hot).toBe(false)
    await db.exec(`update crm_leads set deal_value = 60000 where id = '${lead}';`)
    l = await db.query<{ score: number; is_hot: boolean }>(`select score, is_hot from crm_leads where id = '${lead}';`)
    // +20 for the value, then the workflow marks it hot (+20 more on the next recompute)
    expect(l.rows[0]!.score).toBeGreaterThanOrEqual(45)
    expect(l.rows[0]!.is_hot).toBe(true)
    await db.exec(`update crm_workflows set is_active = false where id = '${wf}';`)
    const hot = await db.query<{ h: number }>(`select coalesce((select hot_score from crm_settings where company_id = get_current_company_id()), 60) as h;`)
    expect(hot.rows[0]!.h).toBe(60)
  })

  it('a send_template step queues the outbox for the API to drain', async () => {
    const tpl = (
      await db.query<{ id: string }>(
        `insert into crm_templates (company_id, name, body, kind) values (get_current_company_id(), 'Welcome', 'Hi {{name}}', 'whatsapp') returning id;`,
      )
    ).rows[0]!.id
    const wf = await workflow(db, 'Welcome message', 'lead_created', {}, [
      { kind: 'action', config: { action: 'send_template', template_id: tpl, channel: 'whatsapp' } },
    ])
    const lead = await add('Welcomed', '9876960007')
    const box = await db.query<{ status: string; channel: string }>(`select status, channel from crm_outbox where lead_id = '${lead}';`)
    expect(box.rows[0]).toEqual({ status: 'pending', channel: 'whatsapp' })
    const claimed = await db.query<{ lead_id: string }>(`select lead_id from crm_outbox_claim(10);`)
    expect(claimed.rows.map((r) => r.lead_id)).toContain(lead)
    await db.exec(`update crm_workflows set is_active = false where id = '${wf}';`)
  })
})

describe('CRM quotes, preferences, lost analysis (0041)', () => {
  let db: PGlite
  const owner = '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e'

  const add = async (name: string, phone: string) =>
    (
      await db.query<{ id: string }>(
        `select add_lead('${name}', '${phone}', null, 'enquiry', null, null) as id;`,
      )
    ).rows[0]!.id
  const items = JSON.stringify([
    { description: 'Wedding coverage', quantity: 1, rate: 100000, amount: 100000, gst_rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 },
    { description: 'Album', quantity: 2, rate: 10000, amount: 20000, gst_rate: 18, taxable: 20000, cgst: 1800, sgst: 1800, igst: 0 },
  ])
  const quote = async (lead: string) =>
    (
      await db.query<{ id: string; quote_number: string }>(
        `select * from create_quote('${lead}', 'Wedding package', current_date + 14, 'MH', true, 120000, 0, 120000, 21600, 141600, '${items}'::jsonb, 'Thanks!', 'Half in advance.');`,
      )
    ).rows[0]!

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}','owner@crm8.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM8 Studio','Owner');`)
  })

  it('quotes are numbered per studio and set the deal value', async () => {
    const lead = await add('Quoted', '9876970001')
    const q1 = await quote(lead)
    const q2 = await quote(lead)
    expect(q1.quote_number).toBe('Q-0001')
    expect(q2.quote_number).toBe('Q-0002')
    const l = await db.query<{ deal_value: string }>(`select deal_value from crm_leads where id = '${lead}';`)
    expect(Number(l.rows[0]!.deal_value)).toBe(141600)
    const n = await db.query<{ n: number }>(`select count(*)::int as n from crm_quote_items where quote_id = '${q1.id}';`)
    expect(n.rows[0]!.n).toBe(2)
    await expect(
      db.query(`select * from create_quote('${lead}', null, null, 'MH', true, 0, 0, 0, 0, 0, '[]'::jsonb);`),
    ).rejects.toThrow(/at least one line/)
  })

  it('a sent quote is accepted once through its public link, then read-only', async () => {
    const lead = await add('Accepts', '9876970002')
    const q = await quote(lead)
    const token = (await db.query<{ t: string }>(`select issue_quote_link('${q.id}', 48) as t;`)).rows[0]!.t
    expect((await db.query<{ status: string }>(`select status from crm_quotes where id = '${q.id}';`)).rows[0]!.status).toBe('sent')
    const shown = await db.query<{ q: { quote_number: string; items: unknown[]; studio: string; total: number } }>(
      `select get_quote_for_token('${token}') as q;`,
    )
    expect(shown.rows[0]!.q.quote_number).toBe(q.quote_number)
    expect(shown.rows[0]!.q.items).toHaveLength(2)
    expect(shown.rows[0]!.q.studio).toBe('CRM8 Studio')
    expect((await db.query<{ ok: boolean }>(`select accept_quote('${token}', 'Priya', 'p@x.in', '1.2.3.4', 'ua') as ok;`)).rows[0]!.ok).toBe(true)
    expect((await db.query<{ ok: boolean }>(`select accept_quote('${token}', 'Priya') as ok;`)).rows[0]!.ok).toBe(false)
    const after = await db.query<{ status: string; accepted_by_name: string }>(`select status, accepted_by_name from crm_quotes where id = '${q.id}';`)
    expect(after.rows[0]).toEqual({ status: 'accepted', accepted_by_name: 'Priya' })
    // Still viewable after acceptance.
    const again = await db.query<{ q: { status: string } }>(`select get_quote_for_token('${token}') as q;`)
    expect(again.rows[0]!.q.status).toBe('accepted')
    const ev = await db.query<{ n: number }>(`select count(*)::int as n from crm_lead_events where lead_id = '${lead}' and note like 'quote % accepted%';`)
    expect(ev.rows[0]!.n).toBe(1)
    await expect(db.query(`select issue_quote_link('${q.id}');`)).rejects.toThrow(/already closed/)
  })

  it('a quote can be declined with a reason, and an old quote expires', async () => {
    const lead = await add('Declines', '9876970003')
    const q = await quote(lead)
    const token = (await db.query<{ t: string }>(`select issue_quote_link('${q.id}') as t;`)).rows[0]!.t
    expect((await db.query<{ ok: boolean }>(`select decline_quote('${token}', 'Too pricey') as ok;`)).rows[0]!.ok).toBe(true)
    const d = await db.query<{ status: string; decline_reason: string }>(`select status, decline_reason from crm_quotes where id = '${q.id}';`)
    expect(d.rows[0]).toEqual({ status: 'declined', decline_reason: 'Too pricey' })

    const q2 = await quote(lead)
    await db.query(`select issue_quote_link('${q2.id}');`)
    await db.exec(`update crm_quotes set valid_until = current_date - 1 where id = '${q2.id}';`)
    // 0150 moved the sweep into the CRM cron and widened its return from an
    // int to the {due, expired, dry_run} summary its sibling sweeps report.
    expect(
      (await db.query<{ n: { expired: number } }>(`select crm_expire_quotes() as n;`)).rows[0]!.n.expired,
    ).toBe(1)
    expect((await db.query<{ status: string }>(`select status from crm_quotes where id = '${q2.id}';`)).rows[0]!.status).toBe('expired')
  })

  it('converting with a quote carries its lines into the project', async () => {
    const lead = await add('Converts', '9876970004')
    const q = await quote(lead)
    const r = await db.query<{ client_id: string; project_id: string }>(
      `select * from convert_lead_to_project('${lead}', null, '{}'::jsonb, '{}'::jsonb, '${q.id}');`,
    )
    const { project_id } = r.rows[0]!
    const p = await db.query<{ name: string; package_cost: string; show_quotation: boolean }>(
      `select name, package_cost, show_quotation from projects where id = '${project_id}';`,
    )
    expect(p.rows[0]!.name).toBe('Wedding package')
    expect(Number(p.rows[0]!.package_cost)).toBe(141600)
    expect(p.rows[0]!.show_quotation).toBe(true)
    const d = await db.query<{ title: string; description: string | null }>(
      `select title, description from deliverables where project_id = '${project_id}' order by title;`,
    )
    expect(d.rows.map((x) => x.title)).toEqual(['Album', 'Wedding coverage'])
    expect(d.rows[0]!.description).toBe('2.00 × 10000.00')
  })

  it('lost analysis groups by reason and competitor; the forecast reports win rate', async () => {
    const a = await add('Lost A', '9876970010')
    const b = await add('Lost B', '9876970011')
    await db.exec(`update crm_leads set status = 'lost', lost_reason = 'Budget', lost_competitor = 'Studio X' where id = '${a}';`)
    await db.exec(`update crm_leads set status = 'lost', lost_reason = 'Budget' where id = '${b}';`)
    const s = await db.query<{ s: { byLostReason: Record<string, number>; byCompetitor: Record<string, number>; lost: number } }>(
      `select crm_stats(current_date - 1, current_date) as s;`,
    )
    expect(s.rows[0]!.s.byLostReason.Budget).toBe(2)
    expect(s.rows[0]!.s.byCompetitor['Studio X']).toBe(1)
    const f = await db.query<{ f: { won_count: number; lost_count: number; win_rate: number | null; avg_cycle_days: number | null } }>(
      `select crm_forecast(current_date - 1, current_date) as f;`,
    )
    expect(f.rows[0]!.f.lost_count).toBe(2)
    expect(f.rows[0]!.f.won_count).toBeGreaterThanOrEqual(1)
    expect(f.rows[0]!.f.win_rate).not.toBeNull()
  })

  it('preferences are one row per person', async () => {
    await db.exec(`insert into crm_user_prefs (company_id, user_id, prefs) values (get_current_company_id(), '${owner}', '{"columns":["name","stage"]}');`)
    await db.exec(`insert into crm_user_prefs (company_id, user_id, prefs) values (get_current_company_id(), '${owner}', '{"columns":["name"]}') on conflict (company_id, user_id) do update set prefs = excluded.prefs;`)
    const p = await db.query<{ prefs: { columns: string[] } }>(`select prefs from crm_user_prefs where user_id = '${owner}';`)
    expect(p.rows[0]!.prefs.columns).toEqual(['name'])
  })

  it('a draft quote can be corrected in full -- title, lines, and notes together', async () => {
    const lead = await add('Draft edit', '9876970020')
    const q = await quote(lead)
    const newItems = JSON.stringify([
      { description: 'Photo + Video', quantity: 1, rate: 150000, amount: 150000, gst_rate: 18, taxable: 150000, cgst: 13500, sgst: 13500, igst: 0 },
    ])
    await db.query(`
      select update_quote('${q.id}', 'Wedding package v2', current_date + 21, 'MH', true,
        150000, 0, 150000, 27000, 177000, '${newItems}'::jsonb, 'Revised', 'Full in advance.');
    `)
    const row = await db.query<{ title: string; total: string; notes: string }>(
      `select title, total, notes from crm_quotes where id = '${q.id}';`,
    )
    expect(row.rows[0]).toEqual({ title: 'Wedding package v2', total: '177000.00', notes: 'Revised' })
    const items = await db.query<{ description: string }>(`select description from crm_quote_items where quote_id = '${q.id}';`)
    expect(items.rows.map((r) => r.description)).toEqual(['Photo + Video'])
  })

  it('a quote that has been sent can no longer be edited', async () => {
    const lead = await add('Sent edit refused', '9876970021')
    const q = await quote(lead)
    await db.query(`select issue_quote_link('${q.id}', 48);`)
    await expect(
      db.query(`
        select update_quote('${q.id}', 'x', null, 'MH', true, 0, 0, 0, 0, 0,
          '[{"description":"x","quantity":1,"rate":1,"amount":1,"gst_rate":0,"taxable":1,"cgst":0,"sgst":0,"igst":0}]'::jsonb, null, null);
      `),
    ).rejects.toThrow(/cannot be edited/)
  })
})

describe('CRM guards — execute privileges and cross-studio calls', () => {
  let db: PGlite
  const ownerA = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a'
  const ownerB = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b'
  let leadB = ''
  let stageA = ''
  let otherPipelineStageA = ''

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(
      `insert into auth.users (id, email) values ('${ownerA}','a@guards.test'),('${ownerB}','b@guards.test');`,
    )
    await asUser(db, ownerA)
    await db.query(`select register_company_and_admin('Studio A','Owner A');`)
    stageA = (
      await db.query<{ id: string }>(
        `select id from crm_pipeline_stages where company_id = get_current_company_id() and key = 'qualified';`,
      )
    ).rows[0]!.id
    const other = (
      await db.query<{ id: string }>(
        `insert into crm_pipelines (company_id, name) values (get_current_company_id(), 'Corporate') returning id;`,
      )
    ).rows[0]!.id
    otherPipelineStageA = (
      await db.query<{ id: string }>(
        `insert into crm_pipeline_stages (pipeline_id, company_id, name, key, position)
         values ('${other}', get_current_company_id(), 'Brief', 'brief', 0) returning id;`,
      )
    ).rows[0]!.id

    await asUser(db, ownerB)
    await db.query(`select register_company_and_admin('Studio B','Owner B');`)
    leadB = (await db.query<{ id: string }>(`select add_lead('B lead', '9876990001', null, 'enquiry', null, null) as id;`)).rows[0]!.id
  })

  // The helpers that take a company id or a whole row and write with it must
  // not be reachable from a session at all — the trigger is their only caller.
  it('the internal definer helpers are not executable by anon or authenticated', async () => {
    const internal = [
      'crm_link_contact(uuid, uuid, text, text, text, text, uuid, text)',
      'crm_workflow_do_action(crm_leads, jsonb, crm_workflows)',
      'crm_lead_facts(crm_leads)',
      'crm_cond_matches(jsonb, crm_leads, text)',
      'crm_ensure_default_pipeline(uuid)',
      'crm_ensure_scoring_defaults(uuid)',
    ]
    for (const sig of internal) {
      const r = await db.query<{ a: boolean; n: boolean }>(
        `select has_function_privilege('authenticated', '${sig}', 'execute') as a,
                has_function_privilege('anon', '${sig}', 'execute') as n;`,
      )
      expect(r.rows[0], sig).toEqual({ a: false, n: false })
    }
  })

  it('no CRM definer function is executable by anon except the tokened quote pages', async () => {
    const rows = await db.query<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
         and p.proname like 'crm%'
         and has_function_privilege('anon', p.oid, 'execute');`,
    )
    expect(rows.rows.map((r) => r.name)).toEqual([])
  })

  it('a studio cannot score, enroll or run a workflow on another studio’s lead', async () => {
    await asUser(db, ownerA)
    await expect(db.query(`select crm_score_lead('${leadB}');`)).rejects.toThrow(/not allowed/)
    await expect(db.query(`select crm_enroll_workflows('${leadB}', 'manual', null);`)).rejects.toThrow(/not allowed/)
    // Its own lead is fine.
    const mine = (await db.query<{ id: string }>(`select add_lead('A lead', '9876990002', null, 'enquiry', null, null) as id;`)).rows[0]!.id
    await expect(db.query(`select crm_score_lead('${mine}');`)).resolves.toBeDefined()
  })

  it('a bulk move refuses a stage from another pipeline', async () => {
    await asUser(db, ownerA)
    const lead = (await db.query<{ id: string }>(`select add_lead('Bulk pipe', '9876990003', null, 'enquiry', null, null) as id;`)).rows[0]!.id
    await expect(
      db.query(`select * from crm_bulk_patch(array['${lead}']::uuid[], '{"stage_id":"${otherPipelineStageA}"}'::jsonb);`),
    ).rejects.toThrow(/another pipeline/)
    // The same move inside the deal's own pipeline is allowed.
    const ok = await db.query(`select * from crm_bulk_patch(array['${lead}']::uuid[], '{"stage_id":"${stageA}"}'::jsonb);`)
    expect(ok.rows).toHaveLength(1)
    const after = await db.query<{ status: string }>(`select status from crm_leads where id = '${lead}';`)
    expect(after.rows[0]!.status).toBe('qualified')
  })

  it('a branch that names a step which no longer exists errors the enrollment instead of completing it', async () => {
    await asUser(db, ownerA)
    const wf = await workflow(db, 'Broken branch', 'manual', {}, [
      { kind: 'branch', config: { conditions: [{ field: 'is_hot', op: 'eq', value: false }], yes_step: 9, no_step: 9 } },
    ])
    const lead = (await db.query<{ id: string }>(`select add_lead('Broken', '9876990004', null, 'enquiry', null, null) as id;`)).rows[0]!.id
    await db.query(`select crm_enroll_manual('${wf}', array['${lead}']::uuid[]);`)
    const e = await db.query<{ status: string; exit_reason: string }>(
      `select status, exit_reason from crm_workflow_enrollments where workflow_id = '${wf}' and lead_id = '${lead}';`,
    )
    expect(e.rows[0]!.status).toBe('errored')
    expect(e.rows[0]!.exit_reason).toContain('does not exist')
  })

  it('a branch that simply runs off the end still completes normally', async () => {
    await asUser(db, ownerA)
    const wf = await workflow(db, 'Open branch', 'manual', {}, [
      { kind: 'branch', config: { conditions: [{ field: 'is_hot', op: 'eq', value: false }], yes_step: null, no_step: null } },
    ])
    const lead = (await db.query<{ id: string }>(`select add_lead('Runs off', '9876990005', null, 'enquiry', null, null) as id;`)).rows[0]!.id
    await db.query(`select crm_enroll_manual('${wf}', array['${lead}']::uuid[]);`)
    const e = await db.query<{ status: string }>(
      `select status from crm_workflow_enrollments where workflow_id = '${wf}' and lead_id = '${lead}';`,
    )
    expect(e.rows[0]!.status).toBe('completed')
  })
})

describe('role library (0040)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('ships a catalogue covering every stage of the job', async () => {
    const rows = await db.query<{ stage: string; n: number }>(
      `select stage, count(*)::int as n from role_library group by stage order by stage;`,
    )
    expect(rows.rows.map((r) => r.stage).sort()).toEqual(['other', 'post', 'pre', 'production'])
    expect(rows.rows.every((r) => r.n > 0)).toBe(true)
  })

  // Re-running a migration must not double the catalogue.
  it('seeds the same rows twice without duplicating them', async () => {
    const before = await db.query<{ n: number }>(`select count(*)::int as n from role_library;`)
    await db.exec(readMig('0040_role_library.sql'))
    const after = await db.query<{ n: number }>(`select count(*)::int as n from role_library;`)
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n)
  })

  it('is readable by members and writable by none of them', async () => {
    const policies = await db.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies where tablename = 'role_library';`,
    )
    expect(policies.rows).toEqual([{ policyname: 'role_library_select', cmd: 'SELECT' }])
  })

  it('lets a studio stage its own roles, and lets the stage stay unsaid', async () => {
    const company = await db.query<{ id: string }>(`select id from companies limit 1;`)
    const id = company.rows[0]!.id
    await db.query(
      `insert into employee_roles (company_id, type_name, role_code, stage)
       values ('${id}', 'Candid Photographer', 'candid_photographer', 'production');`,
    )
    await db.query(
      `insert into employee_roles (company_id, type_name, role_code)
       values ('${id}', 'Odd Job', 'odd_job');`,
    )
    const rows = await db.query<{ type_name: string; stage: string | null }>(
      `select type_name, stage from employee_roles order by type_name;`,
    )
    expect(rows.rows).toEqual([
      { type_name: 'Candid Photographer', stage: 'production' },
      { type_name: 'Odd Job', stage: null },
    ])
  })

  it('refuses a stage nobody renders', async () => {
    const company = await db.query<{ id: string }>(`select id from companies limit 1;`)
    await expect(
      db.query(
        `insert into employee_roles (company_id, type_name, role_code, stage)
         values ('${company.rows[0]!.id}', 'Bad', 'bad', 'during');`,
      ),
    ).rejects.toThrow()
  })
})

describe('team terms (0041)', () => {
  let db: PGlite
  let company: string
  let shoot: string
  let template: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    company = (await db.query<{ id: string }>(`select id from companies limit 1;`)).rows[0]!.id
    const client = (
      await db.query<{ id: string }>(
        `insert into clients (company_id, name) values ('${company}', 'Sharma') returning id;`,
      )
    ).rows[0]!.id
    const project = (
      await db.query<{ id: string }>(
        `insert into projects (company_id, client_id, name) values ('${company}', '${client}', 'Sharma Wedding') returning id;`,
      )
    ).rows[0]!.id
    shoot = (
      await db.query<{ id: string }>(
        `insert into shoots (company_id, project_id, name, shoot_date)
         values ('${company}', '${project}', 'Wedding Day', '2026-11-22') returning id;`,
      )
    ).rows[0]!.id
    template = (
      await db.query<{ id: string }>(
        `insert into team_terms_templates (company_id, title, body, category)
         values ('${company}', 'Photographer terms', 'You agree to {{shoot_name}}.', 'production')
         returning id;`,
      )
    ).rows[0]!.id
  })

  const issue = async (ttl = 336) =>
    (
      await db.query<{ send_id: string; token: string }>(
        `select send_id, token from issue_team_terms(
           '${shoot}'::uuid, '${template}'::uuid, 'You agree to Wedding Day.', 'Rahul',
           'rahul@studio.test', null, null, null, 'Photographer', ${ttl});`,
      )
    ).rows[0]!

  it('issues a send and a link together, stamped with the template version', async () => {
    const { send_id, token } = await issue()
    expect(token.length).toBeGreaterThan(20)
    const row = await db.query<{ status: string; template_version: number; project_id: string }>(
      `select status, template_version, project_id from team_terms_sends where id = '${send_id}';`,
    )
    expect(row.rows[0]).toMatchObject({ status: 'draft', template_version: 1 })
    // The project is taken from the shoot rather than trusted from the caller.
    expect(row.rows[0]!.project_id).not.toBeNull()
  })

  it('refuses a template from another studio', async () => {
    const other = (
      await db.query<{ id: string }>(
        `insert into companies (name, owner_user_id)
         values ('Other Studio', (select user_id from users limit 1)) returning id;`,
      )
    ).rows[0]!.id
    const stray = (
      await db.query<{ id: string }>(
        `insert into team_terms_templates (company_id, title, body)
         values ('${other}', 'Theirs', 'body') returning id;`,
      )
    ).rows[0]!.id
    await expect(
      db.query(
        `select * from issue_team_terms('${shoot}'::uuid, '${stray}'::uuid, 'x', 'Rahul');`,
      ),
    ).rejects.toThrow()
  })

  it('marks a send viewed the first time the link is opened', async () => {
    const { send_id, token } = await issue()
    const read = await db.query<{ status: string; rendered_body: string }>(
      `select status, rendered_body from get_team_terms_for_token('${token}');`,
    )
    expect(read.rows[0]!.rendered_body).toContain('Wedding Day')
    const after = await db.query<{ status: string; viewed_at: string | null }>(
      `select status, viewed_at from team_terms_sends where id = '${send_id}';`,
    )
    expect(after.rows[0]!.status).toBe('viewed')
    expect(after.rows[0]!.viewed_at).not.toBeNull()
  })

  it('records an acknowledgement once, with evidence', async () => {
    const { send_id, token } = await issue()
    const first = await db.query<{ acknowledge_team_terms: boolean }>(
      `select acknowledge_team_terms('${token}', 'Rahul Sharma', '1.2.3.4', 'test-agent');`,
    )
    expect(first.rows[0]!.acknowledge_team_terms).toBe(true)
    const row = await db.query<{ status: string; acknowledged_by_name: string; acknowledged_ip: string }>(
      `select status, acknowledged_by_name, acknowledged_ip from team_terms_sends where id = '${send_id}';`,
    )
    expect(row.rows[0]).toMatchObject({
      status: 'acknowledged',
      acknowledged_by_name: 'Rahul Sharma',
      acknowledged_ip: '1.2.3.4',
    })
    // The token is spent: a second press cannot re-sign it.
    const second = await db.query<{ acknowledge_team_terms: boolean }>(
      `select acknowledge_team_terms('${token}', 'Someone Else');`,
    )
    expect(second.rows[0]!.acknowledge_team_terms).toBe(false)
  })

  it('gives nothing to a junk or expired token', async () => {
    const junk = await db.query(`select * from get_team_terms_for_token('not-a-token');`)
    expect(junk.rows).toHaveLength(0)
    const { token } = await issue(0)
    await db.exec(`update access_tokens set expires_at = now() - interval '1 hour';`)
    const expired = await db.query(`select * from get_team_terms_for_token('${token}');`)
    expect(expired.rows).toHaveLength(0)
  })

  it('hides a revoked send from the link', async () => {
    const { send_id, token } = await issue()
    await db.exec(
      `update team_terms_sends set revoked_at = now(), status = 'revoked' where id = '${send_id}';`,
    )
    const read = await db.query(`select * from get_team_terms_for_token('${token}');`)
    expect(read.rows).toHaveLength(0)
  })

  // A briefing has no button, so pressing one must not forge a signature.
  it('will not acknowledge a send-only template', async () => {
    const briefing = (
      await db.query<{ id: string }>(
        `insert into team_terms_templates (company_id, title, body, mode)
         values ('${company}', 'Call sheet', 'Be there at 6.', 'send_only') returning id;`,
      )
    ).rows[0]!.id
    const { send_id, token } = (
      await db.query<{ send_id: string; token: string }>(
        `select send_id, token from issue_team_terms('${shoot}'::uuid, '${briefing}'::uuid, 'Be there at 6.', 'Rahul');`,
      )
    ).rows[0]!
    const done = await db.query<{ acknowledge_team_terms: boolean }>(
      `select acknowledge_team_terms('${token}', 'Rahul');`,
    )
    expect(done.rows[0]!.acknowledge_team_terms).toBe(false)
    const row = await db.query<{ status: string }>(
      `select status from team_terms_sends where id = '${send_id}';`,
    )
    expect(row.rows[0]!.status).not.toBe('acknowledged')
  })

  it('drops the preset table nothing ever used', async () => {
    const left = await db.query(
      `select 1 from information_schema.tables where table_name = 'deliverable_presets';`,
    )
    expect(left.rows).toHaveLength(0)
  })
})

describe('client documents (0042)', () => {
  let db: PGlite
  let company: string
  let project: string
  let payment: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    company = (await db.query<{ id: string }>(`select id from companies limit 1;`)).rows[0]!.id
    const client = (
      await db.query<{ id: string }>(
        `insert into clients (company_id, name) values ('${company}', 'Sharma Family') returning id;`,
      )
    ).rows[0]!.id
    project = (
      await db.query<{ id: string }>(
        // Shown to the client: a hidden project's quotation link reads as hidden (0190).
        `insert into projects (company_id, client_id, name, package_cost, show_quotation)
         values ('${company}', '${client}', 'Sharma Wedding', 150000, true) returning id;`,
      )
    ).rows[0]!.id
    await db.query(
      `insert into deliverables (company_id, project_id, title, visibility_scope, show_on_quotation)
       values ('${company}', '${project}', 'Wedding Album', 'client', true);`,
    )
    await db.query(
      `insert into deliverables (company_id, project_id, title, visibility_scope, show_on_quotation,
                                 is_additional_charge, additional_charge_amount)
       values ('${company}', '${project}', 'Drone Shots', 'client', true, true, 15000);`,
    )
    // Neither of these belongs on a quotation.
    await db.query(
      `insert into deliverables (company_id, project_id, title, visibility_scope)
       values ('${company}', '${project}', 'Data Sorting', 'internal');`,
    )
    await db.query(
      `insert into deliverables (company_id, project_id, title, visibility_scope, show_on_quotation)
       values ('${company}', '${project}', 'Hidden Extra', 'client', false);`,
    )
    payment = (
      await db.query<{ id: string }>(
        `insert into received_payments (company_id, project_id, amount, mode)
         values ('${company}', '${project}', 50000, 'upi') returning id;`,
      )
    ).rows[0]!.id
  })

  const issueQuote = async () =>
    (
      await db.query<{ quotation_id: string; token: string }>(
        `select quotation_id, token from issue_project_quotation('${project}'::uuid, 'Valid 30 days');`,
      )
    ).rows[0]!

  it('quotes only what the client is meant to see', async () => {
    const { token } = await issueQuote()
    const read = await db.query<{ snapshot: { items: { title: string }[] } }>(
      `select snapshot from get_quotation_for_token('${token}');`,
    )
    const titles = read.rows[0]!.snapshot.items.map((i) => i.title)
    expect(titles).toEqual(['Wedding Album', 'Drone Shots'])
    expect(titles).not.toContain('Data Sorting')
    expect(titles).not.toContain('Hidden Extra')
  })

  // The snapshot is the point: what they accepted cannot move afterwards.
  it('freezes the prices as they were when it went out', async () => {
    const { token } = await issueQuote()
    await db.query(`update projects set package_cost = 999999 where id = '${project}';`)
    const read = await db.query<{ snapshot: { package_cost: number } }>(
      `select snapshot from get_quotation_for_token('${token}');`,
    )
    expect(Number(read.rows[0]!.snapshot.package_cost)).toBe(150000)
    await db.query(`update projects set package_cost = 150000 where id = '${project}';`)
  })

  it('records an acceptance with evidence', async () => {
    const { quotation_id, token } = await issueQuote()
    const ok = await db.query<{ respond_to_quotation: boolean }>(
      `select respond_to_quotation('${token}', true, 'Rahul Sharma', '1.2.3.4', 'agent');`,
    )
    expect(ok.rows[0]!.respond_to_quotation).toBe(true)
    const row = await db.query<{ accepted_by_name: string; accepted_ip: string }>(
      `select accepted_by_name, accepted_ip from project_quotations where id = '${quotation_id}';`,
    )
    expect(row.rows[0]).toMatchObject({ accepted_by_name: 'Rahul Sharma', accepted_ip: '1.2.3.4' })
  })

  // Saying no on Monday must not burn the link before a yes on Tuesday.
  it('lets a decline be changed to an acceptance', async () => {
    const { quotation_id, token } = await issueQuote()
    await db.query(`select respond_to_quotation('${token}', false);`)
    expect(
      (
        await db.query<{ declined_at: string | null }>(
          `select declined_at from project_quotations where id = '${quotation_id}';`,
        )
      ).rows[0]!.declined_at,
    ).not.toBeNull()
    await db.query(`select respond_to_quotation('${token}', true, 'Rahul');`)
    const row = await db.query<{ accepted_at: string | null; declined_at: string | null }>(
      `select accepted_at, declined_at from project_quotations where id = '${quotation_id}';`,
    )
    expect(row.rows[0]!.accepted_at).not.toBeNull()
    expect(row.rows[0]!.declined_at).toBeNull()
  })

  it('will not re-accept what is already accepted', async () => {
    const { token } = await issueQuote()
    await db.query(`select respond_to_quotation('${token}', true, 'First');`)
    const again = await db.query<{ respond_to_quotation: boolean }>(
      `select respond_to_quotation('${token}', true, 'Second');`,
    )
    expect(again.rows[0]!.respond_to_quotation).toBe(false)
  })

  it('shows a receipt with what has been paid so far', async () => {
    const token = (
      await db.query<{ issue_payment_receipt: string }>(
        `select issue_payment_receipt('${payment}'::uuid);`,
      )
    ).rows[0]!.issue_payment_receipt
    const read = await db.query<{
      amount: string
      project_name: string
      received_total: string
      company_name: string
    }>(
      `select amount, project_name, received_total, company_name from get_receipt_for_token('${token}');`,
    )
    expect(read.rows[0]).toMatchObject({ project_name: 'Sharma Wedding', company_name: 'Studio' })
    expect(Number(read.rows[0]!.amount)).toBe(50000)
    expect(Number(read.rows[0]!.received_total)).toBe(50000)
  })

  it('gives nothing for a junk token, on any of the three', async () => {
    expect((await db.query(`select * from get_quotation_for_token('nope');`)).rows).toHaveLength(0)
    expect((await db.query(`select * from get_receipt_for_token('nope');`)).rows).toHaveLength(0)
    expect((await db.query(`select * from get_delivery_for_token('nope');`)).rows).toHaveLength(0)
  })

  /**
   * 0115 widened this on purpose.
   *
   * 0042 opened a delivery link only for APPROVED work. 0115 ("delivery
   * visibility") changed the rule to submitted / approved / sent, so a studio
   * can send the client a link while the work is still in review. What stays
   * shut is a REJECTED submission — the one case where the client must not see
   * the file.
   */
  it('opens a delivery link for work in flight, but never for rejected work', async () => {
    const submission = (
      await db.query<{ id: string }>(
        `insert into team_work_submissions (company_id, project_id, submission_link, status)
         values ('${company}', '${project}', 'https://drive.example/album', 'submitted')
         returning id;`,
      )
    ).rows[0]!.id
    const token = (
      await db.query<{ issue_access_token: string }>(
        `select issue_access_token('work_delivery', '${submission}'::uuid, 168);`,
      )
    ).rows[0]!.issue_access_token
    // Still 'submitted': the link opens, because that is what 0115 enabled.
    expect((await db.query(`select * from get_delivery_for_token('${token}');`)).rows).toHaveLength(1)

    await db.query(`update team_work_submissions set status = 'approved' where id = '${submission}';`)
    const open = await db.query<{ submission_link: string; project_name: string }>(
      `select submission_link, project_name from get_delivery_for_token('${token}');`,
    )
    expect(open.rows[0]).toMatchObject({
      submission_link: 'https://drive.example/album',
      project_name: 'Sharma Wedding',
    })

    // Rejected work is the one state the client must never reach, token or no
    // token — the link they were already sent has to stop working.
    await db.query(`update team_work_submissions set status = 'rejected' where id = '${submission}';`)
    expect((await db.query(`select * from get_delivery_for_token('${token}');`)).rows).toHaveLength(0)
  })
})

describe('enquiries (0043)', () => {
  let db: PGlite
  let company: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@studio.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    company = (await db.query<{ id: string }>(`select id from companies limit 1;`)).rows[0]!.id
  })

  const addEnquiry = async (name: string, phone: string | null, message = 'Need a quote') =>
    (
      await db.query<{ id: string }>(
        `insert into enquiries (company_id, name, phone, message, source)
         values ('${company}', '${name}', ${phone ? `'${phone}'` : 'null'}, '${message}', 'website')
         returning id;`,
      )
    ).rows[0]!.id

  it('starts every enquiry as new', async () => {
    const id = await addEnquiry('Rahul', '9876500001')
    const row = await db.query<{ enquiry_status: string; converted_lead_id: string | null }>(
      `select enquiry_status, converted_lead_id from enquiries where id = '${id}';`,
    )
    expect(row.rows[0]).toMatchObject({ enquiry_status: 'new', converted_lead_id: null })
  })

  it('accepts a studio-added status but refuses a blank one', async () => {
    // enquiry_status is a studio-editable picklist now (0095), same as
    // lead_source/expense_category -- the column itself only refuses empty.
    const id = await addEnquiry('Custom status', '9876500009')
    await db.exec(`update enquiries set enquiry_status = 'maybe' where id = '${id}';`)
    const row = await db.query<{ enquiry_status: string }>(
      `select enquiry_status from enquiries where id = '${id}';`,
    )
    expect(row.rows[0]!.enquiry_status).toBe('maybe')

    await expect(
      db.query(
        `insert into enquiries (company_id, name, enquiry_status)
         values ('${company}', 'Bad', '   ');`,
      ),
    ).rejects.toThrow()
  })

  it('converts to a lead and remembers which one', async () => {
    const id = await addEnquiry('Anita', '9876500002', 'Wedding in December')
    const lead = (
      await db.query<{ convert_enquiry_to_lead: string }>(
        `select convert_enquiry_to_lead('${id}'::uuid);`,
      )
    ).rows[0]!.convert_enquiry_to_lead
    const enq = await db.query<{ enquiry_status: string; converted_lead_id: string }>(
      `select enquiry_status, converted_lead_id from enquiries where id = '${id}';`,
    )
    expect(enq.rows[0]!.enquiry_status).toBe('converted')
    expect(enq.rows[0]!.converted_lead_id).toBe(lead)

    const row = await db.query<{ name: string; source: string; notes: string }>(
      `select name, source, notes from crm_leads where id = '${lead}';`,
    )
    // The CRM's own enum says where a lead came from; 'website' stays on the
    // enquiry, which is the record of that.
    expect(row.rows[0]).toMatchObject({
      name: 'Anita',
      source: 'enquiry',
      // A later migration stamped the provenance onto the note, so the lead
      // says which enquiry it came from and when.
      notes: expect.stringContaining('Wedding in December'),
    })
  })

  it('converts twice to the same lead, not two', async () => {
    const id = await addEnquiry('Sana', '9876500003')
    const first = (
      await db.query<{ convert_enquiry_to_lead: string }>(
        `select convert_enquiry_to_lead('${id}'::uuid);`,
      )
    ).rows[0]!.convert_enquiry_to_lead
    const second = (
      await db.query<{ convert_enquiry_to_lead: string }>(
        `select convert_enquiry_to_lead('${id}'::uuid);`,
      )
    ).rows[0]!.convert_enquiry_to_lead
    expect(second).toBe(first)
  })

  // One number, one lead — the rule the CRM's own intake already follows.
  it('attaches to the lead that already has that number', async () => {
    const existing = (
      await db.query<{ create_lead: string }>(
        `select add_lead('Imran', '9876500004', null, 'manual', 'Called in') as create_lead;`,
      )
    ).rows[0]!.create_lead
    const id = await addEnquiry('Imran Q', '9876500004')
    const lead = (
      await db.query<{ convert_enquiry_to_lead: string }>(
        `select convert_enquiry_to_lead('${id}'::uuid);`,
      )
    ).rows[0]!.convert_enquiry_to_lead
    expect(lead).toBe(existing)
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from crm_leads where phone_norm = crm_normalize_phone('9876500004');`,
    )
    expect(count.rows[0]!.n).toBe(1)
  })

  it('refuses an enquiry from another studio', async () => {
    const other = (
      await db.query<{ id: string }>(
        `insert into companies (name, owner_user_id)
         values ('Other Studio', (select user_id from users limit 1)) returning id;`,
      )
    ).rows[0]!.id
    const stray = (
      await db.query<{ id: string }>(
        `insert into enquiries (company_id, name) values ('${other}', 'Theirs') returning id;`,
      )
    ).rows[0]!.id
    await expect(db.query(`select convert_enquiry_to_lead('${stray}'::uuid);`)).rejects.toThrow()
  })

  it('keeps the enquiry when the lead it made is deleted', async () => {
    const id = await addEnquiry('Priya', '9876500005')
    const lead = (
      await db.query<{ convert_enquiry_to_lead: string }>(
        `select convert_enquiry_to_lead('${id}'::uuid);`,
      )
    ).rows[0]!.convert_enquiry_to_lead
    await db.query(`delete from crm_leads where id = '${lead}';`)
    const row = await db.query<{ converted_lead_id: string | null }>(
      `select converted_lead_id from enquiries where id = '${id}';`,
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0]!.converted_lead_id).toBeNull()
  })
})

describe('migrations re-apply cleanly (idempotency)', () => {
  it('policies and triggers survive a second run of their files', async () => {
    const db = await freshDb()
    // These files used to create policies/triggers unconditionally, so a
    // manual re-run died halfway with "already exists".
    for (const f of [
      '0038_shoot_details.sql',
      '0039_deliverable_sets.sql',
      '0041_team_terms.sql',
      '0043_enquiries.sql',
    ]) {
      await db.exec(mig(f))
    }
    const policies = await db.query<{ tablename: string; n: number }>(
      `select tablename, count(*)::int as n from pg_policies
        where tablename in ('shoot_presets', 'deliverable_sets')
        group by tablename order by tablename;`,
    )
    expect(policies.rows).toEqual([
      { tablename: 'deliverable_sets', n: 2 },
      { tablename: 'shoot_presets', n: 2 },
    ])
  })
})

describe('CRM quote answered off the link (0049)', () => {
  let db: PGlite
  const owner = '3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f'
  let lead = ''

  const items = JSON.stringify([
    { description: 'Coverage', quantity: 1, rate: 100000, amount: 100000, gst_rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 },
  ])
  const newQuote = async () =>
    (
      await db.query<{ id: string; quote_number: string }>(
        `select * from create_quote('${lead}', 'Package', current_date + 14, 'MH', true, 100000, 0, 100000, 18000, 118000, '${items}'::jsonb);`,
      )
    ).rows[0]!
  const statusOf = async (id: string) =>
    (await db.query<{ status: string }>(`select status from crm_quotes where id = '${id}';`)).rows[0]!.status

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}','owner@crm9.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('CRM9 Studio','Owner');`)
    lead = (await db.query<{ id: string }>(`select add_lead('Phone yes', '9876980001', null, 'enquiry', null, null) as id;`)).rows[0]!.id
  })

  it('a draft cannot be answered before it is sent', async () => {
    const q = await newQuote()
    await expect(db.query(`select crm_set_quote_outcome('${q.id}', 'accepted');`)).rejects.toThrow(/before recording an answer/)
  })

  it('the studio records an acceptance given on the phone, and it sets the deal value', async () => {
    const q = await newQuote()
    await db.query(`select issue_quote_link('${q.id}');`)
    expect((await db.query<{ s: string }>(`select crm_set_quote_outcome('${q.id}', 'accepted', 'Priya on the phone') as s;`)).rows[0]!.s).toBe('accepted')
    const row = await db.query<{ status: string; accepted_by_name: string; accepted_at: string | null }>(
      `select status, accepted_by_name, accepted_at from crm_quotes where id = '${q.id}';`,
    )
    expect(row.rows[0]!.status).toBe('accepted')
    expect(row.rows[0]!.accepted_by_name).toBe('Priya on the phone')
    expect(row.rows[0]!.accepted_at).not.toBeNull()
    const l = await db.query<{ deal_value: string }>(`select deal_value from crm_leads where id = '${lead}';`)
    expect(Number(l.rows[0]!.deal_value)).toBe(118000)
    const ev = await db.query<{ n: number }>(
      `select count(*)::int as n from crm_lead_events where lead_id = '${lead}' and note like 'quote % marked accepted%';`,
    )
    expect(ev.rows[0]!.n).toBe(1)
  })

  it('a decline carries its reason, and a mistake can be put back', async () => {
    const q = await newQuote()
    await db.query(`select issue_quote_link('${q.id}');`)
    await db.query(`select crm_set_quote_outcome('${q.id}', 'declined', null, 'Went with a cheaper studio');`)
    const d = await db.query<{ status: string; decline_reason: string }>(
      `select status, decline_reason from crm_quotes where id = '${q.id}';`,
    )
    expect(d.rows[0]).toEqual({ status: 'declined', decline_reason: 'Went with a cheaper studio' })

    expect((await db.query<{ s: string }>(`select crm_set_quote_outcome('${q.id}', 'sent') as s;`)).rows[0]!.s).toBe('sent')
    const back = await db.query<{ status: string; declined_at: string | null; decline_reason: string | null }>(
      `select status, declined_at, decline_reason from crm_quotes where id = '${q.id}';`,
    )
    expect(back.rows[0]).toEqual({ status: 'sent', declined_at: null, decline_reason: null })
  })

  it('an unknown status is refused, and another studio cannot answer this quote', async () => {
    const q = await newQuote()
    await db.query(`select issue_quote_link('${q.id}');`)
    await expect(db.query(`select crm_set_quote_outcome('${q.id}', 'expired');`)).rejects.toThrow(/unknown quote status/)
    const stranger = '4e4e4e4e-4e4e-4e4e-8e4e-4e4e4e4e4e4e'
    await db.exec(`insert into auth.users (id, email) values ('${stranger}','stranger@crm9.test');`)
    await asUser(db, stranger)
    await db.query(`select register_company_and_admin('Other Studio','Stranger');`)
    await expect(db.query(`select crm_set_quote_outcome('${q.id}', 'accepted');`)).rejects.toThrow(/unknown quote/)
    await asUser(db, owner)
    expect(await statusOf(q.id)).toBe('sent')
  })

  it('the public page states which state the tax was worked out for', async () => {
    const q = await newQuote()
    const token = (await db.query<{ t: string }>(`select issue_quote_link('${q.id}') as t;`)).rows[0]!.t
    const shown = await db.query<{ q: { place_of_supply: string; intra_state: boolean } }>(
      `select get_quote_for_token('${token}') as q;`,
    )
    expect(shown.rows[0]!.q.place_of_supply).toBe('MH')
    expect(shown.rows[0]!.q.intra_state).toBe(true)
  })
})

/**
 * The dashboard RPCs, actually CALLED. A plpgsql body is not checked until it
 * runs, so gst_analysis created cleanly in 0058 and then raised on every
 * invocation, which is why that page rendered blank in production. Creating a
 * function is not evidence it works; only calling it is.
 *
 * gopo_summary was the other half of this and is gone -- 0158 dropped it with
 * the page that was its only caller.
 *
 * The fixture is deliberately a LOSS-MAKING, OVER-COLLECTED project: costs
 * above revenue and a client who paid more than was invoiced. That shape used
 * to be rejected outright by the contracts.
 */
describe('dashboard RPCs run and return contract-shaped data (0064)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(
      `update companies set plan_expiry = now() + interval '30 days' where id = get_current_company_id();`,
    )
    await db.exec(`
      insert into clients (company_id, name) values (get_current_company_id(), 'Acme');
      insert into projects (company_id, client_id, name, package_cost, status)
        values (get_current_company_id(), (select id from clients limit 1), 'Loss Job', 1000, 'active');
      insert into received_payments (company_id, project_id, amount, paid_on)
        values (get_current_company_id(), (select id from projects limit 1), 1500, current_date);
      insert into expenses (company_id, project_id, category, amount, expense_date)
        values (get_current_company_id(), (select id from projects limit 1), 'gear', 4000, current_date);
    `)
  })

  it('gst_analysis reads real per-line tax, not a flat assumed rate', async () => {
    const r = await db.query<{ v: Record<string, never> }>(
      `select gst_analysis(current_date - 90, current_date) as v;`,
    )
    const v = r.rows[0]!.v as unknown as {
      gst_collected: number
      input_tax_credit: number
      net_gst_liability: number
      by_gst_rate: unknown[]
    }
    // No invoices in the fixture, so every figure is a real zero rather than
    // (subtotal - discount) * an assumed 18%.
    expect(v.gst_collected).toBe(0)
    expect(v.net_gst_liability).toBe(0)
    expect(Array.isArray(v.by_gst_rate)).toBe(true)
    // Expense-side credit is derived from expenses.gst_rate, added in 0064.
    expect(v.input_tax_credit).toBe(0)
  })

  it('by_state resolves the stored GST state code to a readable name', async () => {
    // place_of_supply on invoices is the 2-digit GST state code ('27'), not a
    // name -- gst_analysis() once grouped and returned that raw code, so the
    // report showed "27" instead of "Maharashtra".
    await db.query(`
      select create_invoice(
        (select id from clients limit 1), (select id from projects limit 1), '27',
        current_date, current_date, 1000, 0, 1000, 180, 1180,
        '[{"description":"Shoot","quantity":1,"rate":1000,"amount":1000,"gst_rate":18,"taxable":1000,"cgst":90,"sgst":90,"igst":0}]'::jsonb
      );
    `)
    const r = await db.query<{ v: Record<string, never> }>(
      `select gst_analysis(current_date - 1, current_date + 1) as v;`,
    )
    const v = r.rows[0]!.v as unknown as { by_state: { state: string; income: number; gst: number }[] }
    expect(v.by_state).toEqual([{ state: 'Maharashtra', income: 1000, gst: 180 }])
  })

  it('expenses carries the gst_rate the credit is worked out from', async () => {
    const c = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'public' and table_name = 'expenses' and column_name = 'gst_rate';`,
    )
    expect(c.rows[0]!.n).toBe(1)
  })
})

/**
 * The predicate /auth/register uses to spot a pending invitation before it
 * creates a studio. Without it, an invited photographer who signs up on the
 * site instead of following their emailed link becomes super_admin of a brand
 * new empty studio, on its own trial, while the studio that invited them sees
 * nobody arrive -- which is how a team of employees ends up as a set of
 * unrelated owners.
 *
 * Only a LIVE invitation counts. Revoked, expired and already-accepted ones
 * must not block a genuine new signup.
 */
describe('registration defers to a live invitation', () => {
  let db: PGlite
  const live = 'joiner@studio.test'
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(`
      insert into user_invitations (company_id, email, token_hash, pending_name, expires_at)
      values
        (get_current_company_id(), '${live}',            'h1', 'Live',    now() + interval '7 days'),
        (get_current_company_id(), 'expired@s.test',     'h2', 'Expired', now() - interval '1 day'),
        (get_current_company_id(), 'revoked@s.test',     'h3', 'Revoked', now() + interval '7 days'),
        (get_current_company_id(), 'accepted@s.test',    'h4', 'Done',    now() + interval '7 days');
      update user_invitations set revoked_at  = now() where email = 'revoked@s.test';
      update user_invitations set accepted_at = now() where email = 'accepted@s.test';
    `)
  })

  const pending = (email: string) =>
    db.query<{ one: number }>(
      `select 1 as one from user_invitations
        where email = '${email}' and accepted_at is null and revoked_at is null and expires_at > now()
        limit 1;`,
    )

  it('blocks a signup that already has an invitation waiting', async () => {
    expect((await pending(live)).rows).toHaveLength(1)
  })

  it('lets everyone else through: revoked, expired, accepted and unknown', async () => {
    for (const e of ['expired@s.test', 'revoked@s.test', 'accepted@s.test', 'nobody@s.test']) {
      expect((await pending(e)).rows).toHaveLength(0)
    }
  })
})

/**
 * Lovable-parity additions: client relation/GSTIN, lead event fields, and the
 * referral slug + public lookup. Each of these landed alongside a UI change,
 * so this proves the SQL side independent of what the frontend sends.
 */
describe('Lovable parity: client, lead and referral fields (0065-0067)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('a client can carry a relation tag and a GSTIN', async () => {
    const r = await db.query<{ id: string }>(
      `insert into clients (company_id, name, relation, gstin)
       values (get_current_company_id(), 'Acme', 'Referral', '27ABCDE1234F1Z5')
       returning id;`,
    )
    const row = await db.query<{ relation: string; gstin: string }>(
      `select relation, gstin from clients where id = '${r.rows[0]!.id}';`,
    )
    expect(row.rows[0]).toEqual({ relation: 'Referral', gstin: '27ABCDE1234F1Z5' })
  })

  it('a lead can carry an event type, date and location', async () => {
    const r = await db.query<{ id: string }>(
      `insert into crm_leads (company_id, phone, phone_norm, event_type, event_date, event_location)
       values (get_current_company_id(), '9000000000', '9000000000', 'Wedding', '2026-12-14', 'Taj Palace, Jaipur')
       returning id;`,
    )
    const row = await db.query<{ event_type: string; event_date: string; event_location: string }>(
      `select event_type, event_date, event_location from crm_leads where id = '${r.rows[0]!.id}';`,
    )
    expect(row.rows[0]!.event_type).toBe('Wedding')
    expect(row.rows[0]!.event_location).toBe('Taj Palace, Jaipur')
  })

  it('a lead can carry a free-text group tag, and its source covers every channel a studio hears from a client on', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const ids: string[] = []
    for (const source of ['instagram', 'whatsapp', 'google_form', 'csv_import', 'other']) {
      const inserted = await db.query<{ id: string }>(
        `insert into crm_leads (company_id, phone, phone_norm, source) values ('${co}', '9${source.length}00000000', '9${source.length}00000000', '${source}') returning id;`,
      )
      ids.push(inserted.rows[0]!.id)
    }
    const rows = await db.query<{ source: string }>(`select source from crm_leads where id in (${ids.map((id) => `'${id}'`).join(',')});`)
    expect(rows.rows.map((r) => r.source).sort()).toEqual(['csv_import', 'google_form', 'instagram', 'other', 'whatsapp'])

    await expect(
      db.exec(`insert into crm_leads (company_id, phone, phone_norm, source) values ('${co}', '9000000099', '9000000099', 'not_a_real_source');`),
    ).rejects.toThrow()

    const withGroup = await db.query<{ id: string }>(
      `insert into crm_leads (company_id, phone, phone_norm, group_name) values ('${co}', '9000000098', '9000000098', 'Hot Lead, Already Booked') returning id;`,
    )
    const g = await db.query<{ group_name: string }>(`select group_name from crm_leads where id = '${withGroup.rows[0]!.id}';`)
    expect(g.rows[0]!.group_name).toBe('Hot Lead, Already Booked')
  })

  it('generate_referral_slug is readable, unique, and stable to look up', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const a = await db.query<{ slug: string }>(
      `insert into referral_campaigns (company_id, name, slug) values ('${co}', 'Wedding Referral', generate_referral_slug('Wedding Referral')) returning slug;`,
    )
    const b = await db.query<{ slug: string }>(
      `insert into referral_campaigns (company_id, name, slug) values ('${co}', 'Wedding Referral', generate_referral_slug('Wedding Referral')) returning slug;`,
    )
    expect(a.rows[0]!.slug).not.toBe(b.rows[0]!.slug)
    expect(a.rows[0]!.slug).toMatch(/^wedding-referral-/)

    const lookup = await db.query<{ v: { name: string; campaign_id: string } }>(
      `select get_public_referral_campaign('${a.rows[0]!.slug}') as v;`,
    )
    expect(lookup.rows[0]!.v.name).toBe('Wedding Referral')
  })

  it('an ended campaign is not reachable through the public lookup', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const made = await db.query<{ slug: string }>(
      `insert into referral_campaigns (company_id, name, slug, status)
       values ('${co}', 'Old Promo', generate_referral_slug('Old Promo'), 'ended') returning slug;`,
    )
    const lookup = await db.query<{ v: unknown }>(`select get_public_referral_campaign('${made.rows[0]!.slug}') as v;`)
    expect(lookup.rows[0]!.v).toBeNull()
  })

  it('a referral submission can carry the event type, date and function count the original form asked for', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const campaign = await db.query<{ id: string }>(
      `insert into referral_campaigns (company_id, name, slug) values ('${co}', 'Friend Referral', generate_referral_slug('Friend Referral')) returning id;`,
    )
    const campaignId = campaign.rows[0]!.id

    const submitted = await db.query<{ submit_referral: string }>(`
      select submit_referral(
        p_campaign_id => '${campaignId}'::uuid,
        p_client_name => 'Riya Shah',
        p_client_phone => '9000001234',
        p_event_type => 'Wedding',
        p_event_date => '2027-02-14',
        p_functions_count => 4
      ) as submit_referral;`)
    const row = await db.query<{ event_type: string; event_date: Date; functions_count: number }>(
      `select event_type, event_date, functions_count from referral_submissions where id = '${submitted.rows[0]!.submit_referral}';`,
    )
    expect({ ...row.rows[0], event_date: row.rows[0]!.event_date.toISOString().slice(0, 10) }).toEqual({
      event_type: 'Wedding',
      event_date: '2027-02-14',
      functions_count: 4,
    })

    // Every field here is optional -- a friend who only leaves a name and phone still goes through.
    const bare = await db.query<{ submit_referral: string }>(`
      select submit_referral(p_campaign_id => '${campaignId}'::uuid, p_client_name => 'Anon Friend', p_client_phone => '9000005678') as submit_referral;`)
    const bareRow = await db.query<{ event_type: string | null; functions_count: number | null }>(
      `select event_type, functions_count from referral_submissions where id = '${bare.rows[0]!.submit_referral}';`,
    )
    expect(bareRow.rows[0]).toEqual({ event_type: null, functions_count: null })

    await expect(
      db.exec(
        `insert into referral_submissions (company_id, campaign_id, client_name, functions_count) values ('${co}', '${campaignId}', 'Bad Count', 21);`,
      ),
    ).rejects.toThrow()
  })

  it('the service catalog rejects a duplicate name per company', async () => {
    await db.exec(`insert into services (company_id, name) values (get_current_company_id(), 'Wedding Photography');`)
    await expect(
      db.exec(`insert into services (company_id, name) values (get_current_company_id(), 'Wedding Photography');`),
    ).rejects.toThrow()
  })
})

/**
 * Project Documents (terms dashboard) and Team Work Preview's admin-scoped
 * filters -- both new call paths this session added, neither previously
 * called by any test.
 */
describe('Lovable parity: project documents and per-assignee filters', () => {
  let db: PGlite
  let projectId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(`
      insert into clients (company_id, name, phone) values (get_current_company_id(), 'Acme', '9000000000');
      insert into projects (company_id, client_id, name, package_cost, status)
        values (get_current_company_id(), (select id from clients limit 1), 'Wedding', 100000, 'active');
    `)
    projectId = (await db.query<{ id: string }>(`select id from projects limit 1;`)).rows[0]!.id
  })

  it('issuing terms twice for a project keeps both documents, latest first', async () => {
    await db.query(`select * from issue_terms_document(p_project_id => '${projectId}', p_rendered_body => 'v1');`)
    await db.query(`select * from issue_terms_document(p_project_id => '${projectId}', p_rendered_body => 'v2');`)
    const rows = await db.query<{ id: number }>(
      `select count(*)::int as id from project_terms_documents where project_id = '${projectId}';`,
    )
    expect(rows.rows[0]!.id).toBe(2)
  })

  it("tasks and shoots can be filtered to one person's assignments", async () => {
    await db.query(`select register_company_and_admin('Studio','Owner');`) // no-op, idempotent
    const uid = OWNER
    await db.exec(`
      insert into tasks (company_id, title, status, priority) values (get_current_company_id(), 'Edit gallery', 'to_do', 'medium');
      insert into task_assignees (company_id, task_id, user_id)
        values (get_current_company_id(), (select id from tasks limit 1), '${uid}');
    `)
    const mine = await db.query<{ count: number }>(
      `select count(*)::int as count
         from tasks t
        where exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = '${uid}');`,
    )
    expect(mine.rows[0]!.count).toBe(1)
    const someoneElse = await db.query<{ count: number }>(
      `select count(*)::int as count
         from tasks t
        where exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = '22222222-2222-2222-2222-222222222222');`,
    )
    expect(someoneElse.rows[0]!.count).toBe(0)
  })
})

/**
 * Task priorities catalogue (0007's company_task_priorities, orphaned until
 * this session -- no route or contract referenced it before). Proves a task
 * tagged with a custom code joins back to its label and tone.
 */
describe('Lovable parity: custom task priorities', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(`
      insert into company_task_priorities (company_id, code, label, tone, sort_order)
        values (get_current_company_id(), 'rush', 'Rush', 'danger', 10);
      insert into tasks (company_id, title, status, priority, custom_priority_code)
        values (get_current_company_id(), 'Cull gallery', 'to_do', 'high', 'rush');
      insert into tasks (company_id, title, status, priority)
        values (get_current_company_id(), 'Untitled task', 'to_do', 'medium');
    `)
  })

  it("a task tagged with a custom code resolves to that priority's label and tone", async () => {
    const rows = await db.query<{ title: string; custom_priority_label: string | null; custom_priority_tone: string | null }>(`
      select t.title, cp.label as custom_priority_label, cp.tone as custom_priority_tone
        from tasks t
        left join company_task_priorities cp on cp.company_id = t.company_id and cp.code = t.custom_priority_code
       where t.company_id = get_current_company_id()
       order by t.title;
    `)
    expect(rows.rows).toEqual([
      { title: 'Cull gallery', custom_priority_label: 'Rush', custom_priority_tone: 'danger' },
      { title: 'Untitled task', custom_priority_label: null, custom_priority_tone: null },
    ])
  })

  it('a duplicate priority code within the same company is rejected', async () => {
    await expect(
      db.exec(`insert into company_task_priorities (company_id, code, label) values (get_current_company_id(), 'rush', 'Also Rush');`),
    ).rejects.toThrow()
  })
})

/**
 * Work submission reminders (0068). The setting, its default, and the sweep
 * that turns an overdue-soon task with no submission into a notification --
 * none of this existed before this session; the old app had the setting,
 * the rebuild had neither the setting nor the sweep.
 */
describe('Lovable parity: work submission reminders', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('defaults to enabled with 7/3/1 day thresholds before any setting exists', async () => {
    const r = await db.query<{ v: { enabled: boolean; reminder_days: number[] } }>(
      `select get_work_submission_reminder_settings() as v;`,
    )
    expect(r.rows[0]!.v).toEqual({ enabled: true, reminder_days: [7, 3, 1] })
  })

  it('the owner can change the cadence, and it sticks', async () => {
    await db.query(`select set_work_submission_reminder_settings(true, array[14,7,1,0]);`)
    const r = await db.query<{ v: { reminder_days: number[] } }>(`select get_work_submission_reminder_settings() as v;`)
    expect(r.rows[0]!.v.reminder_days).toEqual([14, 7, 1, 0])
  })

  it('nudges the assignee of a task due at a configured threshold with no submission yet, once per day', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`
      insert into tasks (company_id, title, status, priority, due_date)
        values ('${co}', 'Edit gallery', 'to_do', 'high', current_date + 1);
      insert into task_assignees (company_id, task_id, user_id)
        values ('${co}', (select id from tasks where title = 'Edit gallery'), '${OWNER}');
    `)
    const first = await db.query<{ v: { tasks_due: number; notifications_created: number } }>(
      `select run_work_submission_reminder_cron(false) as v;`,
    )
    expect(first.rows[0]!.v.tasks_due).toBe(1)
    expect(first.rows[0]!.v.notifications_created).toBe(1)

    const second = await db.query<{ v: { notifications_created: number } }>(
      `select run_work_submission_reminder_cron(false) as v;`,
    )
    expect(second.rows[0]!.v.notifications_created).toBe(0)
  })

  it('a task with an approved submission is not nudged again', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const taskId = (
      await db.query<{ id: string }>(
        `insert into tasks (company_id, title, status, priority, due_date)
         values ('${co}', 'Deliver album', 'to_do', 'high', current_date + 1) returning id;`,
      )
    ).rows[0]!.id
    await db.exec(`
      insert into task_assignees (company_id, task_id, user_id) values ('${co}', '${taskId}', '${OWNER}');
      insert into team_work_submissions (company_id, task_id, submitted_by, submission_link, status)
        values ('${co}', '${taskId}', '${OWNER}', 'https://example.com/album', 'approved');
    `)
    const rows = await db.query<{ count: number }>(
      `select count(*)::int as count
         from tasks t
         join task_assignees a on a.task_id = t.id
        where t.id = '${taskId}'
          and not exists (select 1 from team_work_submissions w where w.task_id = t.id and w.status <> 'rejected');`,
    )
    expect(rows.rows[0]!.count).toBe(0)
  })
})

/**
 * Employee compensation structure (0069). The old wizard's flexible pay
 * model -- payout type, commission, stipend, an effective date range --
 * reduced to a flat `salary` in the rebuild. Added as columns on `users`
 * (0069's own comment explains why, not a new table): this proves they
 * round-trip and that the date-range check constraint actually holds.
 */
describe('Lovable parity: employee compensation structure', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('a per-shoot payout with a revenue commission and a stipend round-trips', async () => {
    await db.exec(`
      update users set payout_type = 'per_shoot', commission_pct = 12.5, commission_basis = 'revenue',
        stipend_amount = 2000, pay_effective_from = '2026-01-01', compensation_notes = 'Second shooter rate'
      where user_id = '${OWNER}';
    `)
    const row = await db.query<{
      payout_type: string
      commission_pct: string
      commission_basis: string
      stipend_amount: string
    }>(`select payout_type, commission_pct, commission_basis, stipend_amount from users where user_id = '${OWNER}';`)
    expect(row.rows[0]).toEqual({
      payout_type: 'per_shoot',
      commission_pct: '12.50',
      commission_basis: 'revenue',
      stipend_amount: '2000.00',
    })
  })

  it('an effective-to date before effective-from is rejected', async () => {
    await expect(
      db.exec(`update users set pay_effective_from = '2026-06-01', pay_effective_to = '2026-01-01' where user_id = '${OWNER}';`),
    ).rejects.toThrow()
  })

  it('an unrecognised payout type is rejected', async () => {
    await expect(
      db.exec(`update users set payout_type = 'whenever_i_feel_like_it' where user_id = '${OWNER}';`),
    ).rejects.toThrow()
  })
})

/**
 * Round 2 of the Lovable parity pass: fixed-overhead allocation, invoice/
 * quote numbering exposure, expense GST fields, and the lead fields found on
 * a second read of the old lead form.
 */
describe('Lovable parity round 2: overhead allocation and company settings', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('a company-wide fixed-overhead expense is split equally across every active project', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`
      insert into clients (company_id, name) values ('${co}', 'Acme');
      insert into projects (company_id, client_id, name, package_cost, status) values
        ('${co}', (select id from clients limit 1), 'Wedding A', 1000, 'active'),
        ('${co}', (select id from clients limit 1), 'Wedding B', 1000, 'active'),
        ('${co}', (select id from clients limit 1), 'Cancelled shoot', 1000, 'cancelled');
      insert into expenses (company_id, project_id, category, amount, is_fixed_overhead)
        values ('${co}', null, 'Rent', 1000, true);
    `)
    const rows = await db.query<{ name: string; project_expenses: string }>(
      `select name, project_expenses from project_financials where company_id = '${co}' order by name;`,
    )
    const byName = Object.fromEntries(rows.rows.map((r) => [r.name, Number(r.project_expenses)]))
    expect(byName['Wedding A']).toBe(500)
    expect(byName['Wedding B']).toBe(500)
    // Cancelled projects don't absorb overhead, and their own direct expenses stay untouched (none here).
    expect(byName['Cancelled shoot']).toBe(0)
  })

  it('a project-linked expense is unaffected by the overhead split', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const proj = (await db.query<{ id: string }>(`select id from projects where name = 'Wedding A';`)).rows[0]!.id
    await db.exec(`insert into expenses (company_id, project_id, category, amount) values ('${co}', '${proj}', 'Venue deposit', 200);`)
    const row = await db.query<{ project_expenses: string }>(
      `select project_expenses from project_financials where project_id = '${proj}';`,
    )
    // 200 direct + 500 overhead share from the previous test's fixture.
    expect(Number(row.rows[0]!.project_expenses)).toBe(700)
  })

  it('a company with no fixed-overhead expenses allocates nothing extra', async () => {
    const db2 = await freshDb()
    await db2.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner2@s.test');`)
    await asUser(db2, OWNER)
    await db2.query(`select register_company_and_admin('Studio 2','Owner');`)
    const co2 = (await db2.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db2.exec(`
      insert into clients (company_id, name) values ('${co2}', 'Client');
      insert into projects (company_id, client_id, name, package_cost, status)
        values ('${co2}', (select id from clients limit 1), 'Solo project', 1000, 'active');
    `)
    const row = await db2.query<{ project_expenses: string }>(`select project_expenses from project_financials where company_id = '${co2}';`)
    expect(Number(row.rows[0]!.project_expenses)).toBe(0)
  })

  it('invoice/quote numbering and the logo default correctly and can be changed', async () => {
    const before = await db.query<{ invoice_number_prefix: string; invoice_next_number: number; quote_number_prefix: string }>(
      `select invoice_number_prefix, invoice_next_number, quote_number_prefix from companies where id = get_current_company_id();`,
    )
    expect(before.rows[0]).toEqual({ invoice_number_prefix: 'INV-', invoice_next_number: 1, quote_number_prefix: 'Q-' })
    await db.exec(`update companies set invoice_number_prefix = 'IPC-', avatar_url = 'https://example.com/logo.png' where id = get_current_company_id();`)
    const after = await db.query<{ invoice_number_prefix: string; avatar_url: string }>(
      `select invoice_number_prefix, avatar_url from companies where id = get_current_company_id();`,
    )
    expect(after.rows[0]).toEqual({ invoice_number_prefix: 'IPC-', avatar_url: 'https://example.com/logo.png' })
  })

  it('an expense can carry a GST rate now that the form exposes it', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`insert into expenses (company_id, category, amount, gst_treatment, gst_rate) values ('${co}', 'Software', 5000, 'gst_applicable', 18);`)
    const row = await db.query<{ gst_treatment: string; gst_rate: string }>(
      `select gst_treatment, gst_rate from expenses where category = 'Software';`,
    )
    expect(row.rows[0]).toEqual({ gst_treatment: 'gst_applicable', gst_rate: '18.00' })
  })

  it('a lead carries an alternate phone and a city', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`
      insert into crm_leads (company_id, phone, phone_norm, alternate_phone, city)
        values ('${co}', '9000000001', '9000000001', '9000000002', 'Mumbai');
    `)
    const row = await db.query<{ alternate_phone: string; city: string }>(
      `select alternate_phone, city from crm_leads where phone = '9000000001';`,
    )
    expect(row.rows[0]).toEqual({ alternate_phone: '9000000002', city: 'Mumbai' })
  })
})

/**
 * Project profitability report ("Calculated Expenses" in the original, 0086):
 * per-project income/expense/margin, sortable, date-windowed, paginated.
 */
describe('project profitability report (0086)', () => {
  let db: PGlite
  let co: string
  let p1: string
  let p2: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`insert into clients (company_id, name) values ('${co}', 'Acme');`)
    const clientId = (await db.query<{ id: string }>(`select id from clients where company_id = '${co}'`)).rows[0]!.id
    p1 = (
      await db.query<{ id: string }>(
        `insert into projects (company_id, client_id, name, package_cost, status) values ('${co}', '${clientId}', 'Wedding A', 100000, 'active') returning id;`,
      )
    ).rows[0]!.id
    p2 = (
      await db.query<{ id: string }>(
        `insert into projects (company_id, client_id, name, package_cost, status) values ('${co}', '${clientId}', 'Wedding B', 50000, 'active') returning id;`,
      )
    ).rows[0]!.id
    await db.exec(`insert into received_payments (company_id, project_id, amount, paid_on) values ('${co}', '${p1}', 60000, '2026-01-10');`)
    await db.exec(`insert into received_payments (company_id, project_id, amount, paid_on) values ('${co}', '${p2}', 50000, '2026-02-05');`)
    await db.exec(`insert into expenses (company_id, project_id, amount, expense_date, category) values ('${co}', '${p1}', 10000, '2026-01-15', 'travel');`)
    await db.exec(`insert into expenses (company_id, project_id, is_fixed_overhead, amount, expense_date, category) values ('${co}', null, true, 2000, '2026-01-20', 'supplies');`)
  })

  it('splits paid income, receivables and project-plus-overhead expense the way the original did, plus the overhead share this app already allocates', async () => {
    const r = await db.query<{ v: { items: Record<string, unknown>[]; summary: Record<string, unknown> } }>(
      `select project_profitability_report() as v;`,
    )
    const byId = Object.fromEntries(r.rows[0]!.v.items.map((i) => [i.project_id, i]))
    // Wedding A: 60k paid of 100k, 10k direct expense + a 1k/2 overhead share = 11k.
    expect(byId[p1]).toMatchObject({
      project_total_value: 100000,
      paid_income: 60000,
      receivables: 40000,
      company_expense_total: 11000,
      gross_profit: 49000,
      balance_status: 'pending',
      attention_flags: ['pending_receivable'],
    })
    // Wedding B: fully paid, no direct expense, still absorbs its overhead share.
    expect(byId[p2]).toMatchObject({
      project_total_value: 50000,
      paid_income: 50000,
      receivables: 0,
      company_expense_total: 1000,
      balance_status: 'settled',
    })
    expect(r.rows[0]!.v.summary).toMatchObject({
      project_count: 2,
      total_project_value: 150000,
      total_paid_income: 110000,
      total_company_expenses: 12000,
      pending_project_count: 1,
    })
  })

  it('a date window scopes payments and expenses only -- project value stays the full booking either way', async () => {
    const r = await db.query<{ v: { items: Record<string, unknown>[] } }>(
      `select project_profitability_report(p_date_from => '2026-02-01', p_date_to => '2026-02-28') as v;`,
    )
    const byId = Object.fromEntries(r.rows[0]!.v.items.map((i) => [i.project_id, i]))
    // January's payment and both January expenses fall outside the window.
    expect(byId[p1]).toMatchObject({ project_total_value: 100000, paid_income: 0, company_expense_total: 0 })
    expect(byId[p2]).toMatchObject({ project_total_value: 50000, paid_income: 50000, company_expense_total: 0 })
  })

  it('sorts by any allowed column in either direction, and paginates the result', async () => {
    const asc = await db.query<{ v: { items: { project_name: string }[] } }>(
      `select project_profitability_report(p_sort_by => 'total_cost', p_sort_direction => 'asc') as v;`,
    )
    expect(asc.rows[0]!.v.items.map((i) => i.project_name)).toEqual(['Wedding B', 'Wedding A'])

    const desc = await db.query<{ v: { items: { project_name: string }[] } }>(
      `select project_profitability_report(p_sort_by => 'total_cost', p_sort_direction => 'desc') as v;`,
    )
    expect(desc.rows[0]!.v.items.map((i) => i.project_name)).toEqual(['Wedding A', 'Wedding B'])

    // page_size is clamped to at least 10, same as the original's own floor.
    const paged = await db.query<{ v: { pagination: { page_size: number; total_count: number; total_pages: number } } }>(
      `select project_profitability_report(p_page_size => 1) as v;`,
    )
    expect(paged.rows[0]!.v.pagination).toEqual({ page: 1, page_size: 10, total_count: 2, total_pages: 1 })
  })

  it('filters by project, client, status and a name/client search', async () => {
    const byProject = await db.query<{ v: { items: unknown[] } }>(
      `select project_profitability_report(p_project_id => '${p1}') as v;`,
    )
    expect(byProject.rows[0]!.v.items).toHaveLength(1)

    const bySearch = await db.query<{ v: { items: { project_name: string }[] } }>(
      `select project_profitability_report(p_search => 'wedding b') as v;`,
    )
    expect(bySearch.rows[0]!.v.items.map((i) => i.project_name)).toEqual(['Wedding B'])

    const byStatus = await db.query<{ v: { items: unknown[] } }>(
      `select project_profitability_report(p_status => 'cancelled') as v;`,
    )
    expect(byStatus.rows[0]!.v.items).toHaveLength(0)
  })

  it('a project running at a loss is flagged, and a cancelled project does not absorb overhead', async () => {
    await db.exec(`
      insert into projects (company_id, client_id, name, package_cost, status)
        values ('${co}', (select id from clients where company_id = '${co}'), 'Underwater', 1000, 'active');
      insert into expenses (company_id, project_id, amount, expense_date, category)
        values ('${co}', (select id from projects where name = 'Underwater'), 5000, '2026-01-15', 'equipment');
      insert into projects (company_id, client_id, name, package_cost, status)
        values ('${co}', (select id from clients where company_id = '${co}'), 'Called off', 1000, 'cancelled');
    `)
    const r = await db.query<{ v: { items: Record<string, unknown>[] } }>(`select project_profitability_report() as v;`)
    const byName = Object.fromEntries(r.rows[0]!.v.items.map((i) => [i.project_name, i]))
    expect(byName['Underwater']).toMatchObject({ profitability_status: 'loss', attention_flags: expect.arrayContaining(['loss_project']) })
    expect(byName['Called off']).toMatchObject({ company_expense_total: 0 })
  })
})

/**
 * Round 3 of the Lovable parity pass: parties (vendors/freelancers) were a
 * completely orphaned table -- no route anywhere referenced them, despite
 * both expense tables already joining to one for display. Both expense forms
 * could never actually set party_id, gst_treatment (personal), gst_rate
 * (personal), or expense_date (personal) -- everything below now round-trips
 * because the form actually sends it.
 */
describe('Lovable parity round 3: parties and expense form completeness', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
  })

  it('a party can be created, is unique enough to be useful, and a company expense can reference it', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const party = await db.query<{ id: string }>(
      `insert into parties (company_id, name, kind) values ('${co}', 'Prop House', 'vendor') returning id;`,
    )
    await db.exec(`
      insert into expenses (company_id, party_id, category, amount, gst_treatment, gst_rate)
        values ('${co}', '${party.rows[0]!.id}', 'Props', 3000, 'gst_applicable', 12);
    `)
    const row = await db.query<{ party_name: string; gst_rate: string }>(`
      select p.name as party_name, e.gst_rate from expenses e
      join parties p on p.id = e.party_id where e.category = 'Props';
    `)
    expect(row.rows[0]).toEqual({ party_name: 'Prop House', gst_rate: '12.00' })
  })

  it('deleting a party in use leaves the expense in place with the reference cleared', async () => {
    const partyId = (await db.query<{ id: string }>(`select party_id as id from expenses where category = 'Props';`)).rows[0]!.id
    await db.exec(`delete from parties where id = '${partyId}';`)
    const row = await db.query<{ category: string; party_id: string | null }>(`select category, party_id from expenses where category = 'Props';`)
    expect(row.rows[0]).toEqual({ category: 'Props', party_id: null })
  })

  it('an expense someone paid from their own pocket carries its date, party, GST rate and who paid (0170)', async () => {
    const co = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    const party = (
      await db.query<{ id: string }>(`insert into parties (company_id, name, kind) values ('${co}', 'Rental Co', 'vendor') returning id;`)
    ).rows[0]!.id
    await db.exec(`
      insert into expenses (company_id, party_id, amount, expense_date, gst_treatment, gst_rate, paid_by_user_id, reimbursement_status)
        values ('${co}', '${party}', 750, '2026-03-01', 'gst_applicable', 5, '${OWNER}', 'pending');
    `)
    const r = await db.query<{ party_name: string; gst_rate: number; paid_by: string; status: string }>(
      `select p.name as party_name, e.gst_rate::float as gst_rate, e.paid_by_user_id as paid_by, e.reimbursement_status as status
         from expenses e join parties p on p.id = e.party_id where e.expense_date = '2026-03-01' and e.amount = 750;`,
    )
    expect(r.rows[0]).toMatchObject({ party_name: 'Rental Co', gst_rate: 5, paid_by: OWNER, status: 'pending' })
  })
})

/**
 * Round 4: data custody linkage and the work-submission location note.
 *
 * The old data-management form linked every card to the shoot it came off;
 * the rebuild's create form hardcoded shoot_id/project_id to null on every
 * submission, so a logged card floated with no way to tell which project it
 * belonged to. Same story for work submissions and location_note, which has
 * existed on team_work_submissions since 0010 and was read by nothing.
 */
describe('Lovable parity round 4: data custody linkage, work location note', () => {
  let db: PGlite
  let projectId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(`
      insert into clients (company_id, name) values (get_current_company_id(), 'Acme');
      insert into projects (company_id, client_id, name, package_cost, status)
        values (get_current_company_id(), (select id from clients limit 1), 'Wedding', 100000, 'active');
    `)
    projectId = (await db.query<{ id: string }>(`select id from projects limit 1;`)).rows[0]!.id
  })

  it('a data record can be linked to the project it came from, and reads back joined', async () => {
    await db.exec(`
      insert into shoot_data_records (company_id, project_id, data_label, data_type, card_count, size_gb, copied_by_uid)
        values (get_current_company_id(), '${projectId}', 'CF Card A', 'Photos (RAW)', 2, 64, '${OWNER}');
    `)
    const row = await db.query<{ project_name: string; data_type: string }>(`
      select p.name as project_name, d.data_type from shoot_data_records d
      join projects p on p.id = d.project_id where d.data_label = 'CF Card A';
    `)
    expect(row.rows[0]).toEqual({ project_name: 'Wedding', data_type: 'Photos (RAW)' })
  })

  it('submit_work has exactly one signature, and the API call shape (4 named args) resolves without ambiguity', async () => {
    const overloads = await db.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'submit_work';`)
    expect(overloads.rows[0]!.n).toBe(1)
    const r = await db.query<{ id: string }>(
      `select submit_work(p_task_id => null, p_project_id => '${projectId}', p_link => 'https://drive.example.com/x', p_notes => 'test') as id;`,
    )
    expect(r.rows[0]!.id).toBeTruthy()
  })

  it('a work submission carries its location note separately from the link', async () => {
    const r = await db.query<{ id: string }>(
      `select submit_work(p_task_id => null, p_project_id => '${projectId}', p_link => 'https://drive.example.com/y', p_notes => null, p_location_note => 'Backup HDD 3') as id;`,
    )
    const row = await db.query<{ location_note: string; submission_link: string }>(
      `select location_note, submission_link from team_work_submissions where id = '${r.rows[0]!.id}';`,
    )
    expect(row.rows[0]).toEqual({ location_note: 'Backup HDD 3', submission_link: 'https://drive.example.com/y' })
  })
})

/**
 * Round 5: post-creation editability. The audit that produced rounds 1-4
 * checked that every create form had the right fields; this round checks the
 * matching claim -- that a team member or a company expense entered wrong can
 * actually be corrected afterwards, not just created. No new migration: both
 * routes patch columns that already existed.
 */
describe('Lovable parity round 5: editing a team member and a company expense', () => {
  let db: PGlite
  let companyId: string
  const MEMBER = '99999999-9999-9999-9999-999999999999'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    companyId = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`insert into auth.users (id, email) values ('${MEMBER}', 'member@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email, phone, engagement_type)
       values ('${MEMBER}', '${companyId}', 'employee', 'Rahul Sharma', 'member@s.test', '9000000001', 'in_house');`,
    )
  })

  it('a misspelled team member name and a wrong engagement type can both be corrected', async () => {
    await db.exec(
      `update users set name = 'Rahul Verma', engagement_type = 'freelancer', phone = '9000000099' where user_id = '${MEMBER}';`,
    )
    const row = await db.query<{ name: string; engagement_type: string; phone: string }>(
      `select name, engagement_type, phone from users where user_id = '${MEMBER}';`,
    )
    expect(row.rows[0]).toEqual({ name: 'Rahul Verma', engagement_type: 'freelancer', phone: '9000000099' })
  })

  it('a person can put a photo link on their own profile, next to the studio logo', async () => {
    await asUser(db, OWNER)
    await db.exec(`update users set avatar_url = 'https://cdn.example/me.jpg' where user_id = '${OWNER}';`)
    const row = await db.query<{ avatar_url: string }>(`select avatar_url from users where user_id = '${OWNER}';`)
    expect(row.rows[0]!.avatar_url).toBe('https://cdn.example/me.jpg')
  })

  it('a company expense logged with the wrong amount, date, and GST rate can be corrected', async () => {
    const created = await db.query<{ id: string }>(
      `insert into expenses (company_id, category, amount, expense_date, gst_treatment, gst_rate)
       values ('${companyId}', 'Travel', 500, '2026-01-01', 'non_gst', 0) returning id;`,
    )
    const id = created.rows[0]!.id
    await db.exec(
      `update expenses set amount = 750, expense_date = '2026-01-02', gst_treatment = 'gst_applicable', gst_rate = 5 where id = '${id}';`,
    )
    const row = await db.query<{ amount: string; expense_date: Date; gst_treatment: string; gst_rate: string }>(
      `select amount, expense_date, gst_treatment, gst_rate from expenses where id = '${id}';`,
    )
    expect({ ...row.rows[0], expense_date: row.rows[0]!.expense_date.toISOString().slice(0, 10) }).toEqual({
      amount: '750.00',
      expense_date: '2026-01-02',
      gst_treatment: 'gst_applicable',
      gst_rate: '5.00',
    })
  })

  it('an expense logged against the wrong project can be re-pointed to another, or unlinked to become an overhead cost', async () => {
    const [projA, projB] = await Promise.all(
      ['Wedding A', 'Wedding B'].map(async (name) => {
        await db.exec(`insert into clients (company_id, name) values ('${companyId}', '${name} client');`)
        const client = await db.query<{ id: string }>(`select id from clients where name = '${name} client';`)
        const proj = await db.query<{ id: string }>(
          `insert into projects (company_id, client_id, name, package_cost, status)
           values ('${companyId}', '${client.rows[0]!.id}', '${name}', 50000, 'active') returning id;`,
        )
        return proj.rows[0]!.id
      }),
    )
    const created = await db.query<{ id: string }>(
      `insert into expenses (company_id, project_id, category, amount) values ('${companyId}', '${projA}', 'Venue', 1000) returning id;`,
    )
    const id = created.rows[0]!.id
    await db.exec(`update expenses set project_id = '${projB}' where id = '${id}';`)
    expect((await db.query<{ project_id: string }>(`select project_id from expenses where id = '${id}';`)).rows[0]!.project_id).toBe(projB)
    await db.exec(`update expenses set project_id = null, is_fixed_overhead = true where id = '${id}';`)
    const unlinked = await db.query<{ project_id: string | null; is_fixed_overhead: boolean }>(
      `select project_id, is_fixed_overhead from expenses where id = '${id}';`,
    )
    expect(unlinked.rows[0]).toEqual({ project_id: null, is_fixed_overhead: true })
  })

  it('a deleted expense is gone, not merely hidden', async () => {
    const created = await db.query<{ id: string }>(
      `insert into expenses (company_id, category, amount) values ('${companyId}', 'Misc', 100) returning id;`,
    )
    const id = created.rows[0]!.id
    await db.exec(`delete from expenses where id = '${id}';`)
    const row = await db.query(`select id from expenses where id = '${id}';`)
    expect(row.rows.length).toBe(0)
  })

  it('a misspelled vendor name can be corrected in place, so every expense already pointing at it picks up the fix', async () => {
    const party = await db.query<{ id: string }>(
      `insert into parties (company_id, name, kind) values ('${companyId}', 'Prop Hosue', 'vendor') returning id;`,
    )
    const id = party.rows[0]!.id
    await db.exec(`insert into expenses (company_id, party_id, category, amount) values ('${companyId}', '${id}', 'Props', 500);`)
    await db.exec(`update parties set name = 'Prop House', kind = 'freelancer' where id = '${id}';`)
    const row = await db.query<{ party_name: string }>(
      `select p.name as party_name from expenses e join parties p on p.id = e.party_id where e.category = 'Props';`,
    )
    expect(row.rows[0]).toEqual({ party_name: 'Prop House' })
  })

  it('a data record\'s label, size, and project link can all be corrected after logging', async () => {
    await db.exec(`insert into clients (company_id, name) values ('${companyId}', 'Data client');`)
    const client = await db.query<{ id: string }>(`select id from clients where name = 'Data client';`)
    const proj = await db.query<{ id: string }>(
      `insert into projects (company_id, client_id, name, package_cost, status)
       values ('${companyId}', '${client.rows[0]!.id}', 'Data Wedding', 50000, 'active') returning id;`,
    )
    const projectId = proj.rows[0]!.id
    const record = await db.query<{ id: string }>(
      `insert into shoot_data_records (company_id, data_label, data_type, card_count, size_gb, copied_by_uid)
       values ('${companyId}', 'CF Card X', 'Photos (RAW)', 1, 32, '${OWNER}') returning id;`,
    )
    const id = record.rows[0]!.id
    await db.exec(
      `update shoot_data_records set data_label = 'CF Card X (relabeled)', size_gb = 64, project_id = '${projectId}' where id = '${id}';`,
    )
    const row = await db.query<{ data_label: string; size_gb: string; project_id: string }>(
      `select data_label, size_gb, project_id from shoot_data_records where id = '${id}';`,
    )
    expect(row.rows[0]).toEqual({ data_label: 'CF Card X (relabeled)', size_gb: '64.00', project_id: projectId })
  })

  it('an unverified data record can be deleted outright, but one with a confirmed copy cannot', async () => {
    const pending = await db.query<{ id: string }>(
      `insert into shoot_data_records (company_id, data_label, card_count, size_gb, copied_by_uid)
       values ('${companyId}', 'CF Card Pending', 1, 10, '${OWNER}') returning id;`,
    )
    const verified = await db.query<{ id: string }>(
      `insert into shoot_data_records (company_id, data_label, card_count, size_gb, copied_by_uid, primary_status, folder_path)
       values ('${companyId}', 'CF Card Verified', 1, 10, '${OWNER}', 'verified', '/2026/CF') returning id;`,
    )
    const guardedDelete = `delete from shoot_data_records
      where id = $1 and primary_status = 'pending' and backup_status = 'pending' returning id;`
    const okDelete = await db.query(guardedDelete.replace('$1', `'${pending.rows[0]!.id}'`))
    expect(okDelete.rows.length).toBe(1)
    const blockedDelete = await db.query(guardedDelete.replace('$1', `'${verified.rows[0]!.id}'`))
    expect(blockedDelete.rows.length).toBe(0)
    const stillThere = await db.query(`select id from shoot_data_records where id = '${verified.rows[0]!.id}';`)
    expect(stillThere.rows.length).toBe(1)
  })
})

/**
 * Round 6: a task could only be created and status-flipped -- a wrong title,
 * priority, due date, or assignee list had no fix path short of deleting and
 * recreating (and there was no delete either). PATCH /tasks/:id now covers
 * the same fields the create form sets, plus replacing the assignee set.
 */
describe('Lovable parity round 6: editing and deleting a task', () => {
  let db: PGlite
  let taskId: string
  const EMP_A = '77777777-7777-7777-7777-777777777771'
  const EMP_B = '77777777-7777-7777-7777-777777777772'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    const companyId = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`
      insert into auth.users (id, email) values ('${EMP_A}', 'a@s.test'), ('${EMP_B}', 'b@s.test');
      insert into users (user_id, company_id, role, name, email) values
        ('${EMP_A}', '${companyId}', 'employee', 'Editor A', 'a@s.test'),
        ('${EMP_B}', '${companyId}', 'employee', 'Editor B', 'b@s.test');
    `)
    const created = await db.query<{ id: string }>(
      `select create_task_with_assignees(p_project_id => null, p_deliverable_id => null, p_title => 'Cull photos',
         p_assignees => array['${EMP_A}']::uuid[]) as id;`,
    )
    taskId = created.rows[0]!.id
  })

  it('a task\'s title, priority, and due date can all be corrected after creation', async () => {
    await db.exec(
      `update tasks set title = 'Cull and select', priority = 'urgent', due_date = '2026-04-01' where id = '${taskId}';`,
    )
    const row = await db.query<{ title: string; priority: string; due_date: Date }>(
      `select title, priority, due_date from tasks where id = '${taskId}';`,
    )
    expect(row.rows[0]!.title).toBe('Cull and select')
    expect(row.rows[0]!.priority).toBe('urgent')
    expect(row.rows[0]!.due_date.toISOString().slice(0, 10)).toBe('2026-04-01')
  })

  it('reassigning a task replaces the assignee set rather than adding to it', async () => {
    await db.exec(`delete from task_assignees where task_id = '${taskId}';`)
    await db.exec(`insert into task_assignees (task_id, user_id, company_id)
      values ('${taskId}', '${EMP_B}', (select get_current_company_id()));`)
    const assignees = await db.query<{ user_id: string }>(`select user_id from task_assignees where task_id = '${taskId}';`)
    expect(assignees.rows.map((r) => r.user_id)).toEqual([EMP_B])
  })

  it('a deleted task takes its assignee rows with it, cascade, not left dangling', async () => {
    const before = await db.query<{ n: string }>(`select count(*)::text as n from task_assignees where task_id = '${taskId}';`)
    expect(Number(before.rows[0]!.n)).toBeGreaterThan(0)
    await db.exec(`delete from tasks where id = '${taskId}';`)
    const after = await db.query<{ n: string }>(`select count(*)::text as n from task_assignees where task_id = '${taskId}';`)
    expect(Number(after.rows[0]!.n)).toBe(0)
  })
})

describe('Lovable parity round 7: editing a project deliverable', () => {
  let db: PGlite
  let projectId: string
  let deliverableId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    await db.exec(`insert into clients (company_id, name) values (get_current_company_id(), 'Deliverable client');`)
    const client = await db.query<{ id: string }>(`select id from clients where name = 'Deliverable client';`)
    const proj = await db.query<{ id: string }>(
      `select create_project_with_details('${client.rows[0]!.id}', 'Deliverable Proj', 50000) as id;`,
    )
    projectId = proj.rows[0]!.id
    await db.exec(
      `insert into deliverables (company_id, project_id, title, show_on_quotation)
       values (get_current_company_id(), '${projectId}', 'Album', true);`,
    )
    deliverableId = (await db.query<{ id: string }>(`select id from deliverables where project_id = '${projectId}';`)).rows[0]!.id
  })

  it('a deliverable\'s title and quotation visibility can be corrected without touching the others', async () => {
    await db.exec(
      `update deliverables set title = 'Wedding Album (Premium)', show_on_quotation = false where id = '${deliverableId}';`,
    )
    const row = await db.query<{ title: string; show_on_quotation: boolean }>(
      `select title, show_on_quotation from deliverables where id = '${deliverableId}';`,
    )
    expect(row.rows[0]).toEqual({ title: 'Wedding Album (Premium)', show_on_quotation: false })
  })
})

/**
 * Round 8: a batch of smaller settings/reference objects that could be
 * created and deleted but never corrected in place -- a mistyped priority
 * label, a bundle checklist, a lead template, a picklist value, a pending
 * invitation, an unpaid payout, and a work submission awaiting review.
 */
describe('Lovable parity round 8: editing settings, invitations, payouts, and work submissions', () => {
  let db: PGlite
  let companyId: string
  const MEMBER = '88888888-8888-8888-8888-888888888881'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    companyId = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`insert into auth.users (id, email) values ('${MEMBER}', 'member8@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${MEMBER}', '${companyId}', 'employee', 'Member Eight', 'member8@s.test');`,
    )
  })

  it('a custom task priority label and tone can be corrected, but its code stays fixed', async () => {
    const p = await db.query<{ id: string }>(
      `insert into company_task_priorities (company_id, code, label, tone) values ('${companyId}', 'rush', 'Rsh', 'neutral') returning id;`,
    )
    await db.exec(`update company_task_priorities set label = 'Rush', tone = 'danger' where id = '${p.rows[0]!.id}';`)
    const row = await db.query<{ code: string; label: string; tone: string }>(
      `select code, label, tone from company_task_priorities where id = '${p.rows[0]!.id}';`,
    )
    expect(row.rows[0]).toEqual({ code: 'rush', label: 'Rush', tone: 'danger' })
  })

  it('a task bundle can be renamed and have its checklist replaced wholesale', async () => {
    const bundle = await db.query<{ id: string }>(
      `insert into task_bundles (company_id, name) values ('${companyId}', 'Wedding editin') returning id;`,
    )
    const bundleId = bundle.rows[0]!.id
    await db.exec(`insert into task_bundle_items (bundle_id, company_id, title, priority, sort_order)
      values ('${bundleId}', '${companyId}', 'Cull', 'medium', 0);`)
    await db.exec(`update task_bundles set name = 'Wedding editing' where id = '${bundleId}';`)
    await db.exec(`delete from task_bundle_items where bundle_id = '${bundleId}';`)
    await db.exec(`insert into task_bundle_items (bundle_id, company_id, title, priority, sort_order) values
      ('${bundleId}', '${companyId}', 'Cull and select', 'medium', 0),
      ('${bundleId}', '${companyId}', 'Colour grade', 'medium', 1);`)
    const name = await db.query<{ name: string }>(`select name from task_bundles where id = '${bundleId}';`)
    expect(name.rows[0]!.name).toBe('Wedding editing')
    const items = await db.query<{ title: string }>(`select title from task_bundle_items where bundle_id = '${bundleId}' order by sort_order;`)
    expect(items.rows.map((r) => r.title)).toEqual(['Cull and select', 'Colour grade'])
  })

  it('a lead send-template\'s wording can be fixed after saving it', async () => {
    const t = await db.query<{ id: string }>(
      `insert into crm_templates (company_id, name, body, kind) values ('${companyId}', 'Follow-up', 'Hi {{nam}}', 'whatsapp') returning id;`,
    )
    await db.exec(`update crm_templates set body = 'Hi {{name}}, thanks for reaching out!' where id = '${t.rows[0]!.id}';`)
    const row = await db.query<{ body: string }>(`select body from crm_templates where id = '${t.rows[0]!.id}';`)
    expect(row.rows[0]!.body).toBe('Hi {{name}}, thanks for reaching out!')
  })

  it('a custom lookup value and its active flag can both be corrected', async () => {
    const l = await db.query<{ id: string }>(
      `insert into custom_lookups (company_id, category, value) values ('${companyId}', 'lead_source', 'Instagam') returning id;`,
    )
    await db.exec(`update custom_lookups set value = 'Instagram', is_active = false where id = '${l.rows[0]!.id}';`)
    const row = await db.query<{ value: string; is_active: boolean }>(`select value, is_active from custom_lookups where id = '${l.rows[0]!.id}';`)
    expect(row.rows[0]).toEqual({ value: 'Instagram', is_active: false })
  })

  it('a new studio gets enquiry source and payment type seeded as picklists too, not just lead source and expense category', async () => {
    const categories = await db.query<{ category: string }>(
      `select distinct category from custom_lookups where company_id = '${companyId}' order by category;`,
    )
    expect(categories.rows.map((r) => r.category)).toEqual([
      'expense_category',
      'lead_source',
      'payment_type',
      'enquiry_source',
      'invoice_line_preset',
      'enquiry_status',
    ].sort())

    const paymentTypes = await db.query<{ value: string }>(
      `select value from custom_lookups where company_id = '${companyId}' and category = 'payment_type' order by sort_order;`,
    )
    expect(paymentTypes.rows.map((r) => r.value)).toEqual(['UPI', 'Cash', 'Bank transfer', 'Cheque'])

    const presetCount = await db.query<{ n: string }>(
      `select count(*)::text as n from custom_lookups where company_id = '${companyId}' and category = 'invoice_line_preset';`,
    )
    expect(presetCount.rows[0]!.n).toBe('14')

    const enquiryStatuses = await db.query<{ value: string }>(
      `select value from custom_lookups where company_id = '${companyId}' and category = 'enquiry_status' order by sort_order;`,
    )
    expect(enquiryStatuses.rows.map((r) => r.value)).toEqual([
      'new',
      'reviewed',
      'contacted',
      'converted',
      'closed',
    ])
  })

  it('a pending invitation\'s name and role can be corrected before it is accepted', async () => {
    const inv = await db.query<{ id: string }>(
      `insert into user_invitations (company_id, email, token_hash, role, pending_name, expires_at)
       values ('${companyId}', 'invitee@s.test', 'x', 'employee', 'Rahul Sharm', now() + interval '7 days') returning id;`,
    )
    await db.exec(`update user_invitations set pending_name = 'Rahul Sharma', role = 'manager' where id = '${inv.rows[0]!.id}';`)
    const row = await db.query<{ pending_name: string; role: string }>(
      `select pending_name, role from user_invitations where id = '${inv.rows[0]!.id}';`,
    )
    expect(row.rows[0]).toEqual({ pending_name: 'Rahul Sharma', role: 'manager' })
  })

  it('a pending payout\'s amount can be corrected, but the same guarded update is a no-op once it is completed', async () => {
    const payoutId = await db.query<{ id: string }>(
      `select create_team_payout('${MEMBER}', 5000, current_date - 7, current_date) as id;`,
    )
    const id = payoutId.rows[0]!.id
    const fixed = await db.query(`update team_payouts set amount = 6000 where id = '${id}' and status = 'pending' returning id;`)
    expect(fixed.rows.length).toBe(1)
    await db.exec(`update team_payouts set status = 'completed' where id = '${id}';`)
    const blocked = await db.query(`update team_payouts set amount = 9999 where id = '${id}' and status = 'pending' returning id;`)
    expect(blocked.rows.length).toBe(0)
    const row = await db.query<{ amount: string }>(`select amount from team_payouts where id = '${id}';`)
    expect(Number(row.rows[0]!.amount)).toBe(6000)
  })

  /**
   * Editing a submission moved from a function to a policy.
   *
   * update_work_submission() enforced "your studio, you or a manager, and only
   * while still submitted" and RAISED when you broke a rule. 0139 put the same
   * three conditions into the tws_update policy and the work router now
   * updates the row directly; 0143 then dropped the function, which had no
   * caller left.
   *
   * The guarantee is identical but the FAILURE is not: a policy filters rather
   * than raises, so a refused edit is now zero rows changed instead of an
   * exception. These assert row counts for that reason.
   *
   * They are also the only tests in this file that switch role. Everything
   * else here runs as superuser, which bypasses RLS entirely — fine when the
   * guard lives in a definer function, useless when it lives in a policy. The
   * grants mirror what deploy/db/00_bootstrap.sql gives `authenticated` in
   * production; without them "permission denied for table" would masquerade as
   * a policy rejection and the test would pass for the wrong reason.
   */
  it('a submitter can fix their own submission before review', async () => {
    await db.exec(`grant select, update on team_work_submissions to authenticated;`)
    await asUser(db, MEMBER)
    const sub = await db.query<{ id: string }>(
      `select submit_work(p_task_id => null, p_project_id => null, p_link => 'https://drive.example.com/wrong') as id;`,
    )
    const id = sub.rows[0]!.id

    await db.exec(`set role authenticated;`)
    const changed = await db.query(
      `update team_work_submissions
          set submission_link = 'https://drive.example.com/right', notes = 'fixed', location_note = 'HDD 2'
        where id = '${id}' returning id;`,
    )
    await db.exec(`reset role;`)
    expect(changed.rows.length).toBe(1)

    const row = await db.query<{ submission_link: string; notes: string; location_note: string }>(
      `select submission_link, notes, location_note from team_work_submissions where id = '${id}';`,
    )
    expect(row.rows[0]).toEqual({
      submission_link: 'https://drive.example.com/right',
      notes: 'fixed',
      location_note: 'HDD 2',
    })
  })

  it('nobody else can edit it, and nobody can once it has been reviewed', async () => {
    await db.exec(`grant select, update on team_work_submissions to authenticated;`)
    await asUser(db, MEMBER)
    const sub = await db.query<{ id: string }>(
      `select submit_work(p_task_id => null, p_project_id => null, p_link => 'https://drive.example.com/x') as id;`,
    )
    const id = sub.rows[0]!.id

    const OTHER = '88888888-8888-8888-8888-888888888882'
    await asUser(db, OWNER)
    await db.exec(`insert into auth.users (id, email) values ('${OTHER}', 'other8@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${OTHER}', '${companyId}', 'employee', 'Other Eight', 'other8@s.test');`,
    )

    // A colleague in the same studio: same company, not the submitter, not a
    // manager. The row is invisible to their UPDATE.
    await asUser(db, OTHER)
    await db.exec(`set role authenticated;`)
    const hijack = await db.query(
      `update team_work_submissions set submission_link = 'https://hijack.example.com'
        where id = '${id}' returning id;`,
    )
    await db.exec(`reset role;`)
    expect(hijack.rows.length).toBe(0)

    const stillMine = await db.query<{ submission_link: string }>(
      `select submission_link from team_work_submissions where id = '${id}';`,
    )
    expect(stillMine.rows[0]!.submission_link).toBe('https://drive.example.com/x')

    // And once it is approved it is frozen, for the submitter too — the policy
    // requires status = 'submitted'.
    await asUser(db, OWNER)
    await db.query(`select review_work(p_submission_id => '${id}', p_approve => true);`)
    await asUser(db, MEMBER)
    await db.exec(`set role authenticated;`)
    const afterReview = await db.query(
      `update team_work_submissions set submission_link = 'https://drive.example.com/after'
        where id = '${id}' returning id;`,
    )
    await db.exec(`reset role;`)
    expect(afterReview.rows.length).toBe(0)
  })
})

/**
 * GET /team/members backs every "who can this go to" picker in the CRM --
 * deal owner, distribution rota, workflow assign/notify steps, timeline
 * actor, booking slots. It filtered only deleted_at, so a member the studio
 * deactivated (status = 'inactive', not removed) still showed up as
 * assignable everywhere, even though they can no longer log in to act on it.
 */
describe('team members picker excludes deactivated staff, not just removed staff', () => {
  let db: PGlite
  const owner = '99999999-1111-1111-1111-999999999999'
  const active = '99999999-1111-1111-1111-999999999901'
  const inactive = '99999999-1111-1111-1111-999999999902'

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${owner}', 'owner@picker.test');`)
    await asUser(db, owner)
    await db.query(`select register_company_and_admin('Picker Studio','Owner');`)
    const companyId = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`
      insert into auth.users (id, email) values ('${active}', 'active@picker.test'), ('${inactive}', 'inactive@picker.test');
      insert into users (user_id, company_id, role, name, email, status) values
        ('${active}', '${companyId}', 'employee', 'Active Ana', 'active@picker.test', 'active'),
        ('${inactive}', '${companyId}', 'employee', 'Inactive Ivan', 'inactive@picker.test', 'inactive');
    `)
  })

  it('the picker query returns only active, non-deleted members', async () => {
    const rows = await db.query<{ name: string }>(
      `select name from users where deleted_at is null and status = 'active' order by name;`,
    )
    const names = rows.rows.map((r) => r.name)
    expect(names).toContain('Active Ana')
    expect(names).not.toContain('Inactive Ivan')
  })
})

/**
 * list_reminders() carried entity_type/entity_id since 0060 but never
 * resolved a display name for the link -- the UI had nothing to show but a
 * raw type and a uuid, so it never built a picker for it either (0077).
 */
describe('reminders resolve a display name for whatever they are linked to', () => {
  let db: PGlite
  let companyId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    companyId = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
  })

  it('resolves a lead, a project, a client, and an invoice by name, and leaves an unlinked reminder alone', async () => {
    await db.exec(`insert into crm_leads (company_id, phone, phone_norm, name) values ('${companyId}', '9000000010', '9000000010', 'Sharma Deal');`)
    const lead = (await db.query<{ id: string }>(`select id from crm_leads where phone = '9000000010';`)).rows[0]!.id

    await db.exec(`insert into clients (company_id, name) values ('${companyId}', 'Verma Client');`)
    const client = (await db.query<{ id: string }>(`select id from clients where name = 'Verma Client';`)).rows[0]!.id
    const project = (await db.query<{ id: string }>(`select create_project_with_details('${client}', 'Verma Wedding', 50000) as id;`)).rows[0]!.id
    const invoice = (
      await db.query<{ id: string }>(
        `select id from create_invoice('${client}', null, '27', current_date, null, 1000, 0, 1000, 180, 1180, '[]'::jsonb);`,
      )
    ).rows[0]!.id

    await db.exec(`
      insert into reminders (company_id, user_id, title, priority, entity_type, entity_id) values
        ('${companyId}', '${OWNER}', 'Follow up on deal', 'high', 'lead', '${lead}'),
        ('${companyId}', '${OWNER}', 'Check on project', 'medium', 'project', '${project}'),
        ('${companyId}', '${OWNER}', 'Call client', 'low', 'client', '${client}'),
        ('${companyId}', '${OWNER}', 'Chase invoice', 'urgent', 'invoice', '${invoice}'),
        ('${companyId}', '${OWNER}', 'Buy printer paper', 'low', null, null);
    `)

    const result = await db.query<{ v: { items: { title: string; entity_type: string | null; entity_name: string | null }[] } }>(
      `select list_reminders() as v;`,
    )
    const byTitle = new Map(result.rows[0]!.v.items.map((i) => [i.title, i]))
    expect(byTitle.get('Follow up on deal')?.entity_name).toBe('Sharma Deal')
    expect(byTitle.get('Check on project')?.entity_name).toBe('Verma Wedding')
    expect(byTitle.get('Call client')?.entity_name).toBe('Verma Client')
    expect(byTitle.get('Chase invoice')?.entity_name).toMatch(/^INV-/)
    expect(byTitle.get('Buy printer paper')?.entity_name).toBeNull()
  })
})

/**
 * Team payouts, shoot-derived tracker (0090): a settlement ledger kept
 * alongside the existing manual team_payouts table, not replacing it.
 */
describe('team payout settlements (0090)', () => {
  let db: PGlite
  let companyId: string
  const member = '55555555-5555-5555-5555-555555555555'
  let slotId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
    await asUser(db, OWNER)
    await db.query(`select register_company_and_admin('Studio','Owner');`)
    companyId = (await db.query<{ c: string }>(`select get_current_company_id() as c`)).rows[0]!.c
    await db.exec(`insert into auth.users (id, email) values ('${member}', 'm@s.test');`)
    await db.exec(
      `insert into users (user_id, company_id, role, name, email)
       values ('${member}', '${companyId}', 'employee', 'Shooter', 'm@s.test');`,
    )
    const slot = await db.query<{ book_team_slot: string }>(
      `select book_team_slot('${member}', null, 'Photographer',
        '2026-07-01T04:00:00Z', '2026-07-01T12:00:00Z', 8000);`,
    )
    slotId = slot.rows[0]!.book_team_slot
  })

  it('a slot carries its own cost status and notes, separate from the booking itself', async () => {
    await db.query(
      `select set_slot_cost(p_slot_id => '${slotId}', p_final_cost => 7500, p_cost_status => 'final', p_cost_notes => 'Agreed on the day');`,
    )
    const row = await db.query<{ final_cost: string; cost_status: string; cost_notes: string }>(
      `select final_cost, cost_status, cost_notes from team_assignment_slots where id = '${slotId}';`,
    )
    expect(Number(row.rows[0]!.final_cost)).toBe(7500)
    expect(row.rows[0]!.cost_status).toBe('final')
    expect(row.rows[0]!.cost_notes).toBe('Agreed on the day')

    await expect(
      db.query(`select set_slot_cost(p_slot_id => '${slotId}', p_cost_status => 'not_a_real_status');`),
    ).rejects.toThrow()
  })

  it('a partial payment, then the rest, settles the slot -- and a third payment is refused as over-collection', async () => {
    const first = await db.query<{ paid_total: string; amount_due: string }>(
      `select * from create_payout_settlement(p_slot_id => '${slotId}', p_amount_paid => 5000, p_payment_mode => 'upi');`,
    )
    expect(Number(first.rows[0]!.paid_total)).toBe(5000)
    expect(Number(first.rows[0]!.amount_due)).toBe(7500)

    const second = await db.query<{ paid_total: string }>(
      `select * from create_payout_settlement(p_slot_id => '${slotId}', p_amount_paid => 2500, p_payment_mode => 'cash');`,
    )
    expect(Number(second.rows[0]!.paid_total)).toBe(7500)

    await expect(
      db.query(`select * from create_payout_settlement(p_slot_id => '${slotId}', p_amount_paid => 1, p_payment_mode => 'cash');`),
    ).rejects.toThrow(/exceed amount due/i)
  })

  it('a reversal corrects a mistaken payment, but cannot push the paid total negative', async () => {
    const rev = await db.query<{ id: string; paid_total: string }>(
      `select * from create_payout_settlement(p_slot_id => '${slotId}', p_amount_paid => 2500, p_entry_type => 'reversal', p_notes => 'wrong amount');`,
    )
    expect(Number(rev.rows[0]!.paid_total)).toBe(5000)

    await expect(
      db.query(`select * from create_payout_settlement(p_slot_id => '${slotId}', p_amount_paid => 999999, p_entry_type => 'reversal');`),
    ).rejects.toThrow(/negative/i)
  })

  it('lists every entry for a slot plus its paid-total aggregate, and never touches the slot itself', async () => {
    const before = await db.query<{ final_cost: string }>(`select final_cost from team_assignment_slots where id = '${slotId}';`)

    const listed = await db.query<{
      v: { entries: { entry_type: string; amount_paid: string }[]; aggregates: { slot_id: string; paid_total: string; entries_count: number }[] }
    }>(`select list_payout_settlements(array['${slotId}']::uuid[]) as v;`)
    expect(listed.rows[0]!.v.entries).toHaveLength(3) // payment, payment, reversal
    const agg = listed.rows[0]!.v.aggregates.find((a) => a.slot_id === slotId)
    expect(Number(agg!.paid_total)).toBe(5000)
    expect(agg!.entries_count).toBe(3)

    // Settlement bookkeeping is deliberately inert against the slot's own cost fields.
    const after = await db.query<{ final_cost: string }>(`select final_cost from team_assignment_slots where id = '${slotId}';`)
    expect(after.rows[0]!.final_cost).toBe(before.rows[0]!.final_cost)
  })

  it('an adjustment is not blocked by the overpay guard, the way a plain payment is', async () => {
    const adj = await db.query<{ paid_total: string }>(
      `select * from create_payout_settlement(p_slot_id => '${slotId}', p_amount_paid => 4000, p_entry_type => 'adjustment', p_notes => 'correction');`,
    )
    // 5000 (running total) + 4000 adjustment = 9000, over the 7500 due -- allowed for an adjustment.
    expect(Number(adj.rows[0]!.paid_total)).toBe(9000)
  })
})
