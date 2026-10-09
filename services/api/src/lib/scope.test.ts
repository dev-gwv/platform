import { PGlite } from '@electric-sql/pglite'
import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveAccess, type AccessInput } from '@ipc/permissions'
import type { AppEnv, AuthContext } from '../context'
import { errorHandler } from '../middleware/errors'
import { requestId } from '../middleware/request-id'
import { NOT_YOURS, NO_MONEY, requireMoney, requireStudioWork, seesMoney, studioWork, worksOn } from './scope'

/**
 * Who sees what (CLAUDE.md: "Staff see their own work", "Money needs money
 * access"). The people below are resolved by the same resolveAccess the auth
 * middleware uses, so a profile that quietly gains billing shows up here.
 */
const PEOPLE = {
  owner: { role: 'super_admin', isOwner: true },
  admin: { role: 'admin', isOwner: false },
  manager: { role: 'manager', isOwner: false },
  projectManager: { role: 'employee', isOwner: false, profileKey: 'project_manager' },
  financeManager: { role: 'employee', isOwner: false, profileKey: 'finance_manager' },
  photographer: { role: 'employee', isOwner: false, profileKey: 'photographer' },
  crmExecutive: { role: 'employee', isOwner: false, profileKey: 'crm_executive' },
  employee: { role: 'employee', isOwner: false },
  // A photographer the owner handed billing to: money, and with it the studio's work.
  photographerWithBilling: {
    role: 'employee',
    isOwner: false,
    profileKey: 'photographer',
    overrides: [{ permission_key: 'billing', enabled: true }],
  },
} satisfies Record<string, AccessInput>

type Person = keyof typeof PEOPLE

const env = { ENVIRONMENT: 'test' } as AppEnv['Bindings']

function appFor(who: Person) {
  const input = PEOPLE[who]
  const auth = {
    userId: '00000000-0000-4000-8000-000000000001',
    companyId: '00000000-0000-4000-8000-0000000000aa',
    role: input.role,
    isOwner: input.isOwner,
    isPlatformAdmin: false,
    displayName: who,
    email: `${who}@example.test`,
    planExpiry: null,
    access: resolveAccess(input),
  } as unknown as AuthContext
  const app = new Hono<AppEnv>()
  app.use('*', requestId)
  app.use('*', async (c, next) => {
    c.set('auth', auth)
    await next()
  })
  app.get('/who', (c) => c.json({ money: seesMoney(c), studio: studioWork(c) }))
  app.get('/money', requireMoney, (c) => c.json({ ok: true }))
  app.get('/studio', requireStudioWork, (c) => c.json({ ok: true }))
  app.onError(errorHandler)
  return app
}

async function rules(who: Person) {
  const res = await appFor(who).request('/who', {}, env)
  return (await res.json()) as { money: boolean; studio: boolean }
}

describe('seesMoney: a project’s value, payments, billing and costs', () => {
  it('the owner sees money', async () => {
    expect((await rules('owner')).money).toBe(true)
  })

  it('a Project Manager runs projects and sees no money', async () => {
    expect(await rules('projectManager')).toEqual({ money: false, studio: true })
  })

  it('a plain admin or manager runs projects without money unless given it', async () => {
    expect(await rules('admin')).toEqual({ money: false, studio: true })
    expect(await rules('manager')).toEqual({ money: false, studio: true })
  })

  it('a Finance Manager (billing and money) sees money', async () => {
    expect((await rules('financeManager')).money).toBe(true)
  })

  it('billing access alone is enough', async () => {
    expect((await rules('photographerWithBilling')).money).toBe(true)
  })

  it('staff see no money', async () => {
    for (const who of ['photographer', 'crmExecutive', 'employee'] as const) {
      expect((await rules(who)).money, who).toBe(false)
    }
  })
})

describe('requireMoney', () => {
  it('lets the owner and a Finance Manager through', async () => {
    for (const who of ['owner', 'financeManager', 'photographerWithBilling'] as const) {
      const res = await appFor(who).request('/money', {}, env)
      expect(res.status, who).toBe(200)
    }
  })

  it('answers 403 in words to a Project Manager and to staff', async () => {
    for (const who of ['projectManager', 'admin', 'photographer', 'employee'] as const) {
      const res = await appFor(who).request('/money', {}, env)
      expect(res.status, who).toBe(403)
      expect(await res.json()).toEqual({ error: NO_MONEY })
    }
  })
})

describe('studioWork: every project, or only my own', () => {
  it('is the owner’s, and anyone’s who runs projects or handles money', async () => {
    for (const who of ['owner', 'admin', 'manager', 'projectManager', 'financeManager', 'photographerWithBilling'] as const) {
      expect((await rules(who)).studio, who).toBe(true)
    }
  })

  it('is not a photographer’s, a CRM executive’s or a plain employee’s', async () => {
    for (const who of ['photographer', 'crmExecutive', 'employee'] as const) {
      expect((await rules(who)).studio, who).toBe(false)
    }
  })

  it('never lets a person see money without the studio’s work', async () => {
    for (const who of Object.keys(PEOPLE) as Person[]) {
      const r = await rules(who)
      if (r.money) expect(r.studio, who).toBe(true)
    }
  })
})

describe('requireStudioWork', () => {
  it('gives staff without studio work a 403 that sends them to My work', async () => {
    for (const who of ['photographer', 'crmExecutive', 'employee'] as const) {
      const res = await appFor(who).request('/studio', {}, env)
      expect(res.status, who).toBe(403)
      expect(await res.json()).toEqual({ error: NOT_YOURS })
    }
    expect(NOT_YOURS).toContain('My work')
  })

  it('lets the owner, a Project Manager and a Finance Manager through', async () => {
    for (const who of ['owner', 'projectManager', 'financeManager'] as const) {
      const res = await appFor(who).request('/studio', {}, env)
      expect(res.status, who).toBe(200)
    }
  })
})

/**
 * worksOn builds a SQL fragment with postgres.js's `sql` tag. A stand-in tag
 * records the pieces, and `render` turns them into numbered parameters so the
 * fragment runs for real against PGlite, over tables carrying only the columns
 * it reads.
 */
interface Fragment {
  readonly strings: readonly string[]
  readonly values: readonly unknown[]
}
const isFragment = (v: unknown): v is Fragment =>
  typeof v === 'object' && v !== null && 'strings' in v && 'values' in v
const fakeSql = ((strings: TemplateStringsArray, ...values: unknown[]): Fragment => ({ strings, values })) as unknown as TransactionSql

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

const sqlTag = fakeSql as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Fragment

const ME = 'me'
const OTHER = 'someone-else'

describe('worksOn: the projects someone works on', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create table projects (id text primary key);
      create table shoots (id text primary key, project_id text not null);
      create table team_assignment_slots (shoot_id text not null, user_id text, status text not null, released_at timestamptz);
      create table deliverables (id text primary key, project_id text not null, assignee_id text);
      create table tasks (id text primary key, project_id text);
      create table task_assignees (task_id text not null, user_id text not null);
      create table invoices (id text primary key, project_id text not null);

      insert into projects values ('p-booked'), ('p-cancelled'), ('p-released'), ('p-edit'), ('p-task'),
                                  ('p-other'), ('p-nothing');
      insert into shoots values ('s-booked', 'p-booked'), ('s-cancelled', 'p-cancelled'),
                                ('s-released', 'p-released'), ('s-other', 'p-other');
      insert into team_assignment_slots values
        ('s-booked', '${ME}', 'confirmed', null),
        ('s-cancelled', '${ME}', 'cancelled', null),
        ('s-released', '${ME}', 'confirmed', now()),
        ('s-other', '${OTHER}', 'confirmed', null),
        ('s-other', null, 'open', null);
      insert into deliverables values ('d-mine', 'p-edit', '${ME}'), ('d-other', 'p-other', '${OTHER}'),
                                      ('d-nobody', 'p-nothing', null);
      insert into tasks values ('t-mine', 'p-task'), ('t-loose', null), ('t-other', 'p-other');
      insert into task_assignees values ('t-mine', '${ME}'), ('t-loose', '${ME}'), ('t-other', '${OTHER}');
      insert into invoices values ('i-edit', 'p-edit'), ('i-other', 'p-other'), ('i-booked', 'p-booked');
    `)
  })

  afterAll(async () => {
    await db.close()
  })

  async function projectsOf(me: string): Promise<string[]> {
    const q = render(sqlTag`select p.id from projects p where ${worksOn(fakeSql, me)} order by p.id`)
    const { rows } = await db.query<{ id: string }>(q.text, q.params)
    return rows.map((r) => r.id)
  }

  it('is a live booking, an edit given to them, or a task given to them -- and nothing else', async () => {
    expect(await projectsOf(ME)).toEqual(['p-booked', 'p-edit', 'p-task'])
  })

  it('does not count a cancelled or released booking', async () => {
    const mine = await projectsOf(ME)
    expect(mine).not.toContain('p-cancelled')
    expect(mine).not.toContain('p-released')
  })

  it('never reaches another person’s projects', async () => {
    expect(await projectsOf(OTHER)).toEqual(['p-other'])
    expect(await projectsOf('nobody-at-all')).toEqual([])
  })

  it('passes the person as a parameter, never spliced into the text', async () => {
    const q = render(worksOn(fakeSql, ME) as unknown as Fragment)
    expect(q.params).toEqual([ME, ME, ME])
    expect(q.text).not.toContain(`'${ME}'`)
    expect(await projectsOf(`x' or true --`)).toEqual([])
  })

  it('filters over another project column when one is named', async () => {
    const q = render(sqlTag`select i.id from invoices i where ${worksOn(fakeSql, ME, sqlTag`i.project_id` as never)} order by i.id`)
    expect(q.text).not.toContain('p.id')
    const { rows } = await db.query<{ id: string }>(q.text, q.params)
    expect(rows.map((r) => r.id)).toEqual(['i-booked', 'i-edit'])
  })
})
