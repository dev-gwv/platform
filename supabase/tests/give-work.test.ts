import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * 0229: who gave the work, the hand-in alert to them, deliverable alerts
 * that open the item, and email copies of those alerts.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'b2290000-0000-4000-8000-000000000001'
const RAVI = 'b2290000-0000-4000-8000-000000000002'
const PRIYA = 'b2290000-0000-4000-8000-000000000003'
const STUDIO = 'b2290000-0000-4000-8000-0000000000aa'
const CLIENT = 'b2290000-0000-4000-8000-0000000000c1'
const PROJECT = 'b2290000-0000-4000-8000-0000000000d1'
const TEASER = 'b2290000-0000-4000-8000-0000000000f1'
const ALBUM = 'b2290000-0000-4000-8000-0000000000f2'

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

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'asha@ashastudio.in'), ('${RAVI}', 'ravi@gmail.com'), ('${PRIYA}', 'priya@gmail.com');
    insert into companies (id, name, owner_user_id) values ('${STUDIO}', 'Asha Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Asha', 'asha@ashastudio.in', 'active'),
      ('${RAVI}', '${STUDIO}', 'employee', 'Ravi Kumar', 'ravi@gmail.com', 'active'),
      ('${PRIYA}', '${STUDIO}', 'admin', 'Priya', 'priya@gmail.com', 'active');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${STUDIO}', 'Mehta');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${PROJECT}', '${STUDIO}', '${CLIENT}', 'Mehta Wedding', 200000, '${OWNER}');
    insert into deliverables (id, company_id, project_id, title) values
      ('${TEASER}', '${STUDIO}', '${PROJECT}', 'Wedding Teaser'),
      ('${ALBUM}', '${STUDIO}', '${PROJECT}', 'Photo Album');
    grant usage on schema auth to authenticated;
  `)
})

describe('0229 give work', () => {
  it('records who gave the work, and the alert opens the item', async () => {
    await as(PRIYA, `update deliverables set assignee_id = '${RAVI}' where id = '${TEASER}'`)
    const [d] = await q<{ assigned_by: string; status: string }>(`select assigned_by, status from deliverables where id = '${TEASER}'`)
    expect(d).toEqual({ assigned_by: PRIYA, status: 'in_progress' })
    const [n] = await q<{ deep_link: string }>(
      `select deep_link from notifications where recipient_uid = '${RAVI}' and type = 'deliverable_assigned'`,
    )
    expect(n?.deep_link).toBe(`/my-work?d=${TEASER}`)

    // Another person giving it again records them; clearing the editor clears it.
    await as(OWNER, `update deliverables set assignee_id = '${PRIYA}' where id = '${TEASER}'`)
    expect((await q<{ assigned_by: string }>(`select assigned_by from deliverables where id = '${TEASER}'`))[0]?.assigned_by).toBe(OWNER)
    await as(OWNER, `update deliverables set assignee_id = null where id = '${TEASER}'`)
    expect((await q<{ assigned_by: string | null }>(`select assigned_by from deliverables where id = '${TEASER}'`))[0]?.assigned_by).toBeNull()
    await as(PRIYA, `update deliverables set assignee_id = '${RAVI}' where id = '${TEASER}'`)
  })

  it('a hand-in tells whoever gave the work, not the editor', async () => {
    await q(`insert into team_work_submissions (company_id, project_id, deliverable_id, submitted_by, submission_link)
             values ('${STUDIO}', '${PROJECT}', '${TEASER}', '${RAVI}', 'https://drive.google.com/x')`)
    const rows = await q<{ recipient_uid: string; title: string; deep_link: string }>(
      `select recipient_uid, title, deep_link from notifications where type = 'deliverable_submitted' order by recipient_uid`,
    )
    expect(rows).toEqual([
      { recipient_uid: PRIYA, title: 'Ravi Kumar handed in Wedding Teaser', deep_link: `/projects/${PROJECT}?tab=completed_work` },
    ])
  })

  it('with nobody recorded, the owner and admins hear of it', async () => {
    // Given without a signed-in person (an import): nobody recorded.
    await q(`update deliverables set assignee_id = '${RAVI}' where id = '${ALBUM}'`)
    expect((await q<{ assigned_by: string | null }>(`select assigned_by from deliverables where id = '${ALBUM}'`))[0]?.assigned_by).toBeNull()
    await q(`insert into team_work_submissions (company_id, project_id, deliverable_id, submitted_by, submission_link)
             values ('${STUDIO}', '${PROJECT}', '${ALBUM}', '${RAVI}', 'https://drive.google.com/y')`)
    const to = await q<{ recipient_uid: string }>(
      `select recipient_uid from notifications where type = 'deliverable_submitted' and entity_id = '${ALBUM}' order by recipient_uid`,
    )
    expect(to.map((r) => r.recipient_uid).sort()).toEqual([OWNER, PRIYA].sort())
  })

  it('emails the deliverable alerts once they sit unread', async () => {
    await q(`update notifications set created_at = now() - interval '20 minutes'`)
    const due = await q<{ type: string; recipient_uid: string; deep_link: string }>(`select type, recipient_uid, deep_link from alert_email_due(500)`)
    expect(due.some((r) => r.type === 'deliverable_assigned' && r.recipient_uid === RAVI && r.deep_link === `/my-work?d=${TEASER}`)).toBe(true)
    expect(due.some((r) => r.type === 'deliverable_submitted' && r.recipient_uid === PRIYA)).toBe(true)
  })
})
