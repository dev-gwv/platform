import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModuleKey } from '@ipc/permissions'
import { NAV, filterNav, navDestinations, type NavGroup, type NavLeaf } from './nav'
import { hubFor, TEAM_PAY } from './hubs'

const access = (mods: ModuleKey[]) =>
  ({ hasModule: (m: ModuleKey) => mods.includes(m) }) as unknown as Parameters<typeof filterNav>[2]

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
