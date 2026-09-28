import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * 0202: sequence steps that write messages, sequences that start by
 * themselves, stop on a reply, and never send one message twice; the
 * per-studio feature switches; the studio's branding behind its switch.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'c2000000-0000-4000-8000-000000000001'
const REP = 'c2000000-0000-4000-8000-000000000002'
const ADMIN = 'c2000000-0000-4000-8000-000000000009'
const COMPANY = 'c2000000-0000-4000-8000-0000000000aa'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0] as T
let n = 0
const lead = async (over: Record<string, string> = {}) => {
  n += 1
  const id = `d2000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const cols = {
    id: `'${id}'`,
    company_id: `'${COMPANY}'`,
    name: `'Lead ${n}'`,
    phone: `'98765100${String(n).padStart(2, '0')}'`,
    email: `'lead${n}@x.test'`,
    assigned_to: `'${REP}'`,
    ...over,
  }
  await db.exec(`insert into crm_leads (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`)
  return id
}
const sequence = async (
  steps: { day: number; channel: string; body?: string; subject?: string }[],
  opts: { auto?: boolean; stage?: string; source?: string; stopOnReply?: boolean } = {},
) => {
  const { id } = await one<{ id: string }>(`
    insert into crm_cadences (company_id, name, auto_start, stage_filter, source_filter, stop_on_reply)
    values ('${COMPANY}', 'Seq ${Math.random().toString(36).slice(2, 6)}', ${opts.auto ?? false},
            ${opts.stage ? `'${opts.stage}'` : 'null'}, ${opts.source ? `'${opts.source}'` : 'null'}, ${opts.stopOnReply ?? true})
    returning id`)
  for (const [i, s] of steps.entries()) {
    await db.exec(`insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, channel, body, subject, note)
                   values ('${id}', '${COMPANY}', ${i + 1}, ${s.day}, '${s.channel}', ${s.body ? `'${s.body}'` : 'null'},
                           ${s.subject ? `'${s.subject}'` : 'null'}, ${s.channel === 'reminder' ? `'Call them'` : 'null'})`)
  }
  return id
}
const onSeq = (leadId: string) =>
  q<{ cadence_id: string; step_no: number; stopped_reason: string | null; completed_at: string | null }>(
    `select cadence_id, step_no, stopped_reason, completed_at from crm_lead_cadences where lead_id = '${leadId}'`,
  )
/** Make the lead's current step due now, and run the hourly sweep. */
const tick = async (leadId: string) => {
  await db.exec(`update crm_lead_cadences set next_at = now() - interval '1 minute' where lead_id = '${leadId}'`)
  return (await one<{ r: { due: number; messages: number } }>(`select crm_advance_cadences(false) as r`)).r
}
const sends = (leadId: string) =>
  q<{ channel: string; status: string; body: string; error: string | null; step_no: number }>(
    `select channel, status, body, error, step_no from crm_sequence_sends where lead_id = '${leadId}' order by step_no`,
  )
const asUser = async <T>(user: string, fn: () => Promise<T>) => {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`)
  try {
    return await fn()
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
    insert into auth.users (id, email) values ('${OWNER}', 'o@s.test'), ('${REP}', 'r@s.test'), ('${ADMIN}', 'p@ipc.test');
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Asha Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Asha', 'o@s.test', 'active'),
      ('${REP}', '${COMPANY}', 'employee', 'Ravi', 'r@s.test', 'active');
    insert into platform_admins (user_id) values ('${ADMIN}');
    grant usage on schema auth to authenticated;
    grant select, insert, update on company_branding to authenticated;
  `)
})

beforeEach(async () => {
  await db.exec(`
    delete from crm_sequence_sends; delete from crm_lead_cadences; delete from crm_activities; delete from crm_leads;
    delete from crm_cadences; delete from company_entitlements; delete from company_branding; delete from notifications;
  `)
})

describe('message steps', () => {
  it('a WhatsApp step waits in Send now and tells the owner; the reminder after it moves the follow-up', async () => {
    const seq = await sequence([
      { day: 0, channel: 'whatsapp', body: 'Hi {{name}}' },
      { day: 2, channel: 'reminder' },
    ])
    const id = await lead()
    await db.exec(`select crm_sequence_begin('${id}', '${seq}', null, 'test')`)
    // The first step is a message, not a call: the follow-up is left alone.
    expect((await one<{ f: string | null }>(`select follow_up_at as f from crm_leads where id = '${id}'`)).f).toBeNull()

    expect(await tick(id)).toMatchObject({ due: 1, messages: 1 })
    expect(await sends(id)).toEqual([{ channel: 'whatsapp', status: 'manual', body: 'Hi {{name}}', error: null, step_no: 1 }])
    const note = await q<{ title: string }>(`select title from notifications where type = 'crm_sequence_send'`)
    expect(note.map((r) => r.title)).toEqual(['Send WhatsApp to Lead ' + n])
    expect((await onSeq(id))[0]!.step_no).toBe(2)
    expect((await one<{ f: string | null }>(`select follow_up_at as f from crm_leads where id = '${id}'`)).f).not.toBeNull()
  })

  it('an email goes by itself only when the studio has automatic sequences', async () => {
    const seq = await sequence([{ day: 0, channel: 'email', subject: 'Packages', body: 'Hello' }])
    const a = await lead()
    await db.exec(`select crm_sequence_begin('${a}', '${seq}', null, 'test')`)
    await tick(a)
    expect((await sends(a))[0]!.status).toBe('manual')

    await db.exec(`insert into company_entitlements (company_id, key) values ('${COMPANY}', 'sequences_auto')`)
    const b = await lead()
    await db.exec(`select crm_sequence_begin('${b}', '${seq}', null, 'test')`)
    await tick(b)
    expect((await sends(b))[0]!.status).toBe('queued')
  })

  it('a lead with no email or phone is skipped with the reason, not failed', async () => {
    const seq = await sequence([{ day: 0, channel: 'email', body: 'Hello' }])
    const id = await lead({ email: 'null' })
    await db.exec(`select crm_sequence_begin('${id}', '${seq}', null, 'test')`)
    await tick(id)
    expect(await sends(id)).toMatchObject([{ status: 'skipped', error: 'No email address' }])
  })

  it('one enrollment never writes a step twice, and a claimed message is taken once', async () => {
    await db.exec(`insert into company_entitlements (company_id, key) values ('${COMPANY}', 'sequences_auto')`)
    const seq = await sequence([{ day: 0, channel: 'email', body: 'Hello' }, { day: 3, channel: 'email', body: 'Again' }])
    const id = await lead()
    await db.exec(`select crm_sequence_begin('${id}', '${seq}', null, 'test')`)
    await tick(id)
    // Put the lead back on step 1 of the same enrollment: nothing new is written.
    await db.exec(`update crm_lead_cadences set step_no = 1 where lead_id = '${id}'`)
    await tick(id)
    expect((await sends(id)).filter((s) => s.step_no === 1)).toHaveLength(1)

    const first = await q(`select * from crm_sequence_sends_claim(10)`)
    const second = await q(`select * from crm_sequence_sends_claim(10)`)
    expect(first.length).toBeGreaterThan(0)
    expect(second).toEqual([])
  })
})

describe('starting and stopping by themselves', () => {
  it('a new lead starts the auto sequence; an imported one does not', async () => {
    const seq = await sequence([{ day: 0, channel: 'whatsapp', body: 'Hi' }], { auto: true })
    const fresh = await lead({ source: `'webform'` })
    const imported = await lead({ source: `'csv_import'` })
    expect((await onSeq(fresh))[0]?.cadence_id).toBe(seq)
    expect(await onSeq(imported)).toEqual([])
  })

  it('the source-specific sequence wins for its source', async () => {
    await sequence([{ day: 0, channel: 'whatsapp', body: 'Hi' }], { auto: true })
    const insta = await sequence([{ day: 0, channel: 'whatsapp', body: 'Hi from Insta' }], { auto: true, source: 'instagram' })
    const id = await lead({ source: `'instagram'` })
    expect((await onSeq(id))[0]?.cadence_id).toBe(insta)
  })

  it('reaching a stage starts the sequence written for it', async () => {
    const quote = await sequence([{ day: 2, channel: 'whatsapp', body: 'Did you see it?' }], { auto: true, stage: 'proposal_sent' })
    const id = await lead()
    expect(await onSeq(id)).toEqual([])
    await db.exec(`update crm_leads set status = 'proposal_sent' where id = '${id}'`)
    expect((await onSeq(id))[0]?.cadence_id).toBe(quote)
  })

  it('a reply stops it and drops what was waiting; a sequence that keeps going is left alone', async () => {
    const seq = await sequence([{ day: 0, channel: 'whatsapp', body: 'Hi' }, { day: 3, channel: 'whatsapp', body: 'Again' }])
    const id = await lead()
    await db.exec(`select crm_sequence_begin('${id}', '${seq}', null, 'test')`)
    await tick(id)
    await db.exec(`insert into crm_activities (company_id, lead_id, type, direction, body) values ('${COMPANY}', '${id}', 'whatsapp', 'in', 'Yes please call')`)
    expect((await onSeq(id))[0]!.stopped_reason).toBe('replied')
    expect(await sends(id)).toMatchObject([{ status: 'skipped', error: 'Sequence stopped (replied)' }])

    const keep = await sequence([{ day: 0, channel: 'whatsapp', body: 'Hi' }], { stopOnReply: false })
    const other = await lead()
    await db.exec(`select crm_sequence_begin('${other}', '${keep}', null, 'test')`)
    await db.exec(`insert into crm_activities (company_id, lead_id, type, direction) values ('${COMPANY}', '${other}', 'call', 'in')`)
    expect((await onSeq(other))[0]!.stopped_reason).toBeNull()
  })

  it('winning the lead stops it, and says so', async () => {
    const seq = await sequence([{ day: 0, channel: 'whatsapp', body: 'Hi' }])
    const id = await lead()
    await db.exec(`select crm_sequence_begin('${id}', '${seq}', null, 'test')`)
    await db.exec(`update crm_leads set status = 'converted' where id = '${id}'`)
    expect((await onSeq(id))[0]!.stopped_reason).toBe('won')
  })
})

describe('starters', () => {
  it('adds the three photography sequences once, switched on but not automatic', async () => {
    const added = await asUser(OWNER, () => one<{ n: number }>(`select crm_add_starter_sequences() as n`))
    expect(added.n).toBe(3)
    const again = await asUser(OWNER, () => one<{ n: number }>(`select crm_add_starter_sequences() as n`))
    expect(again.n).toBe(0)
    const rows = await q<{ name: string; auto_start: boolean; steps: number }>(`
      select c.name, c.auto_start, (select count(*)::int from crm_cadence_steps s where s.cadence_id = c.id) as steps
        from crm_cadences c`)
    expect(Object.fromEntries(rows.map((r) => [r.name, r.steps]))).toEqual({ 'New enquiry': 4, 'Quotation sent': 3, 'After the shoot': 2 })
    expect(rows.every((r) => !r.auto_start)).toBe(true)
  })
})

describe('feature switches and branding', () => {
  it('only a platform admin turns a switch; the studio can read its own', async () => {
    await expect(asUser(OWNER, () => q(`select platform_set_entitlement('${COMPANY}', 'white_label', true)`))).rejects.toThrow(/platform access only/)
    const on = await asUser(ADMIN, () => one<{ e: string[] }>(`select platform_set_entitlement('${COMPANY}', 'white_label', true) as e`))
    expect(on.e).toEqual(['white_label'])
    expect((await asUser(OWNER, () => one<{ e: string[] }>(`select my_entitlements() as e`))).e).toEqual(['white_label'])
    const off = await asUser(ADMIN, () => one<{ e: string[] }>(`select platform_set_entitlement('${COMPANY}', 'white_label', false) as e`))
    expect(off.e).toEqual([])
  })

  it('branding can be saved only with white label', async () => {
    const save = () =>
      asUser(OWNER, () =>
        q(`insert into company_branding (company_id, from_name, reply_to) values ('${COMPANY}', 'Asha Studio', 'hello@asha.test')
           on conflict (company_id) do update set from_name = excluded.from_name`),
      )
    await expect(save()).rejects.toThrow(/row-level security/)
    await db.exec(`insert into company_entitlements (company_id, key) values ('${COMPANY}', 'white_label')`)
    await save()
    expect((await one<{ from_name: string }>(`select from_name from company_branding`)).from_name).toBe('Asha Studio')
  })
})
