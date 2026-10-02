import { describe, expect, it } from 'vitest'
import { PROJECT_GROUPS, PROJECT_TABS, groupOf, viewsOf, visibleViews } from './ProjectTabs'

const everything = { module: () => true, action: () => true }
const staff = { module: (m: string) => !['company_expenses', 'tasks', 'team_payouts'].includes(m), action: () => false }

describe('project tabs', () => {
  it('is eight groups across the top, every view under exactly one of them', () => {
    expect(PROJECT_GROUPS.map((g) => g.label)).toEqual([
      'Overview', 'Quotation', 'Shoots', 'Post-production', 'Terms', 'Finance', 'Data', 'Referrals',
    ])
    const placed = PROJECT_GROUPS.flatMap((g) => [...g.views])
    expect([...placed].sort()).toEqual(PROJECT_TABS.map((t) => t.value).sort())
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('keeps the old addresses working: ?tab=expenses lights Finance, ?tab=tasks lights Post-production', () => {
    expect(groupOf('expenses')).toBe('finance')
    expect(groupOf('costs')).toBe('finance')
    expect(groupOf('billing')).toBe('finance')
    expect(groupOf('payouts')).toBe('finance')
    expect(groupOf('tasks')).toBe('production')
    expect(groupOf('completed_work')).toBe('production')
    expect(groupOf('deliverables')).toBe('production')
    expect(groupOf('shoots')).toBe('shoots')
  })

  it('opens a group on its first view, and on the first one this person may see', () => {
    expect(viewsOf('finance')[0]).toBe('billing')
    expect(viewsOf('production')[0]).toBe('deliverables')
    const seen = visibleViews(staff)
    expect(viewsOf('finance').filter((v) => seen.includes(v))).toEqual(['billing'])
    expect(viewsOf('production').filter((v) => seen.includes(v))).toEqual(['deliverables', 'completed_work'])
  })

  it('calls the tasks view Task Management', () => {
    expect(PROJECT_TABS.find((t) => t.value === 'tasks')?.label).toBe('Task Management')
  })

  it('keeps money from someone who runs projects without billing access', () => {
    const manager = { module: (m: string) => !['billing', 'money', 'company_expenses', 'team_payouts'].includes(m), action: () => true }
    const seen = visibleViews(manager)
    expect(viewsOf('finance').filter((v) => seen.includes(v))).toEqual([])
    expect(seen).toContain('deliverables')
    expect(seen).toContain('data')
  })

  it('shows everything to an owner', () => {
    expect(visibleViews(everything)).toEqual(PROJECT_TABS.map((t) => t.value))
  })
})
