import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Support call bookings and their WhatsApp messages (0279, 0280).
 *
 * The bookings carry people's numbers and the outbox what was sent to them,
 * so no studio may read either: service-only, like email_log. Everything
 * starts switched off, and a message cannot be written twice.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'authenticator']) await db.exec(`create role ${r};`)
  // As deploy/db/00_bootstrap.sql makes it: the API's trusted path past RLS.
  await db.exec(`create role service_role nologin noinherit bypassrls;`)
  for (const f of readdirSync(migDir)
    .filter((x) => x.endsWith('.sql') && !x.startsWith('0000_'))
    .sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
})

afterAll(async () => {
  await db.close()
})

describe('support call tables', () => {
  it('start with every switch off and the careful caps', async () => {
    const [s] = await q<Record<string, unknown>>(`
      select support_call_in_app, support_wa_official_on, support_wa_bot_on, support_wa_hourly_cap, support_wa_daily_cap,
             support_wa_team_numbers, support_wa_tpl_team from platform_settings limit 1`)
    expect(s).toMatchObject({
      support_call_in_app: false,
      support_wa_official_on: false,
      support_wa_bot_on: false,
      support_wa_hourly_cap: 20,
      support_wa_daily_cap: 100,
      support_wa_team_numbers: [],
      support_wa_tpl_team: 'support_call_team',
    })
  })

  it('point the support call at the support-call event', async () => {
    const [s] = await q<{ support_call_url: string | null }>(`select support_call_url from platform_settings limit 1`)
    expect(s?.support_call_url ?? '').not.toContain('intro-call')
  })

  it('cannot be read or written by a studio', async () => {
    for (const role of ['authenticated', 'anon']) {
      await db.exec(`set role ${role}`)
      for (const table of ['support_call_bookings', 'support_call_events', 'support_call_outbox']) {
        await expect(db.query(`select * from ${table}`)).rejects.toThrow()
      }
      await expect(db.query(`insert into support_call_events (event_id, kind, booking_ref) values ('x', 'booking.created', 'b')`)).rejects.toThrow()
      await db.exec(`reset role`)
    }
  })

  it('keep one message per purpose, whoever sends it twice', async () => {
    await db.exec(`set role service_role`)
    const [b] = await q<{ id: string }>(`
      insert into support_call_bookings (booking_ref, starts_at, name) values ('bk_1', now() + interval '2 days', 'Asha') returning id`)
    await db.exec(`insert into support_call_outbox (booking_id, channel, audience, dedupe_key) values ('${b!.id}', 'group', 'group', 'group:booked:bk_1:t')`)
    const again = await q(`
      insert into support_call_outbox (booking_id, channel, audience, dedupe_key) values ('${b!.id}', 'group', 'group', 'group:booked:bk_1:t')
      on conflict (dedupe_key) do nothing returning id`)
    expect(again).toHaveLength(0)
    await expect(db.query(`insert into support_call_outbox (channel, audience, dedupe_key) values ('sms', 'group', 'k2')`)).rejects.toThrow()
    await db.exec(`reset role`)
  })
})
