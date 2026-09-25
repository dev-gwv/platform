import type { ModuleKey } from './modules'

/**
 * Which studio lists anyone can grow from the form they are filling in.
 *
 * A studio's lists (Settings → Lookups) are managed by the owner, but adding
 * one new value while logging an expense or a payment should not need them:
 * whoever may create records in a module that uses the list may add to it. A
 * category missing here stays owner-only.
 */
export const LOOKUP_QUICK_ADD: Readonly<Record<string, readonly ModuleKey[]>> = {
  expense_category: ['company_expenses', 'projects'],
  payment_type: ['billing', 'projects', 'team_payouts'],
  invoice_line_preset: ['billing'],
  deliverable: ['projects'],
  data_type: ['projects'],
  project_type: ['crm'],
  enquiry_source: ['crm'],
  compensation_type: ['team_directory'],
}

/** May this person add a value to this list from a form? */
export function canQuickAddLookup(
  access: { hasAction: (key: ModuleKey, action: 'create') => boolean },
  isOwner: boolean,
  category: string,
): boolean {
  if (isOwner) return true
  return (LOOKUP_QUICK_ADD[category] ?? []).some((mod) => access.hasAction(mod, 'create'))
}
