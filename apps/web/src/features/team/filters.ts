import type { DirectoryMember } from '@ipc/contracts'

/**
 * Directory filtering, sorting and export — kept pure and out of the component
 * so the rules are testable and the table stays a rendering concern.
 */

/** The "All / Freelance" segmented control above the filter card. */
export type DirectoryTab = 'all' | 'freelance'

export type SortKey = 'newest' | 'oldest' | 'name' | 'salary_high' | 'salary_low'

export interface DirectoryFilters {
  q: string
  /** Engagement: '', 'in_house' or 'freelancer'. */
  type: string
  /** Member status: '', 'active', 'inactive' or 'pending'. */
  status: string
  /**
   * One control, two kinds of role: `app:<role>` is the access ladder,
   * `job:<uuid>` is a studio's own job role. Empty means every role.
   */
  role: string
  sort: SortKey
}

export const EMPTY_FILTERS: DirectoryFilters = {
  q: '',
  type: '',
  status: '',
  role: '',
  sort: 'newest',
}

export const hasActiveFilters = (f: DirectoryFilters): boolean =>
  Boolean(f.q || f.type || f.status || f.role)

// num(), matchesQuery(), matchesRole() and matchesSalary() lived here. They
// narrowed a page the server had already chosen, so the pager under the list
// disagreed with the list. The directory endpoint applies all four now --
// including the rule that a salary bound drops rows with no salary rather
// than reading a missing figure as zero.

const byName = (a: DirectoryMember, b: DirectoryMember) => a.name.localeCompare(b.name)

/** Nulls sink in both directions — an unknown salary is never the top result. */
const bySalary = (dir: 'high' | 'low') => (a: DirectoryMember, b: DirectoryMember) => {
  if (a.salary === null || b.salary === null) {
    if (a.salary === b.salary) return byName(a, b)
    return a.salary === null ? 1 : -1
  }
  if (a.salary === b.salary) return byName(a, b)
  return dir === 'high' ? b.salary - a.salary : a.salary - b.salary
}

const SORTS: Record<SortKey, (a: DirectoryMember, b: DirectoryMember) => number> = {
  newest: (a, b) => b.created_at.localeCompare(a.created_at) || byName(a, b),
  oldest: (a, b) => a.created_at.localeCompare(b.created_at) || byName(a, b),
  name: byName,
  salary_high: bySalary('high'),
  salary_low: bySalary('low'),
}

/**
 * Order a page of members.
 *
 * Kept separate from the filtering, which the server now does: a sort only
 * rearranges the rows already on screen, so doing it here is correct, while
 * filtering here would disagree with the total under the pager.
 */
export function sortDirectory(
  rows: readonly DirectoryMember[],
  sort: SortKey,
): DirectoryMember[] {
  return [...rows].sort(SORTS[sort])
}

// filterDirectory() used to live here. It narrowed the page the browser had
// already loaded while the pager went on counting every member, so
// "freelancers only" could show an empty page 1 of 4. The directory endpoint
// does the narrowing now; see supabase/tests/team-directory-filters.test.ts.

const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_HEADERS = [
  'Name',
  'Email',
  'Phone',
  'Alternate phone',
  'Access role',
  'Job roles',
  'Engagement',
  'Status',
  'Login',
  'Salary',
  'Joined',
] as const

/**
 * CSV of exactly what is on screen — the filtered rows, in their current order.
 * Salary is whatever the API returned, so an export can never widen what the
 * exporter was allowed to see.
 */
export function toCsv(rows: readonly DirectoryMember[]): string {
  const lines = rows.map((m) =>
    [
      m.name,
      m.email,
      m.phone,
      m.alternate_phone,
      m.role,
      m.role_names.join(' / '),
      m.engagement_type,
      m.status,
      m.login_enabled ? 'yes' : 'no',
      m.salary,
      m.created_at.slice(0, 10),
    ]
      .map(csvCell)
      .join(','),
  )
  return [CSV_HEADERS.join(','), ...lines].join('\n')
}
