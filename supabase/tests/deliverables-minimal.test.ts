import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Deliverables (0161, 0162): an editor, a "with client" stage, a delivery
 * link -- the studio boundary checked on every write, dropped extras no
 * longer billed, and the editor told when they are on one and when it is due.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'b0000000-0000-4000-8000-000000000001'
const EDITOR = 'b0000000-0000-4000-8000-000000000002'
const OTHER_OWNER = 'b0000000-0000-4000-8000-000000000003'
const COMPANY = 'b0000000-0000-4000-8000-0000000000aa'
const OTHER = 'b0000000-0000-4000-8000-0000000000ab'
const CLIENT = 'b0000000-0000-4000-8000-0000000000c1'
const OTHER_CLIENT = 'b0000000-0000-4000-8000-0000000000c2'
const PROJECT = 'b0000000-0000-4000-8000-0000000000b1'
const PROJECT_2 = 'b0000000-0000-4000-8000-0000000000b2'
const OTHER_PROJECT = 'b0000000-0000-4000-8000-0000000000b3'
const SHOOT = 'b0000000-0000-4000-8000-0000000000d1'
const SHOOT_EARLY = 'b0000000-0000-4000-8000-0000000000d2'
const SHOOT_OF_P2 = 'b0000000-0000-4000-8000-0000000000d3'
const TEMPLATE = 'b0000000-0000-4000-8000-0000000000f1'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

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
    insert into auth.users (id, email) values
      ('${OWNER}', 'o@s.test'), ('${EDITOR}', 'e@s.test'), ('${OTHER_OWNER}', 'x@t.test');
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER}', 'Other studio', '${OTHER_OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${EDITOR}', '${COMPANY}', 'employee', 'Priya', 'e@s.test'),
      ('${OTHER_OWNER}', '${OTHER}', 'super_admin', 'Other', 'x@t.test');
    insert into clients (id, company_id, name) values
      ('${CLIENT}', '${COMPANY}', 'Client'), ('${OTHER_CLIENT}', '${OTHER}', 'Their client');
    insert into projects (id, company_id, client_id, name, package_cost) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Wedding', 100000),
      ('${PROJECT_2}', '${COMPANY}', '${CLIENT}', 'Reception', 0),
      ('${OTHER_PROJECT}', '${OTHER}', '${OTHER_CLIENT}', 'Their wedding', 50000);
    insert into shoots (id, company_id, project_id, name, shoot_date) values
      ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Wedding day', '2026-10-05'),
      ('${SHOOT_EARLY}', '${COMPANY}', '${PROJECT}', 'Haldi', '2026-10-03'),
      ('${SHOOT_OF_P2}', '${COMPANY}', '${PROJECT_2}', 'Reception', '2026-10-06');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

beforeEach(async () => {
  await db.exec(`delete from deliverables;`)
})

const add = async (cols: string, vals: string) =>
  (
    await one<{ id: string }>(`
      insert into deliverables (company_id, project_id, title ${cols ? ', ' + cols : ''})
      values ('${COMPANY}', '${PROJECT}', 'Album' ${vals ? ', ' + vals : ''}) returning id`)
  ).id

const row = (id: string) =>
  one<{ status: string; delivered_at: string | null; show_on_quotation: boolean; shoot_id: string | null }>(
    `select status, delivered_at, show_on_quotation, shoot_id from deliverables where id = '${id}'`,
  )

describe('stage and delivery', () => {
  it('accepts "with client" (review) and stamps delivered_at only while delivered', async () => {
    const id = await add('assignee_id, shoot_id', `'${EDITOR}', '${SHOOT}'`)
    await db.exec(`update deliverables set status = 'review', delivery_link = 'https://x.test/a' where id = '${id}'`)
    expect(await row(id)).toMatchObject({ status: 'review', delivered_at: null })
    await db.exec(`update deliverables set status = 'completed' where id = '${id}'`)
    const delivered = (await row(id)).delivered_at
    expect(delivered).not.toBeNull()
    // Editing the title later keeps the day it was delivered.
    await db.exec(`update deliverables set title = 'Album v2' where id = '${id}'`)
    expect((await row(id)).delivered_at).toEqual(delivered)
    await db.exec(`update deliverables set status = 'in_progress' where id = '${id}'`)
    expect((await row(id)).delivered_at).toBeNull()
  })

  it('rejects a status outside the five', async () => {
    await expect(add('status', `'sent'`)).rejects.toThrow()
  })

  it('never shows team work on a quotation', async () => {
    const id = await add('visibility_scope, show_on_quotation', `'internal', true`)
    expect((await row(id)).show_on_quotation).toBe(false)
  })
})

describe('the studio boundary', () => {
  it('refuses another studio’s project, and leaves its total alone', async () => {
    await expect(
      db.query(`insert into deliverables (company_id, project_id, title, is_additional_charge, additional_charge_amount)
                values ('${COMPANY}', '${OTHER_PROJECT}', 'x', true, 99999)`),
    ).rejects.toThrow(/not in this studio/)
    const { total_cost } = await one<{ total_cost: string }>(`select total_cost from projects where id = '${OTHER_PROJECT}'`)
    expect(Number(total_cost)).toBe(50000)
  })

  it('refuses a shoot from another project, and an editor from another studio', async () => {
    await expect(add('shoot_id', `'${SHOOT_OF_P2}'`)).rejects.toThrow(/not part of this project/)
    await expect(add('assignee_id', `'${OTHER_OWNER}'`)).rejects.toThrow(/not on this studio/)
  })

  it('create_task_with_assignees refuses another studio’s project', async () => {
    await expect(
      db.query(`select create_task_with_assignees('${OTHER_PROJECT}', null, 'Sneak')`),
    ).rejects.toThrow(/not allowed/)
    const id = await add('', '')
    const { t } = await one<{ t: string }>(`select create_task_with_assignees('${PROJECT}', '${id}', 'Edit album') as t`)
    expect(t).toBeTruthy()
  })
})

describe('backfill of the shoot link', () => {
  it('takes the earliest linked shoot', async () => {
    const id = await add('', '')
    await db.exec(`
      insert into deliverable_shoot_links (company_id, deliverable_id, shoot_id) values
        ('${COMPANY}', '${id}', '${SHOOT}'), ('${COMPANY}', '${id}', '${SHOOT_EARLY}');
    `)
    // The migration's backfill statement, re-run against this row.
    const sql = readFileSync(join(migDir, '0161_deliverables_minimal.sql'), 'utf8')
    const backfill = sql.slice(sql.indexOf('update deliverables d'), sql.indexOf('update deliverables set show_on_quotation'))
    await db.exec(backfill)
    expect((await row(id)).shoot_id).toBe(SHOOT_EARLY)
  })
})

describe('create_project_from_template', () => {
  it('creates the project, its deliverables, shoots and tasks', async () => {
    await db.exec(`
      insert into project_templates (id, company_id, name, deliverables_json, shoots_json, tasks_json) values
        ('${TEMPLATE}', '${COMPANY}', 'Wedding',
         '[{"name":"Album","description":"40 sheets","quantity":2},{"name":"Film","quantity":1}]',
         '[{"name":"Haldi","kind":"ceremony"}]',
         '[{"title":"Call client","priority":"high"},{"title":"Odd","priority":"nope"}]');
    `)
    const { id } = await one<{ id: string }>(
      `select create_project_from_template('${TEMPLATE}', 'Sharma wedding', '${CLIENT}', '2026-11-01') as id`,
    )
    const titles = (await q<{ title: string }>(`select title from deliverables where project_id = '${id}' order by title`)).map((r) => r.title)
    expect(titles).toEqual(['Album ×2', 'Film'])
    expect(await one(`select name, shoot_date::text as d from shoots where project_id = '${id}'`)).toEqual({ name: 'Haldi', d: '2026-11-01' })
    const tasks = await q<{ title: string; priority: string; status: string }>(
      `select title, priority::text, status::text from tasks where project_id = '${id}' order by title`,
    )
    expect(tasks).toEqual([
      { title: 'Call client', priority: 'high', status: 'to_do' },
      { title: 'Odd', priority: 'medium', status: 'to_do' },
    ])
  })

  it('needs a client from this studio', async () => {
    await expect(db.query(`select create_project_from_template('${TEMPLATE}', 'No client')`)).rejects.toThrow(/Pick a client/)
    await expect(
      db.query(`select create_project_from_template('${TEMPLATE}', 'Theirs', '${OTHER_CLIENT}')`),
    ).rejects.toThrow(/Pick a client/)
  })
})

describe('billing and quotations (0162)', () => {
  it('stops charging an extra once the client drops it', async () => {
    const id = await add('is_additional_charge, additional_charge_amount', 'true, 15000')
    const total = async () =>
      Number((await one<{ t: string }>(`select total_cost as t from projects where id = '${PROJECT}'`)).t)
    expect(await total()).toBe(115000)
    await db.exec(`update deliverables set status = 'cancelled' where id = '${id}'`)
    expect(await total()).toBe(100000)
    await db.exec(`update deliverables set status = 'pending' where id = '${id}'`)
    expect(await total()).toBe(115000)
  })

  it('leaves dropped items and team work off an issued quotation', async () => {
    await add('is_additional_charge, additional_charge_amount', 'true, 5000')
    await add('status', `'cancelled'`)
    await add('visibility_scope', `'internal'`)
    await db.query(`select * from issue_project_quotation('${PROJECT}')`)
    const { snapshot } = await one<{ snapshot: { items: { title: string }[] } }>(
      `select snapshot from project_quotations where project_id = '${PROJECT}' order by created_at desc limit 1`,
    )
    expect(snapshot.items.map((i) => i.title)).toEqual(['Album'])
  })

  it('the public reader never returns the editor’s brief, team work or dropped rows', async () => {
    const sql = readFileSync(join(migDir, '0162_deliverables_billing_and_reminders.sql'), 'utf8')
    const reader = sql.slice(sql.indexOf('create or replace function get_quotation_for_token'))
    expect(reader).not.toContain("'description', d.description")
    expect(reader.match(/d\.visibility_scope = 'client' and d\.status <> 'cancelled'/g)).toHaveLength(2)
  })
})

describe('telling the editor (0162)', () => {
  beforeEach(async () => {
    await db.exec(`delete from notifications;`)
  })
  const notes = () =>
    q<{ type: string; recipient_uid: string; title: string }>(
      `select type, recipient_uid, title from notifications order by created_at`,
    )

  it('notifies someone put on a deliverable, once', async () => {
    const id = await add('assignee_id', `'${EDITOR}'`)
    await db.exec(`update deliverables set title = 'Album v2' where id = '${id}'`)
    expect(await notes()).toEqual([{ type: 'deliverable_assigned', recipient_uid: EDITOR, title: 'You are on Album' }])
  })

  it('does not notify you for putting yourself on one', async () => {
    await add('assignee_id', `'${OWNER}'`)
    expect(await notes()).toEqual([])
  })

  it('reminds the editor the day before, on the day and once late -- not earlier, not twice', async () => {
    const day = (n: number) => `current_date + ${n}`
    await add('assignee_id, estimated_date', `'${EDITOR}', ${day(1)}`)
    await add('assignee_id, estimated_date', `'${EDITOR}', ${day(0)}`)
    await add('assignee_id, estimated_date', `'${EDITOR}', ${day(-1)}`)
    await add('assignee_id, estimated_date', `'${EDITOR}', ${day(5)}`)
    await add('assignee_id, estimated_date, status', `'${EDITOR}', ${day(0)}, 'completed'`)
    await db.exec(`delete from notifications;`)
    const { s } = await one<{ s: { deliverables_due: number } }>(`select run_deliverable_due_cron() as s`)
    expect(s.deliverables_due).toBe(3)
    await db.query(`select run_deliverable_due_cron()`)
    const titles = (await notes()).map((n) => n.title).sort()
    expect(titles).toEqual(['Album is due today', 'Album is due tomorrow', 'Album is late'])
  })
})
