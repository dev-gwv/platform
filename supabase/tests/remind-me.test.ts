import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { reminderEntityType } from '../../packages/contracts/src/reminders'

/**
 * "Remind me" (0181): a reminder can be about a deliverable, the board names
 * it, and when one comes due the alert carries the note written with it and
 * a link back to the thing it is about -- never into another studio.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a1000000-0000-4000-8000-000000000001'
const PRIYA = 'a1000000-0000-4000-8000-000000000002'
const STRANGER = 'a1000000-0000-4000-8000-000000000003'
const COMPANY = 'a1000000-0000-4000-8000-0000000000aa'
const OTHER_CO = 'a1000000-0000-4000-8000-0000000000bb'
const CLIENT = 'a1000000-0000-4000-8000-0000000000c1'
const OTHER_CLIENT = 'a1000000-0000-4000-8000-0000000000c2'
const PROJECT = 'a1000000-0000-4000-8000-0000000000d1'
const OTHER_PROJECT = 'a1000000-0000-4000-8000-0000000000d2'
const SHOOT = 'a1000000-0000-4000-8000-0000000000e1'
const ALBUM = 'a1000000-0000-4000-8000-0000000000f1'
const TASK_MINE = 'a1000000-0000-4000-8000-000000000101'
const TASK_PRIYAS = 'a1000000-0000-4000-8000-000000000102'
const TASK_LOOSE = 'a1000000-0000-4000-8000-000000000103'

/** One reminder id per case, so each alert can be looked up by its dedupe key. */
const R = {
  project: 'a1000000-0000-4000-8000-000000000201',
  shoot: 'a1000000-0000-4000-8000-000000000202',
  deliverable: 'a1000000-0000-4000-8000-000000000203',
  taskMine: 'a1000000-0000-4000-8000-000000000204',
  taskPriyas: 'a1000000-0000-4000-8000-000000000205',
  taskLoose: 'a1000000-0000-4000-8000-000000000206',
  note: 'a1000000-0000-4000-8000-000000000207',
  foreign: 'a1000000-0000-4000-8000-000000000208',
  later: 'a1000000-0000-4000-8000-000000000209',
} as const

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const fails = async (sql: string) => {
  try {
    await db.query(sql)
  } catch (e) {
    return (e as Error).message
  }
  return null
}

/** Insert a reminder for the owner, due an hour ago unless said otherwise. */
const remind = (
  id: string,
  title: string,
  entityType: string | null,
  entityId: string | null,
  extra: { priority?: string; description?: string | null; due?: string } = {},
) =>
  db.exec(`
    insert into reminders (id, company_id, user_id, created_by, title, description, priority, status, entity_type, entity_id, due_at)
    values ('${id}', '${COMPANY}', '${OWNER}', '${OWNER}', '${title}',
            ${extra.description === undefined || extra.description === null ? 'null' : `'${extra.description}'`},
            '${extra.priority ?? 'medium'}', 'active',
            ${entityType ? `'${entityType}'` : 'null'}, ${entityId ? `'${entityId}'` : 'null'},
            ${extra.due ?? `now() - interval '1 hour'`});`)

const alertFor = async (reminderId: string) =>
  (
    await q<{ title: string; body: string | null; severity: string; deep_link: string | null; entity_type: string | null }>(
      `select title, body, severity, deep_link, entity_type from notifications where dedupe_key = 'reminder:${reminderId}';`,
    )
  )[0]

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${PRIYA}', 'p@s.test'), ('${STRANGER}', 'x@s.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}'), ('${OTHER_CO}', 'Other', '${STRANGER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test'),
      ('${PRIYA}', '${COMPANY}', 'employee', 'Priya', 'p@s.test'),
      ('${STRANGER}', '${OTHER_CO}', 'super_admin', 'Stranger', 'x@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'Sharma'), ('${OTHER_CLIENT}', '${OTHER_CO}', 'Secret');
    insert into projects (id, company_id, client_id, name) values
      ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Sharma Wedding'),
      ('${OTHER_PROJECT}', '${OTHER_CO}', '${OTHER_CLIENT}', 'Someone Else''s Wedding');
    insert into shoots (id, company_id, project_id, name) values ('${SHOOT}', '${COMPANY}', '${PROJECT}', 'Haldi');
    insert into deliverables (id, company_id, project_id, title, assignee_id)
      values ('${ALBUM}', '${COMPANY}', '${PROJECT}', 'Photo Album', '${PRIYA}');
    insert into tasks (id, company_id, project_id, title) values
      ('${TASK_MINE}', '${COMPANY}', '${PROJECT}', 'Call the florist'),
      ('${TASK_PRIYAS}', '${COMPANY}', '${PROJECT}', 'Export the teaser'),
      ('${TASK_LOOSE}', '${COMPANY}', null, 'Renew the domain');
    insert into task_assignees (task_id, user_id, company_id) values
      ('${TASK_MINE}', '${OWNER}', '${COMPANY}'),
      ('${TASK_PRIYAS}', '${PRIYA}', '${COMPANY}');
  `)

  await remind(R.project, 'Follow up: Sharma Wedding', 'project', PROJECT, { priority: 'urgent' })
  await remind(R.shoot, 'Follow up: Haldi', 'shoot', SHOOT, { priority: 'high' })
  await remind(R.deliverable, 'Follow up: Photo Album', 'deliverable', ALBUM, { description: 'Ask about the cover photo' })
  await remind(R.taskMine, 'Follow up: Call the florist', 'task', TASK_MINE)
  await remind(R.taskPriyas, 'Follow up: Export the teaser', 'task', TASK_PRIYAS)
  await remind(R.taskLoose, 'Follow up: Renew the domain', 'task', TASK_LOOSE)
  await remind(R.note, 'Call the printer', null, null, { description: '   ' })
  await remind(R.foreign, 'Follow up: a stray id', 'project', OTHER_PROJECT)
  await remind(R.later, 'Follow up: next week', 'project', PROJECT, { due: `now() + interval '7 days'` })
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('a reminder about a deliverable', () => {
  it('is accepted by the constraint', async () => {
    const rows = await q<{ n: string }>(`select count(*)::text as n from reminders where entity_type = 'deliverable';`)
    expect(rows[0]!.n).toBe('1')
  })

  it('is one of exactly the kinds the contract offers', async () => {
    // The drift 0181 fixed: the API's validation and the constraint each kept
    // their own list, so a kind could pass one and fail the other.
    const [row] = await q<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'reminders_entity_type_check';`,
    )
    const allowed = [...row!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(allowed).toEqual([...reminderEntityType.options].sort())
  })

  it('still refuses a kind nothing handles', async () => {
    const err = await fails(`
      insert into reminders (company_id, user_id, title, priority, status, entity_type)
      values ('${COMPANY}', '${OWNER}', 'Nope', 'medium', 'active', 'banana');`)
    expect(err).toMatch(/reminders_entity_type_check/)
  })

  it('is named on the board', async () => {
    const s = await q<{ s: { items: { id: string; entity_name: string | null }[] } }>(
      `select list_reminders(p_entity_type => 'deliverable') as s;`,
    )
    expect(s[0]!.s.items.map((i) => i.entity_name)).toEqual(['Photo Album'])
  })

  it('the board never reads back a name from another studio', async () => {
    const s = await q<{ s: { items: { id: string; entity_name: string | null }[] } }>(`select list_reminders() as s;`)
    const byId = new Map(s[0]!.s.items.map((i) => [i.id, i.entity_name]))
    expect(byId.get(R.project)).toBe('Sharma Wedding')
    expect(byId.get(R.foreign)).toBeNull()
  })

  it('leaves list_reminders with exactly one overload', async () => {
    const r = await q<{ n: string }>(
      `select count(*)::text as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'list_reminders';`,
    )
    expect(r[0]!.n).toBe('1')
  })
})

describe('run_reminder_cron', () => {
  it('writes nothing on a dry run', async () => {
    const res = await q<{ s: { reminders_due: number; notifications_created: number } }>(
      `select run_reminder_cron(p_dry_run => true) as s;`,
    )
    expect(res[0]!.s.notifications_created).toBe(0)
    expect(await alertFor(R.project)).toBeUndefined()
  })

  it('raises one alert per due reminder, and none for one not yet due', async () => {
    const res = await q<{ s: { reminders_due: number; notifications_created: number } }>(
      `select run_reminder_cron(p_dry_run => false) as s;`,
    )
    expect(res[0]!.s.notifications_created).toBe(8)
    expect(await alertFor(R.later)).toBeUndefined()
  })

  it('carries the note as the body, and no body when there was none', async () => {
    expect((await alertFor(R.deliverable))!.body).toBe('Ask about the cover photo')
    expect((await alertFor(R.note))!.body).toBeNull()
    expect((await alertFor(R.project))!.body).toBeNull()
  })

  it('links back to the thing the reminder is about', async () => {
    expect((await alertFor(R.project))!.deep_link).toBe(`/projects/${PROJECT}`)
    expect((await alertFor(R.shoot))!.deep_link).toBe(`/shoots/${SHOOT}`)
    expect((await alertFor(R.deliverable))!.deep_link).toBe(`/projects/${PROJECT}?tab=deliverables&d=${ALBUM}`)
    expect((await alertFor(R.deliverable))!.entity_type).toBe('deliverable')
  })

  it('sends a task to the list it is worked from', async () => {
    // On it yourself: My tasks. Set from the project for someone else's task:
    // that project's Tasks tab. Neither: the task board.
    expect((await alertFor(R.taskMine))!.deep_link).toBe('/tasks/my')
    expect((await alertFor(R.taskPriyas))!.deep_link).toBe(`/projects/${PROJECT}?tab=tasks`)
    expect((await alertFor(R.taskLoose))!.deep_link).toBe('/tasks')
  })

  it('falls back to the reminders board, never into another studio', async () => {
    expect((await alertFor(R.note))!.deep_link).toBe('/reminders')
    expect((await alertFor(R.foreign))!.deep_link).toBe('/reminders')
  })

  it('takes its severity from the priority', async () => {
    expect((await alertFor(R.project))!.severity).toBe('critical')
    expect((await alertFor(R.shoot))!.severity).toBe('warning')
    expect((await alertFor(R.taskMine))!.severity).toBe('info')
  })

  it('does not raise the same reminder twice', async () => {
    const res = await q<{ s: { reminders_due: number; notifications_created: number } }>(
      `select run_reminder_cron(p_dry_run => false) as s;`,
    )
    expect(res[0]!.s.reminders_due).toBe(8)
    expect(res[0]!.s.notifications_created).toBe(0)
  })
})
