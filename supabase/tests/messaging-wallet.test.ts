import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The messaging wallet (0186): a send charges the wallet, writes the ledger
 * and the outbox in one go, and refuses rather than go negative; a failed
 * send is refunded exactly once; emails are free up to the monthly allowance;
 * a studio reads only its own wallet and cannot credit itself.
 *
 * Runs statements as `authenticated` with the production default privileges
 * (see work-submission-rls.test.ts for why both matter), and as the
 * superuser for the service-side calls the API makes with withService.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = 'd0000000-0000-4000-8000-000000000001'
const EDITOR = 'd0000000-0000-4000-8000-000000000002'
const OWNER_B = 'd0000000-0000-4000-8000-000000000003'
const ADMIN = 'd0000000-0000-4000-8000-000000000004'
const STUDIO = 'd0000000-0000-4000-8000-0000000000aa'
const STUDIO_B = 'd0000000-0000-4000-8000-0000000000bb'
const PLATFORM = 'd0000000-0000-4000-8000-0000000000cc'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]!

/** One statement as `authenticated`, signed in as this user. */
async function asUser<T>(uid: string, sql: string) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`)
  try {
    return (await db.query<T>(sql)).rows
  } finally {
    await db.exec(`reset role; set request.jwt.claim.sub = '';`)
  }
}
async function fails(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (e) {
    return (e as Error).message
  }
  return null
}
const balance = async (company = STUDIO) =>
  Number((await one<{ b: string }>(`select balance_paise::text as b from wallets where company_id = '${company}'`)).b)

let seq = 0
/** A start reminder for the editor, the way run_start_reminder_cron writes one. */
const remind = async () => {
  seq += 1
  await q(`select create_notification('${STUDIO}', '${EDITOR}', 'task_start', 'Start Album design today', 'Sharma wedding',
            'task_start:t${seq}', 'task', null, 'warning', '/tasks/my')`)
  return one<{ id: string; status: string; cost_paise: string; error: string | null; channel: string }>(`
    select o.id, o.status, o.cost_paise::text as cost_paise, o.error, o.channel
      from message_outbox o join notifications n on o.dedupe_key = 'n:' || n.id
     where n.dedupe_key = 'task_start:t${seq}' and o.channel = 'whatsapp'`)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  await db.exec(`grant usage on schema public to anon, authenticated, service_role;`)
  await db.exec(`grant usage on schema auth to anon, authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;`)
  await db.exec(`alter default privileges in schema public grant execute on functions to authenticated, service_role;`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'o@s.test'), ('${EDITOR}', 'e@s.test'), ('${OWNER_B}', 'b@s.test'), ('${ADMIN}', 'admin@ipc.test');
    insert into companies (id, name, owner_user_id) values
      ('${STUDIO}', 'Sharma Studio', '${OWNER}'), ('${STUDIO_B}', 'Other Studio', '${OWNER_B}'), ('${PLATFORM}', 'IPC', '${ADMIN}');
    insert into users (user_id, company_id, role, name, email, phone) values
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Owner', 'o@s.test', '98765 43210'),
      ('${EDITOR}', '${STUDIO}', 'employee', 'Priya Kumar', 'e@s.test', '+91 91234 56789'),
      ('${OWNER_B}', '${STUDIO_B}', 'super_admin', 'Other', 'b@s.test', '9000000001'),
      ('${ADMIN}', '${PLATFORM}', 'super_admin', 'Admin', 'admin@ipc.test', null);
    insert into platform_admins (user_id) values ('${ADMIN}');
    update whatsapp_templates set status = 'approved';
  `)
})

describe('settings', () => {
  it('sends nothing until the studio switches the event on', async () => {
    seq += 1
    await q(`select create_notification('${STUDIO}', '${EDITOR}', 'task_start', 'x', 'y', 'task_start:off', 'task', null)`)
    expect(await q(`select 1 from message_outbox`)).toHaveLength(0)
  })

  it('only the owner can switch events on', async () => {
    expect(await fails(() => asUser(EDITOR, `select set_messaging_setting('start_reminder', true, false)`))).toMatch(/not allowed/)
    await asUser(OWNER, `select set_messaging_setting('start_reminder', true, false)`)
    const s = await asUser<{ whatsapp: boolean; email: boolean }>(OWNER, `select whatsapp, email from messaging_settings`)
    expect(s).toEqual([{ whatsapp: true, email: false }])
  })
})

describe('debit', () => {
  it('refuses without balance and tells the owner to recharge', async () => {
    const m = await remind()
    expect(m.status).toBe('skipped_no_balance')
    expect(Number(m.cost_paise)).toBe(0)
    expect(await balance()).toBe(0)
    expect(await q(`select 1 from wallet_ledger`)).toHaveLength(0)
    const told = await q<{ type: string }>(`select type from notifications where recipient_uid = '${OWNER}' and type = 'wallet.empty'`)
    expect(told).toHaveLength(1)
  })

  it('charges the price, writes the ledger with the balance after, and never goes negative', async () => {
    // Utility: 12 paise + 25% (3) + 5 = 20 paise.
    await q(`select credit_wallet('${STUDIO}', 50, 'recharge_manual', 'UTR1')`)
    const a = await remind()
    const b = await remind()
    const c = await remind()
    expect([a.status, b.status, c.status]).toEqual(['queued', 'queued', 'skipped_no_balance'])
    expect(Number(a.cost_paise)).toBe(20)
    expect(await balance()).toBe(10)
    const ledger = await q<{ kind: string; amount_paise: string; balance_after: string; source: string }>(
      `select kind, amount_paise::text, balance_after::text, source from wallet_ledger where company_id = '${STUDIO}' order by created_at, balance_after desc`)
    expect(ledger.map((l) => [l.kind, Number(l.amount_paise), Number(l.balance_after), l.source])).toEqual([
      ['credit', 50, 50, 'recharge_manual'],
      ['debit', 20, 30, 'whatsapp'],
      ['debit', 20, 10, 'whatsapp'],
    ])
    // The phone went out in E.164 without the plus.
    expect((await one<{ to_address: string }>(`select to_address from message_outbox where id = '${a.id}'`)).to_address).toBe('919123456789')
  })

  it('the balance cannot go below zero even by a direct write', async () => {
    expect(await fails(() => q(`update wallets set balance_paise = -1 where company_id = '${STUDIO}'`))).toMatch(/check constraint/)
  })

  it('a second copy of the same notification is not charged twice', async () => {
    const n = await one<{ id: string }>(`select id from notifications where dedupe_key = 'task_start:t2'`)
    const before = await balance()
    const again = await one<{ id: string }>(`
      select enqueue_message('${STUDIO}', 'whatsapp', '9123456789', 'start_reminder', '[]', 'task', null, 'n:${n.id}') as id`)
    expect(again.id).toBeTruthy()
    expect(await balance()).toBe(before)
  })

  it('a template Meta has not approved is not charged', async () => {
    await q(`update whatsapp_templates set status = 'pending' where key = 'start_reminder'`)
    await q(`select credit_wallet('${STUDIO}', 100, 'adjustment', null, 'test')`)
    const before = await balance()
    const m = await remind()
    expect(m.status).toBe('failed')
    expect(m.error).toMatch(/waiting for WhatsApp approval/)
    expect(await balance()).toBe(before)
    await q(`update whatsapp_templates set status = 'approved' where key = 'start_reminder'`)
  })

  it('someone who replied STOP is skipped, not charged', async () => {
    await q(`select message_opt_out_set('9123456789', true)`)
    const before = await balance()
    expect((await remind()).status).toBe('skipped_opt_out')
    expect(await balance()).toBe(before)
    await q(`select message_opt_out_set('+91 91234 56789', false)`)
  })

  it('warns the owner once when the balance crosses the low mark', async () => {
    await q(`update wallets set low_balance_paise = 100 where company_id = '${STUDIO}'`)
    // balance is 110 now: one send crosses under 100, the next stays under.
    expect(await balance()).toBe(110)
    await remind()
    await remind()
    expect(await q(`select 1 from notifications where recipient_uid = '${OWNER}' and type = 'wallet.low'`)).toHaveLength(1)
  })
})

describe('the worker and refunds', () => {
  it('claims queued rows once and marks a send', async () => {
    const claimed = await q<{ id: string; meta_template_name: string; to_address: string; vars: string[] }>(`select * from message_outbox_claim(50)`)
    expect(claimed.length).toBeGreaterThan(0)
    expect(claimed[0]!.meta_template_name).toBe('ipc_work_start_reminder')
    expect(claimed[0]!.vars).toEqual(['Priya', 'Sharma Studio', 'Start Album design today', 'Sharma wedding'])
    expect(await q(`select * from message_outbox_claim(50)`)).toHaveLength(0)
    await q(`select message_outbox_result('${claimed[0]!.id}', true, 'wamid.OK', null)`)
    for (const c of claimed.slice(1)) await q(`select message_outbox_result('${c.id}', false, null, 'WhatsApp not configured')`)
    const sent = await one<{ status: string }>(`select status from message_outbox where id = '${claimed[0]!.id}'`)
    expect(sent.status).toBe('sent')
  })

  it('refunds a failed send, exactly once', async () => {
    const failed = await q<{ id: string; cost_paise: string }>(
      `select id, cost_paise::text from message_outbox where status = 'failed' and error = 'WhatsApp not configured'`)
    expect(failed.length).toBeGreaterThan(0)
    const refunds = await q<{ message_id: string; amount_paise: string }>(
      `select message_id, amount_paise::text from wallet_ledger where source = 'refund'`)
    expect(refunds.map((r) => r.message_id).sort()).toEqual(failed.map((f) => f.id).sort())
    // A late duplicate result changes nothing.
    const before = await balance()
    await q(`select message_outbox_result('${failed[0]!.id}', false, null, 'again')`)
    expect(await balance()).toBe(before)
  })

  it('a delivery receipt moves it forward; a later failure refunds', async () => {
    const before = await balance()
    expect((await one<{ ok: boolean }>(`select message_status_update('wamid.OK', 'delivered') as ok`)).ok).toBe(true)
    expect((await one<{ s: string }>(`select status as s from message_outbox where provider_message_id = 'wamid.OK'`)).s).toBe('delivered')
    // Delivered is charged by Meta: a late failure after it does not refund.
    await q(`select message_status_update('wamid.OK', 'failed', 'late')`)
    expect(await balance()).toBe(before)
    // Sent but never delivered: refunded.
    const m = await remind()
    expect(m.status).toBe('queued')
    await q(`select message_outbox_claim(50)`)
    await q(`select message_outbox_result('${m.id}', true, 'wamid.TWO', null)`)
    const charged = await balance()
    await q(`select message_status_update('wamid.TWO', 'failed', 'Number not on WhatsApp')`)
    expect(await balance()).toBe(charged + 20)
    expect((await one<{ s: string; e: string }>(`select status as s, error as e from message_outbox where id = '${m.id}'`))).toEqual({ s: 'failed', e: 'Number not on WhatsApp' })
    expect((await one<{ ok: boolean }>(`select message_status_update('wamid.nope', 'read') as ok`)).ok).toBe(false)
  })

  it('the ledger always adds up to the balance, and cannot be rewritten', async () => {
    const sum = await one<{ s: string }>(`
      select coalesce(sum(case kind when 'credit' then amount_paise else -amount_paise end), 0)::text as s
        from wallet_ledger where company_id = '${STUDIO}'`)
    expect(Number(sum.s)).toBe(await balance())
    expect(await fails(() => q(`update wallet_ledger set amount_paise = 1`))).toMatch(/cannot be changed/)
    expect(await fails(() => q(`delete from wallet_ledger`))).toMatch(/cannot be changed/)
  })
})

describe('email allowance', () => {
  it('is free for the first emails of the month, then charged from the wallet', async () => {
    await q(`insert into messaging_prices (channel, category, meta_cost_paise, markup_pct, markup_fixed_paise, free_monthly)
             values ('email', 'email', 5, 0, 15, 2)`)
    await asUser(OWNER, `select set_messaging_setting('start_reminder', false, true)`)
    const sendEmail = async () => {
      seq += 1
      await q(`select create_notification('${STUDIO}', '${EDITOR}', 'deliverable_start', 'Start Reel', 'Wedding', 'ds:${seq}', 'deliverable', null)`)
      return one<{ status: string; cost_paise: string; free_allowance: boolean; to_address: string; subject: string }>(`
        select o.status, o.cost_paise::text, o.free_allowance, o.to_address, o.subject from message_outbox o
          join notifications n on o.dedupe_key = 'n:' || n.id where n.dedupe_key = 'ds:${seq}' and o.channel = 'email'`)
    }
    const start = await balance()
    const e1 = await sendEmail()
    const e2 = await sendEmail()
    const e3 = await sendEmail()
    expect([e1.free_allowance, e2.free_allowance, e3.free_allowance]).toEqual([true, true, false])
    expect([Number(e1.cost_paise), Number(e3.cost_paise)]).toEqual([0, 20])
    expect(e1.to_address).toBe('e@s.test')
    expect(e1.subject).toBe('Sharma Studio: Start Reel')
    expect(await balance()).toBe(start - 20)
    // WhatsApp is off for this event now: only emails were written.
    expect(await q(`select 1 from message_outbox o join notifications n on o.dedupe_key = 'n:' || n.id
                    where n.dedupe_key like 'ds:%' and o.channel = 'whatsapp'`)).toHaveLength(0)
  })
})

describe('credits', () => {
  it('a razorpay payment credits once however often it is replayed', async () => {
    const before = await balance()
    const a = await one<{ id: string }>(`select credit_wallet('${STUDIO}', 50000, 'razorpay', 'pay_ABC') as id`)
    const b = await one<{ id: string }>(`select credit_wallet('${STUDIO}', 50000, 'razorpay', 'pay_ABC') as id`)
    expect(a.id).toBe(b.id)
    expect(await balance()).toBe(before + 50000)
  })

  it('the owner asks; the platform credits it and the request is fulfilled', async () => {
    const [r] = await asUser<{ id: string }>(OWNER, `select request_wallet_recharge(100000, 'Please add') as id`)
    expect(await fails(() => asUser(OWNER, `select request_wallet_recharge(50000, null)`))).toMatch(/already have a recharge request/)
    expect(await fails(() => asUser(EDITOR, `select request_wallet_recharge(50000, null)`))).toMatch(/not allowed/)
    // The platform team heard about it.
    expect(await q(`select 1 from notifications where recipient_uid = '${ADMIN}' and type = 'platform.recharge_request'`)).toHaveLength(1)

    const before = await balance()
    await asUser(ADMIN, `select platform_credit_wallet('${STUDIO}', 100000, 'UTR 998877', 'Paid by UPI', '${r!.id}')`)
    expect(await balance()).toBe(before + 100000)
    const req = await one<{ status: string; ledger_id: string | null }>(`select status, ledger_id from wallet_recharge_requests where id = '${r!.id}'`)
    expect(req.status).toBe('fulfilled')
    expect(req.ledger_id).toBeTruthy()
    // A request cannot be fulfilled twice.
    expect(await fails(() => asUser(ADMIN, `select platform_credit_wallet('${STUDIO}', 100, 'x', null, '${r!.id}')`))).toMatch(/not pending/)
  })

  it('an adjustment down never takes the balance below zero', async () => {
    const b = await balance()
    expect(await fails(() => asUser(ADMIN, `select platform_adjust_wallet('${STUDIO}', ${-(b + 1)}, 'too much')`))).toMatch(/below zero/)
    await asUser(ADMIN, `select platform_adjust_wallet('${STUDIO}', -100, 'Test credit reversed')`)
    expect(await balance()).toBe(b - 100)
  })
})

describe('who can see and touch what', () => {
  it("a studio cannot read another studio's wallet, ledger, requests or messages", async () => {
    for (const t of ['wallets', 'wallet_ledger', 'wallet_recharge_requests', 'message_outbox']) {
      const rows = await asUser<{ company_id: string }>(OWNER_B, `select company_id from ${t}`)
      expect(rows.every((r) => r.company_id === STUDIO_B), t).toBe(true)
    }
    expect(await asUser(OWNER_B, `select 1 from wallet_ledger where company_id = '${STUDIO}'`)).toHaveLength(0)
  })

  it("a team member cannot read their own studio's wallet", async () => {
    expect(await asUser(EDITOR, `select 1 from wallets`)).toHaveLength(0)
    expect(await asUser(EDITOR, `select 1 from wallet_ledger`)).toHaveLength(0)
  })

  it('a studio cannot credit itself, directly or through a function', async () => {
    expect(await fails(() => asUser(OWNER, `select credit_wallet('${STUDIO}', 100000, 'recharge_manual', 'x')`))).toMatch(/permission denied/)
    expect(await fails(() => asUser(OWNER, `select platform_credit_wallet('${STUDIO}', 100000, 'x', null, null)`))).toMatch(/not allowed/)
    expect(await fails(() => asUser(OWNER, `select platform_adjust_wallet('${STUDIO}', 100000, 'x')`))).toMatch(/not allowed/)
    expect(await fails(() => asUser(OWNER, `update wallets set balance_paise = 999999`))).toMatch(/permission denied/)
    expect(await fails(() => asUser(OWNER, `insert into wallet_ledger (company_id, kind, amount_paise, balance_after, source)
                                             values ('${STUDIO}', 'credit', 1, 1, 'recharge_manual')`))).toMatch(/permission denied/)
    expect(await fails(() => asUser(OWNER, `select enqueue_message('${STUDIO_B}', 'email', 'x@y.in', null, '[]', null, null, null)`))).toMatch(/permission denied/)
    expect(await fails(() => asUser(OWNER, `select message_outbox_result(gen_random_uuid(), false, null, null)`))).toMatch(/permission denied/)
  })

  it("studios see their price, never Meta's cost or the markup", async () => {
    const prices = await asUser<{ channel: string; category: string; price_paise: string }>(OWNER, `select * from messaging_price_list()`)
    expect(prices.find((p) => p.category === 'utility')!.price_paise.toString()).toBe('20')
    expect(await asUser(OWNER, `select * from messaging_prices`)).toHaveLength(0)
    expect(await asUser(OWNER, `select * from whatsapp_templates`)).toHaveLength(0)
    expect((await asUser(ADMIN, `select * from messaging_prices`)).length).toBeGreaterThan(0)
  })

  it('a test message to the owner with an empty wallet is skipped for balance', async () => {
    const [r] = await asUser<{ status: string }>(OWNER_B, `select * from send_test_message('whatsapp')`)
    expect(r!.status).toBe('skipped_no_balance')
  })
})
