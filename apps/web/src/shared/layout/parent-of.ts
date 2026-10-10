/**
 * Where "Back" goes when there is no page to go back to in this tab — a link
 * opened from WhatsApp, a bookmark, a refresh: the nearest list page above
 * this one, or the dashboard.
 *
 * Only real list pages are listed: several parents in between are old-app
 * redirects (/settings, /billing/$id) that would bounce you straight back.
 */
const LIST_PAGES = new Set([
  '/follow-ups',
  '/clients',
  '/enquiry-forms',
  '/lead-sources',
  '/projects',
  '/tasks',
  '/production-board',
  '/team-allocation',
  '/employees',
  '/attendance',
  '/billing',
  '/billing/invoices',
  '/billing/payments',
  '/company-expenses',
  '/financials',
  '/payroll',
  '/team-payouts',
  '/reports',
  '/my-work',
  '/data-management',
  '/notifications',
])

export const HOME = '/dashboard'

export function parentOf(pathname: string): string {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  for (let n = parts.length - 1; n > 0; n--) {
    const up = `/${parts.slice(0, n).join('/')}`
    if (LIST_PAGES.has(up)) return up
  }
  return HOME
}
