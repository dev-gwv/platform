import { describe, expect, it } from 'vitest'
import { LEGACY_AUTHED_PATHS, LEGACY_PUBLIC_PATHS, legacyTarget } from './legacy-links'

describe('legacyTarget', () => {
  it('sends old CRM paths to the one lead list', () => {
    expect(legacyTarget('/leads')).toBe('/follow-ups')
    expect(legacyTarget('/leads/abc')).toBe('/follow-ups?lead=abc')
    expect(legacyTarget('/enquiries/xyz')).toBe('/follow-ups')
    expect(legacyTarget('/facebook/leads')).toBe('/follow-ups')
  })

  it('opens clients, tasks and team members where they live now', () => {
    expect(legacyTarget('/clients/new')).toBe('/clients?add=new')
    expect(legacyTarget('/clients/c1/edit')).toBe('/clients?client=c1')
    expect(legacyTarget('/tasks/t1')).toBe('/tasks?open=t1')
    expect(legacyTarget('/employees/new')).toBe('/employees?add=choose')
    expect(legacyTarget('/employees/salaries')).toBe('/payroll')
    expect(legacyTarget('/employees/u1/edit')).toBe('/employees/u1')
    expect(legacyTarget('/billing/inv1')).toBe('/billing/invoices/inv1')
  })

  it('keeps the query string, so public links keep their token', () => {
    expect(legacyTarget('/receipt/payment', '?token=abc&x=1')).toBe('/receipt?token=abc&x=1')
    expect(legacyTarget('/team-terms/acknowledge', 'token=t')).toBe('/team-terms?token=t')
    expect(legacyTarget('/register', '?ref=ig')).toBe('/login?ref=ig&mode=register')
  })

  it('ignores a trailing slash and leaves current paths alone', () => {
    expect(legacyTarget('/settings/')).toBe('/settings/company')
    expect(legacyTarget('/follow-ups')).toBeNull()
    expect(legacyTarget('/clients')).toBeNull()
  })

  it('has a rule behind every path the router registers', () => {
    const sample = (p: string) => p.replace(/\$[A-Za-z]+/g, 'id1')
    for (const p of [...LEGACY_AUTHED_PATHS, ...LEGACY_PUBLIC_PATHS]) expect(legacyTarget(sample(p)), p).not.toBeNull()
  })
})
