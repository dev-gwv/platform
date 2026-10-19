import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TransactionSql } from 'postgres'
import type { Env } from '../../services/api/src/context'
import {
  addStudioMessage,
  applySheetReply,
  createRequest,
  runSupportDigest,
  subjectFrom,
  supportFilesUrl,
  verifySupportFilesToken,
} from '../../services/api/src/lib/support-desk'

/**
 * Support requests (0271), run for real: a studio's request and its screenshots, a reply from the team's
 * Sheet landing in the request and the writer's bell, and the morning summary once a day.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const OWNER = 'f6200000-0000-4000-8000-000000000001'
const STAFF = 'f6200000-0000-4000-8000-000000000002'
const ADMIN = 'f6200000-0000-4000-8000-000000000003'
const A = 'f6200000-0000-4000-8000-0000000000aa'
const B = 'f6200000-0000-4000-8000-0000000000bb'
const HQ = 'f6200000-0000-4000-8000-0000000000cc'

let db: PGlite
const q = async <T>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows
// postgres.js's tagged template over PGlite: the same SQL text and parameters the server sends.
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((t, s, i) => t + (i ? `$${i}` : '') + s, '')
    return (await db.query(text, values)).rows
  },
  { json: (v: unknown) => JSON.stringify(v) },
) as unknown as TransactionSql
const env = { APP_URL: 'https://app.test', SUPPORT_SHEET_SECRET: 'support-sheet-secret-0123456789-abc' } as unknown as Env

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`)
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) await db.exec(readFileSync(join(migDir, f), 'utf8'))
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'owner@a.test'), ('${STAFF}', 'staff@a.test'), ('${ADMIN}', 'team@hq.test');
    insert into companies (id, name, owner_user_id) values ('${A}', 'Asha Studio', '${OWNER}'), ('${B}', 'Other Studio', '${OWNER}'), ('${HQ}', 'Studio AutoPilot HQ', '${ADMIN}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${A}', 'super_admin', 'Asha', 'owner@a.test'),
      ('${STAFF}', '${A}', 'employee', 'Nitin', 'staff@a.test'),
      ('${ADMIN}', '${HQ}', 'super_admin', 'Harsh', 'team@hq.test');
    insert into platform_admins (user_id) values ('${ADMIN}');
  `)
})

describe('support requests', () => {
  it('keeps a request with its first message, and only the studio\'s own screenshots', async () => {
    const [mine] = await q<{ id: string }>(`insert into files (company_id, name, mime, size_bytes, bytes, created_by) values ($1, 'shot.png', 'image/png', 3, '\\x010203', $2) returning id`, [A, STAFF])
    const [theirs] = await q<{ id: string }>(`insert into files (company_id, name, mime, size_bytes, bytes, created_by) values ($1, 'other.png', 'image/png', 3, '\\x010203', $2) returning id`, [B, OWNER])
    const id = await createRequest(sql, {
      companyId: A, userId: STAFF, kind: 'problem', urgent: true, pageUrl: '/projects',
      body: 'The quotation will not save. I pressed Save twice and nothing happened.', fileIds: [mine!.id, theirs!.id],
    })
    const [r] = await q<Record<string, unknown>>(`select subject, kind, urgency, status, created_by from support_requests where id = $1`, [id])
    expect(r).toEqual({ subject: 'The quotation will not save.', kind: 'problem', urgency: 'high', status: 'open', created_by: STAFF })
    const [m] = await q<{ sender: string; author_name: string; file_ids: string[] }>(`select sender, author_name, file_ids from support_messages where request_id = $1`, [id])
    expect(m).toEqual({ sender: 'me', author_name: 'Nitin', file_ids: [mine!.id] })
  })

  it('names our team as each platform admin, at their own profile', async () => {
    expect(await q(`select company_id, user_id, email from support_team_recipients()`)).toEqual([{ company_id: HQ, user_id: ADMIN, email: 'team@hq.test' }])
  })

  it('lets only the writer (or the owner) write again, and marks it waiting', async () => {
    const id = await createRequest(sql, { companyId: A, userId: STAFF, kind: 'question', urgent: false, body: 'How do I add my team?', fileIds: [] })
    expect(await addStudioMessage(sql, id, { companyId: B, userId: OWNER, seesAll: true }, 'Not my studio', [])).toBe(false)
    expect(await addStudioMessage(sql, id, { companyId: A, userId: OWNER, seesAll: false }, 'Not mine', [])).toBe(false)
    expect(await addStudioMessage(sql, id, { companyId: A, userId: STAFF, seesAll: false }, 'Still stuck', [])).toBe(true)
    expect((await q<{ status: string }>(`select status from support_requests where id = $1`, [id]))[0]!.status).toBe('waiting')
  })

  it('puts the team\'s reply in the request and the writer\'s bell; Resolved closes it', async () => {
    const id = await createRequest(sql, { companyId: A, userId: STAFF, kind: 'problem', urgent: false, body: 'Invoice total is wrong.', fileIds: [] })
    expect(await applySheetReply(env, sql, { ticketId: id, reply: 'Fixed the rounding, try again.', status: 'fixed', by: 'Harsh' })).toBe(true)
    const msgs = await q<{ sender: string; author_name: string; body: string }>(`select sender, author_name, body from support_messages where request_id = $1 order by created_at`, [id])
    expect(msgs.at(-1)).toEqual({ sender: 'support', author_name: 'Harsh', body: 'Fixed the rounding, try again.' })
    const [r] = await q<{ status: string; resolved: boolean }>(`select status, resolved_at is not null as resolved from support_requests where id = $1`, [id])
    expect(r).toEqual({ status: 'answered', resolved: true })
    const bells = await q<{ title: string; deep_link: string }>(`select title, deep_link from notifications where recipient_uid = $1 and type = 'support_reply'`, [STAFF])
    expect(bells.some((b) => b.title === 'Fixed: Invoice total is wrong.' && b.deep_link === `/support-requests?r=${id}`)).toBe(true)
    await applySheetReply(env, sql, { ticketId: id, reply: '', status: 'resolved' })
    expect((await q<{ status: string }>(`select status from support_requests where id = $1`, [id]))[0]!.status).toBe('closed')
    expect(await applySheetReply(env, sql, { ticketId: 'f6200000-0000-4000-8000-00000000dead', reply: 'x', status: 'replied' })).toBe(false)
  })

  it('sends the morning summary once a day, from 9 am India time', async () => {
    const before9 = new Date('2026-10-20T02:00:00Z') // 7:30 am IST
    const after9 = new Date('2026-10-20T04:00:00Z') // 9:30 am IST
    expect(await runSupportDigest(env, sql, before9)).toEqual({ sent: 0, open: 0 })
    const first = await runSupportDigest(env, sql, after9)
    expect(first.open).toBeGreaterThan(0)
    expect(await runSupportDigest(env, sql, new Date('2026-10-20T10:00:00Z'))).toEqual({ sent: 0, open: 0 })
  })

  it('signs the team\'s screenshot link, and refuses a forged or expired one', () => {
    const url = supportFilesUrl(env, 'https://api.test', 'f6200000-0000-4000-8000-0000000000ff')!
    const token = url.split('/').pop()!
    expect(verifySupportFilesToken(env, token)).toBe('f6200000-0000-4000-8000-0000000000ff')
    expect(verifySupportFilesToken(env, token.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')))).toBeNull()
    expect(verifySupportFilesToken(env, 'f6200000-0000-4000-8000-0000000000ff.1000.x')).toBeNull()
    expect(supportFilesUrl({ APP_URL: 'x' } as unknown as Env, 'https://api.test', 'id')).toBeNull()
  })

  it('takes the first sentence as the subject', () => {
    expect(subjectFrom('Payment failed! Tried twice.')).toBe('Payment failed!')
    expect(subjectFrom('   ')).toBe('Help request')
    expect(subjectFrom('a'.repeat(100))).toHaveLength(78)
  })
})
