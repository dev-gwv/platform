/**
 * Dry run on this machine: every migration into pglite (the same shims as
 * supabase/tests/apply-all.mjs), a studio made "on the new app" by one old
 * owner so the merge path runs too, then load.sql, import.sql and the report.
 *
 *   node tools/legacy-import/build-load.mjs <exportDir> <load.sql>
 *   bun tools/legacy-import/local-test.mjs <load.sql> [outDir]
 *
 * Nothing here touches a real database.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const here = dirname(fileURLToPath(import.meta.url))
const [loadSql, outDir = here] = process.argv.slice(2)
const migDir = join(here, '..', '..', 'supabase', 'migrations')

const db = new PGlite()
await db.exec(`create schema if not exists auth;`)
await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql') && !f.startsWith('0000_')).sort()) {
  await db.exec(readFileSync(join(migDir, f), 'utf8'))
}
console.log('migrations applied')

const t0 = Date.now()
await db.exec(readFileSync(loadSql, 'utf8'))
console.log(`load.sql in ${Math.round((Date.now() - t0) / 1000)}s`)
await db.exec(readFileSync(join(here, 'import.sql'), 'utf8'))

// One old owner already on the new app: the oldest studio with projects.
const [{ old_id, email }] = (await db.query(`
  select (c.r->>'id') as old_id, lower(btrim(a.r->>'email')) as email
    from legacy.src c join legacy.src a on a.tbl = 'admins' and a.r->>'company_id' = c.r->>'id'
   where c.tbl = 'companies' and a.r->>'firebase_uid' = c.r->>'owner_admin_uid'
     and exists (select 1 from legacy.src p where p.tbl = 'projects' and p.r->>'company_id' = c.r->>'id')
     and a.r->>'email' is not null
   order by c.r->>'created_at' limit 1`)).rows
await db.exec(`
  with u as (insert into auth.users (email, encrypted_password, email_verified) values ('${email}', 'argon-hash', true) returning id),
       c as (insert into companies (name, owner_user_id) select 'Signed up on the new app', id from u returning id, owner_user_id)
  insert into users (user_id, company_id, role, name, email) select owner_user_id, id, 'super_admin', 'Owner', '${email}' from c;`)
console.log(`merge case: old studio ${old_id} -> a studio already made here`)

const t1 = Date.now()
const done = (await db.query(`select legacy.import_all() as r`)).rows[0].r
console.log(`import_all in ${Math.round((Date.now() - t1) / 1000)}s:`, done)

const q = async (s) => (await db.query(s)).rows
const failed = await q(`select studio_name, detail->>'error' as error from legacy_imports where status = 'failed' order by 2`)
const checks = await q(`select studio_name, status, what, old_count, new_count from legacy.report where verdict = 'CHECK' order by 1, 3`)
const money = await q(`select studio_name, max(received_old) ro, max(received_new) rn, max(expenses_old) eo, max(expenses_new) en
                         from legacy.report group by 1 having max(received_old) <> max(received_new) or max(expenses_old) <> max(expenses_new)`)
const totals = await q(`select what, sum(old_count)::int as old, sum(new_count)::int as new from legacy.report where status = 'imported' group by 1 order by 1`)
const merged = await q(`select studio_name, what, old_count, new_count from legacy.report where status = 'merged' order by 2`)
const leaks = await q(`select (select count(*)::int from notifications) as notifications, (select count(*)::int from message_outbox) as outbox`)
const logins = await q(`select count(*)::int as n from legacy_logins`)
const orphans = await q(`
  select 'projects without client' k, count(*)::int n from projects p where not exists (select 1 from clients c where c.id = p.client_id)
  union all select 'shoots in another studio than project', count(*)::int from shoots s join projects p on p.id = s.project_id where s.company_id <> p.company_id
  union all select 'users without auth row', count(*)::int from users u where not exists (select 1 from auth.users a where a.id = u.user_id)
  union all select 'companies without owner', count(*)::int from companies c join legacy_imports li on li.company_id = c.id and li.status = 'imported' where c.owner_user_id is null`)

const result = { done, totals, merged, failed, checks, money, leaks, logins, orphans }
writeFileSync(join(outDir, 'local-test-result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ done, totals, failed: failed.length, checks: checks.length, money: money.length, leaks, logins, orphans }, null, 2))
if (failed.length) console.log('first failures:', failed.slice(0, 15))
if (checks.length) console.log('first checks:', checks.slice(0, 15))
process.exit(0)
