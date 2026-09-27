/**
 * Where an address from the old app lands today.
 *
 * Bookmarks, WhatsApp messages and old emails still carry the old app's paths
 * (`/leads/…`, `/clients/new`, `/receipt/payment?…`). Each one goes to the
 * page that does that job now, and never to "Not found".
 *
 * The query string is always carried over: the public links (receipts,
 * quotations, team terms, deliveries) keep their token there.
 */

type Rule = [pattern: RegExp, to: (m: RegExpMatchArray) => string]

const RULES: Rule[] = [
  // CRM: leads, enquiries and Facebook leads are one list now (0168).
  [/^\/leads\/([^/]+)$/, (m) => `/follow-ups?lead=${m[1]}`],
  [/^\/(leads|enquiries(\/[^/]+)?|facebook\/leads)$/, () => '/follow-ups'],
  // Clients open in a drawer on the list.
  [/^\/clients\/new$/, () => '/clients?add=new'],
  [/^\/clients\/([^/]+)(\/edit)?$/, (m) => `/clients?client=${m[1]}`],
  // Money.
  [/^\/billing\/([^/]+)$/, (m) => `/billing/invoices/${m[1]}`],
  [/^\/(company-expenses\/[^/]+|personal-expenses\/[^/]+)$/, () => '/company-expenses'],
  [/^\/financials\/gopo$/, () => '/financials'],
  // Team.
  [/^\/employees\/new$/, () => '/employees?add=choose'],
  [/^\/employees\/salaries$/, () => '/payroll'],
  [/^\/employees\/([^/]+)\/edit$/, (m) => `/employees/${m[1]}`],
  [/^\/team\/roles$/, () => '/settings/roles'],
  [/^\/team\/team-terms$/, () => '/settings/team-terms'],
  // Tasks open in a drawer on the list.
  [/^\/tasks\/([^/]+)$/, (m) => `/tasks?open=${m[1]}`],
  // Settings.
  [/^\/settings$/, () => '/settings/company'],
  [/^\/settings\/theme$/, () => '/settings/appearance'],
  // Public pages, one level up now.
  [/^\/team-terms\/acknowledge$/, () => '/team-terms'],
  [/^\/quotation\/acknowledge$/, () => '/quotation'],
  [/^\/receipt\/payment$/, () => '/receipt'],
  [/^\/delivery\/work$/, () => '/delivery'],
  [/^\/forgot-password$/, () => '/login?mode=forgot'],
  [/^\/register$/, () => '/login?mode=register'],
]

/** The old paths, as router patterns, so each gets a route. */
export const LEGACY_AUTHED_PATHS = [
  '/leads',
  '/leads/$leadId',
  '/enquiries',
  '/enquiries/$enquiryId',
  '/facebook/leads',
  '/clients/new',
  '/clients/$clientId',
  '/clients/$clientId/edit',
  '/billing/$invoiceId',
  '/company-expenses/$expenseId',
  '/personal-expenses/$expenseId',
  '/financials/gopo',
  '/employees/new',
  '/employees/salaries',
  '/employees/$uid/edit',
  '/team/roles',
  '/team/team-terms',
  '/tasks/$taskId',
  '/settings',
  '/settings/theme',
] as const

export const LEGACY_PUBLIC_PATHS = [
  '/team-terms/acknowledge',
  '/quotation/acknowledge',
  '/receipt/payment',
  '/delivery/work',
  '/forgot-password',
  '/register',
] as const

/**
 * The address to go to instead of `pathname` + `search`, or null when the
 * path is not an old one. The target's own query wins over the old one's on
 * a clash; everything else in the old query is kept.
 */
export function legacyTarget(pathname: string, search = ''): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  for (const [pattern, to] of RULES) {
    const m = path.match(pattern)
    if (!m) continue
    const target = to(m)
    const [base, own = ''] = target.split('?')
    const params = new URLSearchParams(search)
    for (const [k, v] of new URLSearchParams(own)) params.set(k, v)
    const q = params.toString()
    return q ? `${base}?${q}` : base!
  }
  return null
}
