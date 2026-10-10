import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The help assistant's tables (0247, 0248).
 *
 * What is worth testing here is not that the columns exist but that the three
 * things we decided hold: the log is closed to studios, the day's count is the
 * studio's own and only counts what cost something, and the settings cannot be
 * saved in a shape the API would then have to defend against.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'c1000000-0000-4000-8000-000000000001'
const OTHER = 'c1000000-0000-4000-8000-000000000002'
const COMPANY = 'c1000000-0000-4000-8000-0000000000aa'
const COMPANY_B = 'c1000000-0000-4000-8000-0000000000bb'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const fails = async (sql: string) => {
  await expect(db.exec(sql)).rejects.toThrow()
}

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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${OTHER}', 'x@o.test');
    insert into companies (id, name, owner_user_id) values
      ('${COMPANY}', 'Asha Studio', '${OWNER}'), ('${COMPANY_B}', 'Other Studio', '${OTHER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'o@s.test', 'active'),
      ('${OTHER}', '${COMPANY_B}', 'super_admin', 'Kiran', 'x@o.test', 'active');
    -- The live database grants these to every signed-in user (0000, not run here).
    grant usage on schema auth to authenticated;
  `)
})

beforeEach(async () => {
  await db.exec(`delete from assistant_log;`)
  await db.exec(`update platform_settings set assistant_enabled = false, assistant_prompt = null,
                   assistant_model = null, assistant_base_url = null, support_call_url = null,
                   assistant_daily_limit = null;`)
})

describe('assistant settings on platform_settings', () => {
  it('is off until somebody turns it on', async () => {
    // A half-configured assistant answering confidently is worse than none.
    const r = await q<{ on: boolean }>(`select assistant_enabled as on from platform_settings`)
    expect(r[0]!.on).toBe(false)
  })

  it('takes a provider, a model and a prompt', async () => {
    await db.exec(`update platform_settings set
      assistant_enabled = true,
      assistant_base_url = 'https://api.groq.com/openai/v1',
      assistant_model = 'llama-3.3-70b-versatile',
      support_call_url = 'https://cal.example.test/sa',
      assistant_daily_limit = 50,
      assistant_prompt = 'Be brief.'`)
    const r = await q<{ m: string }>(`select assistant_model as m from platform_settings`)
    expect(r[0]!.m).toBe('llama-3.3-70b-versatile')
  })

  it('refuses a shape the API would have to defend against', async () => {
    // An http:// base URL would send the key over the wire in the clear.
    await fails(`update platform_settings set assistant_base_url = 'http://api.groq.com/openai/v1'`)
    await fails(`update platform_settings set assistant_base_url = 'not a url'`)
    await fails(`update platform_settings set support_call_url = 'http://cal.example.test'`)
    // A model name with a space in it is a typo, and the provider answers 404.
    await fails(`update platform_settings set assistant_model = 'llama 3.3 70b'`)
    await fails(`update platform_settings set assistant_daily_limit = 0`)
    await fails(`update platform_settings set assistant_daily_limit = 5000`)
    await fails(`update platform_settings set assistant_prompt = repeat('x', 8001)`)
  })

  it('lets a studio read the settings but never write them', async () => {
    // Every signed-in user reads this row (it carries the Diamond group link),
    // and the assistant's switch rides along. Writing stays with the API.
    await db.exec(`set role authenticated`)
    expect((await q<{ n: number }>(`select count(*)::int as n from platform_settings`))[0]!.n).toBe(1)
    await fails(`update platform_settings set assistant_enabled = true`)
    await db.exec(`reset role`)
  })
})

describe('assistant_log', () => {
  it('records a question and what came back', async () => {
    await db.exec(`insert into assistant_log (company_id, user_id, question, answer, status, model, prompt_tokens, completion_tokens)
                   values ('${COMPANY}', '${OWNER}', 'How do I add my team?', 'Open Team then People.', 'answered', 'llama-3.3-70b-versatile', 1300, 40)`)
    const r = await q<{ status: string; prompt_tokens: number }>(`select status, prompt_tokens from assistant_log`)
    expect(r[0]).toMatchObject({ status: 'answered', prompt_tokens: 1300 })
  })

  it('knows the four things that can happen and nothing else', async () => {
    for (const s of ['answered', 'escalated', 'skipped', 'failed']) {
      await db.exec(`insert into assistant_log (company_id, question, status) values ('${COMPANY}', 'q', '${s}')`)
    }
    await fails(`insert into assistant_log (company_id, question, status) values ('${COMPANY}', 'q', 'pending')`)
  })

  it('is closed to studios: only the service reads or writes it', async () => {
    // It holds every studio's questions. One studio reading another's is the
    // whole reason this is service-only.
    await db.exec(`set role authenticated`)
    await fails(`select * from assistant_log`)
    await fails(`insert into assistant_log (company_id, question, status) values ('${COMPANY}', 'q', 'answered')`)
    await db.exec(`reset role`)
  })

  it('keeps the log when a studio is deleted', async () => {
    // The row is ours, for working out whether the assistant earns its keep;
    // a cascade would quietly rewrite history every time a studio left.
    await db.exec(`insert into assistant_log (company_id, question, status) values ('${COMPANY_B}', 'q', 'answered')`)
    await db.exec(`delete from users where company_id = '${COMPANY_B}'`)
    await db.exec(`delete from companies where id = '${COMPANY_B}'`)
    const r = await q<{ n: number; c: string | null }>(`select count(*)::int as n, max(company_id::text) as c from assistant_log`)
    expect(r[0]!.n).toBe(1)
    expect(r[0]!.c).toBeNull()
    // Put it back for the rest of the file.
    await db.exec(`insert into companies (id, name, owner_user_id) values ('${COMPANY_B}', 'Other Studio', '${OTHER}');
                   insert into users (user_id, company_id, role, name, email, status)
                   values ('${OTHER}', '${COMPANY_B}', 'super_admin', 'Kiran', 'x@o.test', 'active');`)
  })
})

describe('assistant_asked_today', () => {
  const log = (company: string, status: string, ago = '0 hours') =>
    db.exec(`insert into assistant_log (company_id, question, status, created_at)
             values ('${company}', 'q', '${status}', now() - interval '${ago}')`)

  it('counts only what cost something', async () => {
    // A question skipped for want of a key, or one the provider refused, must
    // not burn a studio's allowance -- neither was the studio's fault.
    await log(COMPANY, 'answered')
    await log(COMPANY, 'escalated')
    await log(COMPANY, 'skipped')
    await log(COMPANY, 'failed')
    const r = await q<{ n: number }>(`select assistant_asked_today('${COMPANY}') as n`)
    expect(r[0]!.n).toBe(2)
  })

  it('is one studio\'s own count', async () => {
    await log(COMPANY, 'answered')
    await log(COMPANY_B, 'answered')
    await log(COMPANY_B, 'answered')
    expect((await q<{ n: number }>(`select assistant_asked_today('${COMPANY}') as n`))[0]!.n).toBe(1)
    expect((await q<{ n: number }>(`select assistant_asked_today('${COMPANY_B}') as n`))[0]!.n).toBe(2)
  })

  it('forgets yesterday', async () => {
    await log(COMPANY, 'answered', '30 hours')
    await log(COMPANY, 'answered')
    expect((await q<{ n: number }>(`select assistant_asked_today('${COMPANY}') as n`))[0]!.n).toBe(1)
  })

  it('is zero for a studio that has never asked', async () => {
    // The API adds a limit to this, so a null here would compare as false and
    // silently let every question through.
    expect((await q<{ n: number }>(`select assistant_asked_today('${COMPANY}') as n`))[0]!.n).toBe(0)
  })

  it('can be executed by the service and by nobody else (0248)', async () => {
    // 0247 revoked it from public, which takes service_role's default grant
    // away too; 0248 puts it back. Without that the quota check failed closed
    // and the first question of the day would have been refused.
    await db.exec(`set role service_role`)
    expect((await q<{ n: number }>(`select assistant_asked_today('${COMPANY}') as n`))[0]!.n).toBe(0)
    await db.exec(`reset role`)
    await db.exec(`set role authenticated`)
    await fails(`select assistant_asked_today('${COMPANY}')`)
    await db.exec(`reset role`)
  })
})

describe('was the answer any use (0255)', () => {
  it('starts as nobody having said', async () => {
    // null is not "no". Most answers are never marked, and counting them as
    // unhelpful would make the console read as a disaster from day one.
    await db.exec(`insert into assistant_log (company_id, question, status) values ('${COMPANY}', 'q', 'answered')`)
    const r = await q<{ helpful: boolean | null }>(`select helpful from assistant_log`)
    expect(r[0]!.helpful).toBeNull()
  })

  it('takes a thumb either way', async () => {
    await db.exec(`insert into assistant_log (id, company_id, question, status)
                   values ('d1000000-0000-4000-8000-000000000001', '${COMPANY}', 'q', 'answered')`)
    await db.exec(`update assistant_log set helpful = true where id = 'd1000000-0000-4000-8000-000000000001'`)
    expect((await q<{ h: boolean }>(`select helpful as h from assistant_log`))[0]!.h).toBe(true)
    await db.exec(`update assistant_log set helpful = false where id = 'd1000000-0000-4000-8000-000000000001'`)
    expect((await q<{ h: boolean }>(`select helpful as h from assistant_log`))[0]!.h).toBe(false)
  })

  it('lets the service mark one, and a studio none', async () => {
    await db.exec(`insert into assistant_log (id, company_id, question, status)
                   values ('d1000000-0000-4000-8000-000000000002', '${COMPANY}', 'q', 'answered')`)
    await db.exec(`set role service_role`)
    await db.exec(`update assistant_log set helpful = true where id = 'd1000000-0000-4000-8000-000000000002'`)
    await db.exec(`reset role`)
    // A studio marks its answer through the API, never by touching the table.
    await db.exec(`set role authenticated`)
    await fails(`update assistant_log set helpful = false`)
    await db.exec(`reset role`)
  })

  it('does not let the service rewrite the question or the answer', async () => {
    // The grant is on the one column. The log is a record of what happened, and
    // a record that can be edited is not one.
    await db.exec(`insert into assistant_log (id, company_id, question, status)
                   values ('d1000000-0000-4000-8000-000000000003', '${COMPANY}', 'as asked', 'answered')`)
    await db.exec(`set role service_role`)
    await fails(`update assistant_log set question = 'rewritten'`)
    await db.exec(`reset role`)
    expect((await q<{ question: string }>(`select question from assistant_log`))[0]!.question).toBe('as asked')
  })
})

describe('the migrations', () => {
  it('can be applied twice', async () => {
    await db.exec(`insert into assistant_log (company_id, question, status) values ('${COMPANY}', 'keep me', 'answered')`)
    for (const f of ['0247_help_assistant.sql', '0248_assistant_quota_grant.sql', '0255_assistant_helpful.sql']) {
      await db.exec(readFileSync(join(migDir, f), 'utf8'))
    }
    const r = await q<{ n: number }>(`select count(*)::int as n from assistant_log`)
    expect(r[0]!.n).toBe(1)
  })
})
