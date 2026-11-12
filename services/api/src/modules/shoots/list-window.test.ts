import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Hono, type Context, type Next } from 'hono'
import type { TransactionSql } from 'postgres'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resolveAccess, type AccessInput } from '@ipc/permissions'
import type { AppEnv, AuthContext } from '../../context'
import type * as DbModule from '../../lib/db'
import { errorHandler } from '../../middleware/errors'
import { requestId } from '../../middleware/request-id'

/**
 * GET /shoots with a window (from / to on shoot_date, a search) and GET
 * /shoots/:id (speed audit, 12 Nov). The routes run as written against the
 * real migrations in PGlite, as the signed-in person with row security on:
 * only the auth middleware and the postgres.js driver are stand-ins. The
 * driver's `sql` tag is recorded as fragments and rendered to numbered
 * parameters, the way scope.test.ts runs worksOn.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'supabase', 'migrations')

const OWNER = 'c3020000-0000-4000-8000-000000000001'
const RAVI = 'c3020000-0000-4000-8000-000000000002'
const NITIN = 'c3020000-0000-4000-8000-000000000003'
const OTHER = 'c3020000-0000-4000-8000-000000000004'
const STUDIO = 'c3020000-0000-4000-8000-0000000000aa'
const ELSEWHERE = 'c3020000-0000-4000-8000-0000000000bb'
const MEHTA = 'c3020000-0000-4000-8000-0000000000c1'
const KAPOOR = 'c3020000-0000-4000-8000-0000000000c2'
const P_MEHTA = 'c3020000-0000-4000-8000-0000000000d1'
const P_KAPOOR = 'c3020000-0000-4000-8000-0000000000d2'
const P_ELSE = 'c3020000-0000-4000-8000-0000000000d3'
const HALDI = 'c3020000-0000-4000-8000-0000000000e1' // 2026-11-10
const WEDDING = 'c3020000-0000-4000-8000-0000000000e2' // 2026-11-12, Ravi booked
const RECEPTION = 'c3020000-0000-4000-8000-0000000000e3' // 2026-11-30
const ENGAGEMENT = 'c3020000-0000-4000-8000-0000000000e4' // 2026-12-05, Kapoor
const UNDATED = 'c3020000-0000-4000-8000-0000000000e5'
const ELSE_SHOOT = 'c3020000-0000-4000-8000-0000000000e6' // another studio's

const box = vi.hoisted(() => ({ db: null as PGlite | null }))

interface Fragment {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}
const isFragment = (v: unknown): v is Fragment => typeof v === 'object' && v !== null && 'strings' in v && 'values' in v

function render(f: Fragment, params: unknown[] = []): { text: string; params: unknown[] } {
  let text = f.strings[0] ?? ''
  f.values.forEach((v, i) => {
    if (isFragment(v)) text += render(v, params).text
    else {
      params.push(v)
      text += `$${params.length}`
    }
    text += f.strings[i + 1] ?? ''
  })
  return { text, params }
}

vi.mock('../../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>()
  const tag = (strings: TemplateStringsArray, ...values: unknown[]): Fragment => ({ strings, values })
  return {
    ...actual,
    withUser: vi.fn(async (_env: unknown, uid: string, fn: (s: TransactionSql) => unknown) => {
      const db = box.db!
      const built = await fn(tag as unknown as TransactionSql)
      if (!isFragment(built)) throw new Error('the shoot reads hand back one statement')
      const { text, params } = render(built)
      return db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
        await tx.exec('set local role authenticated')
        return (await tx.query(text, params)).rows
      })
    }),
    withService: vi.fn(async () => {
      throw new Error('shoot reads run as the person, never as the service')
    }),
  }
})

const PEOPLE: Record<string, { userId: string; companyId: string; input: AccessInput }> = {
  owner: { userId: OWNER, companyId: STUDIO, input: { role: 'super_admin', isOwner: true } },
  ravi: { userId: RAVI, companyId: STUDIO, input: { role: 'employee', isOwner: false, profileKey: 'photographer' } },
  nitin: { userId: NITIN, companyId: STUDIO, input: { role: 'employee', isOwner: false, profileKey: 'photographer' } },
  other: { userId: OTHER, companyId: ELSEWHERE, input: { role: 'super_admin', isOwner: true } },
}

vi.mock('../../middleware/auth', () => ({
  requireAuth: async (c: Context<AppEnv>, next: Next) => {
    const who = PEOPLE[c.req.header('x-test-person') ?? '']!
    c.set('auth', {
      userId: who.userId,
      companyId: who.companyId,
      role: who.input.role,
      isOwner: who.input.isOwner,
      isPlatformAdmin: false,
      displayName: 'Test',
      email: 'test@example.test',
      planExpiry: null,
      access: resolveAccess(who.input),
    } as unknown as AuthContext)
    await next()
  },
}))

const { shootsRouter } = await import('./router')

const app = new Hono<AppEnv>()
app.use('*', requestId)
app.route('/shoots', shootsRouter)
app.onError(errorHandler)
const env = { ENVIRONMENT: 'test' } as AppEnv['Bindings']

async function get(who: keyof typeof PEOPLE, path: string) {
  const res = await app.request(path, { headers: { 'x-test-person': who } }, env)
  return { status: res.status, body: (await res.json()) as unknown }
}
const ids = (body: unknown) => (body as { id: string }[]).map((s) => s.id)

beforeAll(async () => {
  // Dates as "YYYY-MM-DD", the way the API's driver is set up (lib/db.ts).
  const db = new PGlite({ parsers: { 1082: (v: string) => v } })
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
      ('${OWNER}', 'asha@ashastudio.in'), ('${RAVI}', 'ravi@gmail.com'), ('${NITIN}', 'nitin@studio.test'), ('${OTHER}', 'x@other.in');
    insert into companies (id, name, owner_user_id) values
      ('${STUDIO}', 'Asha Studio', '${OWNER}'), ('${ELSEWHERE}', 'Other Studio', '${OTHER}');
    insert into users (user_id, company_id, role, name, email, status) values
      ('${OWNER}', '${STUDIO}', 'super_admin', 'Asha', 'asha@ashastudio.in', 'active'),
      ('${RAVI}', '${STUDIO}', 'employee', 'Ravi', 'ravi@gmail.com', 'active'),
      ('${NITIN}', '${STUDIO}', 'employee', 'Nitin', 'nitin@studio.test', 'active'),
      ('${OTHER}', '${ELSEWHERE}', 'super_admin', 'Other', 'x@other.in', 'active');
    insert into clients (id, company_id, name) values
      ('${MEHTA}', '${STUDIO}', 'Priya Mehta'), ('${KAPOOR}', '${STUDIO}', 'Riya Kapoor');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${P_MEHTA}', '${STUDIO}', '${MEHTA}', 'Mehta Wedding', 200000, '${OWNER}'),
      ('${P_KAPOOR}', '${STUDIO}', '${KAPOOR}', 'Kapoor 100% Engagement', 50000, '${OWNER}');
    insert into shoots (id, company_id, project_id, name, shoot_date) values
      ('${HALDI}', '${STUDIO}', '${P_MEHTA}', 'Haldi', '2026-11-10'),
      ('${WEDDING}', '${STUDIO}', '${P_MEHTA}', 'Wedding', '2026-11-12'),
      ('${RECEPTION}', '${STUDIO}', '${P_MEHTA}', 'Reception', '2026-11-30'),
      ('${ENGAGEMENT}', '${STUDIO}', '${P_KAPOOR}', 'Engagement', '2026-12-05'),
      ('${UNDATED}', '${STUDIO}', '${P_KAPOOR}', 'Pre-wedding', null);
    insert into team_assignment_slots (company_id, user_id, shoot_id, service_name, start_at, end_at, status)
      values ('${STUDIO}', '${RAVI}', '${WEDDING}', 'Candid', '2026-11-12 10:00+05:30', '2026-11-12 20:00+05:30', 'booked');
  `)
  // Another studio's project and shoot (seeded as the superuser, like the rest).
  await db.exec(`
    insert into clients (id, company_id, name) values ('c3020000-0000-4000-8000-0000000000c9', '${ELSEWHERE}', 'Elsewhere client');
    insert into projects (id, company_id, client_id, name, package_cost, created_by) values
      ('${P_ELSE}', '${ELSEWHERE}', 'c3020000-0000-4000-8000-0000000000c9', 'Mehta Elsewhere', 1000, '${OTHER}');
    insert into shoots (id, company_id, project_id, name, shoot_date) values
      ('${ELSE_SHOOT}', '${ELSEWHERE}', '${P_ELSE}', 'Wedding', '2026-11-15');
  `)
  box.db = db
})

describe('GET /shoots: a window on the shoot date', () => {
  it('without a window answers as before: every shoot of the studio', async () => {
    const { status, body } = await get('owner', '/shoots')
    expect(status).toBe(200)
    expect(ids(body)).toEqual([HALDI, WEDDING, RECEPTION, ENGAGEMENT, UNDATED])
  })

  it('from and to are inclusive, and an undated shoot is outside every window', async () => {
    const { body } = await get('owner', '/shoots?from=2026-11-12&to=2026-11-30')
    expect(ids(body)).toEqual([WEDDING, RECEPTION])
  })

  it('takes one end alone', async () => {
    expect(ids((await get('owner', '/shoots?from=2026-11-30')).body)).toEqual([RECEPTION, ENGAGEMENT])
    expect(ids((await get('owner', '/shoots?to=2026-11-10')).body)).toEqual([HALDI])
  })

  it('never reaches another studio’s shoots', async () => {
    expect(ids((await get('owner', '/shoots?from=2026-11-01&to=2026-11-30')).body)).not.toContain(ELSE_SHOOT)
    expect(ids((await get('other', '/shoots?from=2026-11-01&to=2026-11-30')).body)).toEqual([ELSE_SHOOT])
  })

  it('keeps a staff member to the shoots they are on', async () => {
    expect(ids((await get('ravi', '/shoots?from=2026-11-01&to=2026-11-30')).body)).toEqual([WEDDING])
    expect(ids((await get('nitin', '/shoots?from=2026-11-01&to=2026-11-30')).body)).toEqual([])
  })

  it('refuses a date that is not a date, or a window that ends before it starts', async () => {
    expect((await get('owner', '/shoots?from=2026-02-30')).status).toBe(422)
    expect((await get('owner', '/shoots?from=12-11-2026')).status).toBe(422)
    expect((await get('owner', '/shoots?from=2026-12-01&to=2026-11-01')).status).toBe(422)
  })
})

describe('GET /shoots?q=: the picker’s search', () => {
  it('matches the project, the client or the shoot, in any case', async () => {
    expect(ids((await get('owner', '/shoots?q=kapoor')).body)).toEqual([ENGAGEMENT, UNDATED])
    expect(ids((await get('owner', '/shoots?q=PRIYA')).body)).toEqual([HALDI, WEDDING, RECEPTION])
    expect(ids((await get('owner', '/shoots?q=haldi')).body)).toEqual([HALDI])
  })

  it('combines with the window, and takes % literally', async () => {
    expect(ids((await get('owner', '/shoots?q=mehta&from=2026-11-11&to=2027-01-10')).body)).toEqual([WEDDING, RECEPTION])
    expect(ids((await get('owner', '/shoots?q=100%25')).body)).toEqual([ENGAGEMENT, UNDATED])
    expect(ids((await get('owner', '/shoots?q=%25')).body)).toEqual([ENGAGEMENT, UNDATED])
  })
})

describe('GET /shoots/:id', () => {
  it('answers one shoot with its project and client', async () => {
    const { status, body } = await get('owner', `/shoots/${WEDDING}`)
    expect(status).toBe(200)
    expect(body).toMatchObject({ id: WEDDING, project_id: P_MEHTA, project_name: 'Mehta Wedding', client_name: 'Priya Mehta', shoot_date: '2026-11-12' })
  })

  it('is a 404 for another studio’s shoot, both ways', async () => {
    expect((await get('owner', `/shoots/${ELSE_SHOOT}`)).status).toBe(404)
    expect((await get('other', `/shoots/${WEDDING}`)).status).toBe(404)
  })

  it('is a 404 for staff not on the shoot, as the list hides it', async () => {
    expect((await get('ravi', `/shoots/${WEDDING}`)).status).toBe(200)
    expect((await get('ravi', `/shoots/${HALDI}`)).status).toBe(404)
    expect((await get('nitin', `/shoots/${WEDDING}`)).status).toBe(404)
  })

  it('is a 404 for an id that is not an id, and leaves the literal paths alone', async () => {
    expect((await get('owner', '/shoots/not-a-uuid')).status).toBe(404)
    expect((await get('owner', '/shoots/services')).status).toBe(200)
  })
})
