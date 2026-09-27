import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0201: a logged call outcome updates the lead (attempts, unreachable), and
 * the call queue ranks a caller's open leads with a reason for each.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'a1000000-0000-4000-8000-000000000001'
const REP = 'a1000000-0000-4000-8000-000000000002'
const OTHER = 'a1000000-0000-4000-8000-000000000003'
const COMPANY = 'a1000000-0000-4000-8000-0000000000aa'
const COMPANY_B = 'a1000000-0000-4000-8000-0000000000bb'
// 2026-10-05 12:00 IST
const NOW = `'2026-10-05T06:30:00Z'::timestamptz`

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
let n = 0
const lead = async (over: Record<string, string> = {}) => {
  n += 1
  const id = `b1000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const cols = { id: `'${id}'`, company_id: `'${COMPANY}'`, name: `'Lead ${n}'`, phone: `'98765000${String(n).padStart(2, '0')}'`, assigned_to: `'${REP}'`, ...over }
  await db.exec(`insert into crm_leads (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`)
  return id
}
const call = (leadId: string, outcome: string) =>
  db.exec(`insert into crm_activities (company_id, lead_id, type, direction, outcome, started_at)
            values ('${COMPANY}', '${leadId}', 'call', 'out', '${outcome}', now())`)
const leadRow = async (id: string) =>
  (await q<{ call_attempts: number; contacted_status: string; last_call_outcome: string }>(
    `select call_attempts, contacted_status, last_call_outcome from crm_leads where id = '${id}'`,
  ))[0]!
const queueAs = async (user: string, scope = 'mine') => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await q<{ id: string; priority: number; reason: string }>(`select id, priority, reason from crm_call_queue('${scope}', ${NOW})`)
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
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${REP}', 'r@s.test'), ('${OTHER}', 'x@o.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}'), ('${COMPANY_B}', 'Other', '${OTHER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'o@s.test', 'active'),
      ('${REP}', '${COMPANY}', 'employee', 'Ravi', 'r@s.test', 'active'),
      ('${OTHER}', '${COMPANY_B}', 'super_admin', 'Kiran', 'x@o.test', 'active');
    -- The live database grants these to every signed-in user (0000, not run here).
    grant select on crm_leads to authenticated;
    grant usage on schema auth to authenticated;
  `)
})

beforeEach(async () => {
  await db.exec(`delete from crm_activities; delete from crm_leads;`)
})

describe('logging a call', () => {
  it('three misses in a row make a lead unreachable; an answer resets it', async () => {
    const id = await lead()
    await call(id, 'no_answer')
    await call(id, 'busy')
    expect(await leadRow(id)).toMatchObject({ call_attempts: 2, last_call_outcome: 'busy' })
    await call(id, 'switched_off')
    expect(await leadRow(id)).toMatchObject({ call_attempts: 3, contacted_status: 'unreachable' })
    await call(id, 'answered')
    expect(await leadRow(id)).toMatchObject({ call_attempts: 0, contacted_status: 'contacted' })
  })

  it('a wrong number is unreachable at once', async () => {
    const id = await lead()
    await call(id, 'wrong_number')
    expect((await leadRow(id)).contacted_status).toBe('unreachable')
  })

  it('an outcome added later to a call counts once', async () => {
    const id = await lead()
    await db.exec(`insert into crm_activities (company_id, lead_id, type, direction, started_at) values ('${COMPANY}', '${id}', 'call', 'out', now())`)
    await db.exec(`update crm_activities set outcome = 'no_answer' where lead_id = '${id}'`)
    await db.exec(`update crm_activities set outcome = 'busy' where lead_id = '${id}'`)
    expect((await leadRow(id)).call_attempts).toBe(1)
  })
})

describe('the call queue', () => {
  it('ranks what is owed, with a reason, and leaves out closed leads', async () => {
    const callback = await lead({ follow_up_at: `'2026-10-05T05:00:00Z'`, last_call_outcome: `'callback'` })
    const late = await lead({ follow_up_at: `'2026-10-02T05:00:00Z'` })
    const today = await lead({ follow_up_at: `'2026-10-05T12:00:00Z'` })
    const fresh = await lead({ created_at: `'2026-10-05T04:00:00Z'` })
    const quote = await lead({ status: `'proposal_sent'`, last_contacted_at: `'2026-09-28T05:00:00Z'`, created_at: `'2026-09-20T05:00:00Z'` })
    await lead({ status: `'converted'` })
    await lead({ status: `'lost'`, lost_reason: `'Budget'` })
    await lead({ is_archived: 'true' })
    await lead({ last_contacted_at: `'2026-10-04T05:00:00Z'`, follow_up_at: `'2026-10-20T05:00:00Z'` })

    const rows = await queueAs(REP)
    expect(rows.map((r) => r.id)).toEqual([callback, late, today, fresh, quote])
    expect(rows.map((r) => r.reason)).toEqual([
      'Asked to be called back',
      'Follow-up 3 days late',
      'Follow-up due today',
      'New enquiry, not called yet',
      'Quotation sent, quiet for 7 days',
    ])
  })

  it('"mine" is my leads; "all" is the studio, and never another studio', async () => {
    await lead({ follow_up_at: `'2026-10-05T12:00:00Z'` })
    await lead({ follow_up_at: `'2026-10-05T12:00:00Z'`, assigned_to: `'${OWNER}'` })
    await lead({ follow_up_at: `'2026-10-05T12:00:00Z'`, company_id: `'${COMPANY_B}'`, assigned_to: `'${OTHER}'` })
    expect(await queueAs(REP)).toHaveLength(1)
    expect(await queueAs(OWNER, 'all')).toHaveLength(2)
    expect(await queueAs(OTHER, 'all')).toHaveLength(1)
  })
})
