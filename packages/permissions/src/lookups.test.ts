import { describe, expect, it } from 'vitest'
import { canQuickAddLookup } from './lookups'
import type { ModuleKey } from './modules'

const can = (...mods: ModuleKey[]) => ({ hasAction: (key: ModuleKey) => mods.includes(key) })

describe('canQuickAddLookup', () => {
  it('lets the owner add to any list', () => {
    expect(canQuickAddLookup(can(), true, 'lead_source')).toBe(true)
  })
  it('lets whoever logs expenses add an expense category', () => {
    expect(canQuickAddLookup(can('company_expenses'), false, 'expense_category')).toBe(true)
  })
  it('keeps a list whose module the person cannot create in closed', () => {
    expect(canQuickAddLookup(can('crm'), false, 'expense_category')).toBe(false)
  })
  it('keeps an unlisted list owner-only', () => {
    expect(canQuickAddLookup(can('crm', 'billing', 'projects'), false, 'lead_source')).toBe(false)
  })
})
