import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModuleKey } from '@ipc/permissions'
import { NAV, filterNav, navDestinations, type NavGroup, type NavLeaf } from './nav'
import { hubFor, MY_TIME, TEAM_PAY, TEAM_TIME } from './hubs'

const access = (mods: ModuleKey[], writes: string[] = ['projects.edit']) =>
  ({
    hasModule: (m: ModuleKey) => mods.includes(m),
    hasAction: (m: ModuleKey, a: string) => (a === 'view' ? mods.includes(m) : writes.includes(`${m}.${a}`)),
  }) as unknown as Parameters<typeof filterNav>[2]

const ALL: ModuleKey[] = [
  'team_directory',
  'team_work_preview',
  'attendance',
  'team_salaries',
  'team_payouts',
  'team_roles',
  'team_terms',
]

const team = (mods: ModuleKey[]) =>
  (filterNav(NAV, 'admin', access(mods), false).find((e) => e.kind === 'group' && e.label === 'Team') as
    | NavGroup
    | undefined)

describe('the Team menu', () => {
  it('is four hubs, not nine links', () => {
    expect(team(ALL)?.children.map((c) => c.label)).toEqual(['People', 'Attendance & leave', 'Pay', 'Roles & terms'])
  })

  it('links a hub to the first page this person can open, and hides it when none', () => {
    const pay = team(['team_payouts'])?.children.find((c) => c.label === 'Pay')
    expect(pay?.to).toBe('/team-payouts')
    expect(pay?.hub?.map((t) => t.to)).toEqual(['/team-payouts'])
    expect(team(['attendance'])?.children.map((c) => c.label)).toEqual(['Attendance & leave'])
  })

  it('still lets search find every page by its own name', () => {
    const labels = navDestinations('admin', access(ALL), false).map((l) => l.label)
    for (const l of ['Directory', 'Performance', 'Leave & holidays', 'Payroll', 'Team payouts', 'Team terms'])
      expect(labels).toContain(l)
  })

  it('draws a tab row only on the exact pages of a hub', () => {
    expect(hubFor('/payroll')).toBe(TEAM_PAY)
    expect(hubFor('/team-payouts/')).toBe(TEAM_PAY)
    expect(hubFor('/employees/abc')).toBeNull()
    expect(hubFor('/settings/roles')).toBeNull()
  })
})

describe('the staff menu', () => {
  const labels = (entries: ReturnType<typeof filterNav>) =>
    entries.flatMap((e) => (e.kind === 'leaf' ? [e.label] : e.children.map((c) => c.label)))

  it('is their own day and their own work, never the studio\'s', () => {
    const staff = labels(filterNav(NAV, 'employee', access(['dashboard', 'projects', 'personal_expenses'], []), false))
    expect(staff.slice(0, 6)).toEqual(['Home', 'My Work', 'My Shoots', 'Attendance & leave', 'My payouts', 'My performance'])
    // My Tasks folded into My work: the same tasks, one place.
    for (const hidden of ['My Tasks', 'Projects', 'Post-production', 'Shoots', 'Data & Backup', 'Money', 'Activity'])
      expect(staff).not.toContain(hidden)
  })

  it('keeps the studio\'s work for those who run projects', () => {
    const admin = labels(filterNav(NAV, 'admin', access(['dashboard', 'projects']), false))
    expect(admin).toContain('Home')
    expect(admin).toContain('Projects')
    expect(admin).toContain('Shoots')
    expect(admin).toContain('Post-production')
  })

  it('puts a person\'s attendance and leave under one tab row', () => {
    const staffCan = (m: ModuleKey) => m === 'dashboard'
    expect(hubFor('/leave', staffCan)).toBe(MY_TIME)
    expect(hubFor('/attendance/my', staffCan)).toBe(MY_TIME)
    expect(hubFor('/leave', (m) => m === 'attendance' || m === 'dashboard')).toBe(TEAM_TIME)
  })
})

describe('the studio menu', () => {
  it('is twelve lines, one word for each thing', () => {
    const every = [
      ...ALL, 'dashboard', 'crm', 'clients', 'projects', 'tasks', 'billing', 'company_expenses', 'financials',
      'reports', 'settings',
    ] as ModuleKey[]
    const lines = filterNav(NAV, 'admin', access(every), false).map((e) => e.label)
    expect(lines).toEqual([
      'Home', 'Leads', 'Clients', 'Projects', 'Shoots', 'Post-production', 'Tasks', 'Data & Backup', 'Money',
      'Team', 'Reports', 'Settings',
    ])
  })

  it('opens Money on what is due, and Projects with its Needs attention tab', () => {
    expect(hubFor('/billing/invoices')?.map((t) => t.label)).toEqual(['Payments', 'Invoices', 'Expenses', 'Profit & Loss'])
    expect(hubFor('/project-tracking')?.map((t) => t.to)).toEqual(['/projects', '/project-tracking'])
    const money = filterNav(NAV, 'admin', access(['company_expenses']), false).find((e) => e.label === 'Money') as NavLeaf
    expect(money.to).toBe('/company-expenses')
  })
})

describe('money icons', () => {
  it('never use a dollar sign', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []
      })
    const root = join(__dirname, '..', '..')
    const hits = walk(root).filter((p) => !p.endsWith('hubs.test.ts') && /\bDollarSign\b/.test(readFileSync(p, 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('the Settings entry', () => {
  const settings = (mods: ModuleKey[]) =>
    filterNav(NAV, 'admin', access(mods), false).find(
      (e): e is NavLeaf => e.kind === 'leaf' && e.label === 'Settings',
    )

  it('still needs the settings permission, whatever else is open', () => {
    expect(settings(['projects', 'billing'])).toBeUndefined()
    expect(settings(['settings'])?.to).toBe('/settings/company')
  })

  it('does not also claim the pages the Team menu lights', () => {
    const s = settings(['settings', 'team_roles', 'team_terms'])
    expect(s?.hub?.some((t) => t.to === '/settings/roles')).toBe(false)
  })
})
