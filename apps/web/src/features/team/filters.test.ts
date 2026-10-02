import { describe, expect, it } from 'vitest'
import type { DirectoryMember } from '@ipc/contracts'
import { EMPTY_FILTERS, hasActiveFilters, sortDirectory, toCsv } from './filters'

const member = (over: Partial<DirectoryMember> & { name: string }): DirectoryMember => ({
  user_id: `id-${over.name}`,
  email: null,
  role: 'employee',
  phone: null,
  alternate_phone: null,
  status: 'active',
  engagement_type: 'in_house',
  login_enabled: true,
  salary: null,
  freelancer_rate: null,
  rate_wedding_day: null,
  rate_half_day: null,
  address: null,
  payout_type: null,
  commission_pct: null,
  commission_basis: null,
  stipend_amount: null,
  pay_effective_from: null,
  pay_effective_to: null,
  compensation_notes: null,
  payment_type: null,
  pay_components: [],
  payment_status: 'active',
  created_at: '2026-06-01T10:00:00Z',
  role_names: [],
  role_ids: [],
  last_seen_at: null,
  ...over,
})

const ROWS: DirectoryMember[] = [
  member({
    name: 'Rahul',
    email: 'rahul@studio.in',
    phone: '9811111111',
    salary: 45000,
    role_ids: ['role-photo'],
    role_names: ['Photographer'],
    created_at: '2026-05-01T10:00:00Z',
  }),
  member({
    name: 'Anita',
    engagement_type: 'freelancer',
    salary: 12000,
    created_at: '2026-07-01T10:00:00Z',
  }),
  member({ name: 'Sana', role: 'manager', salary: 68000, created_at: '2026-06-15T10:00:00Z' }),
  member({
    name: 'Imran',
    engagement_type: 'freelancer',
    status: 'inactive',
    login_enabled: false,
    created_at: '2026-08-01T10:00:00Z',
  }),
]

const names = (rows: readonly DirectoryMember[]) => rows.map((r) => r.name)

describe('sortDirectory', () => {
  // Filtering moved to the directory endpoint, so the count under the pager
  // describes the list above it. Ordering stayed here: a sort rearranges the
  // page already on screen rather than choosing a different one.
  it('leaves the server order alone by default, newest first', () => {
    expect(names(sortDirectory(ROWS, 'newest'))).toEqual(['Imran', 'Anita', 'Sana', 'Rahul'])
  })

  it('sorts by name and by salary, with unknown salaries last', () => {
    expect(names(sortDirectory(ROWS, 'name'))).toEqual(['Anita', 'Imran', 'Rahul', 'Sana'])
    expect(names(sortDirectory(ROWS, 'salary_high'))).toEqual(['Sana', 'Rahul', 'Anita', 'Imran'])
    expect(names(sortDirectory(ROWS, 'salary_low'))).toEqual(['Anita', 'Rahul', 'Sana', 'Imran'])
  })

  it('does not mutate the rows it was given', () => {
    const original = names(ROWS)
    sortDirectory(ROWS, 'name')
    expect(names(ROWS)).toEqual(original)
  })

  it('knows when a filter is actually set', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: 'name' })).toBe(false)
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: 'a' })).toBe(true)
  })
})

describe('toCsv', () => {
  it('writes a header plus one line per row', () => {
    const csv = toCsv(ROWS.filter((r) => r.engagement_type === 'freelancer'))
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Name,Email,Phone')
    expect(lines).toHaveLength(3)
    expect(csv).toContain('Anita')
    expect(csv).toContain('Imran')
  })

  it('quotes anything that would break the format', () => {
    const csv = toCsv([member({ name: 'Roy, Jr.', address: 'He said "hi"' })])
    expect(csv).toContain('"Roy, Jr."')
  })

  it('exports the salary it was given — never more', () => {
    // Salary is blanked server-side for callers without team_salaries, so an
    // export cannot widen what the exporter could see.
    const csv = toCsv([member({ name: 'Hidden', salary: null })])
    expect(csv.split('\n')[1]).toContain('Hidden,,,,employee,,in_house,active,yes,,2026-06-01')
  })
})
