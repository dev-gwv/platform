import { describe, expect, it } from 'vitest'
import { HOME, parentOf } from './parent-of'

describe('parentOf', () => {
  it('goes up to the nearest list page', () => {
    expect(parentOf('/follow-ups/setup')).toBe('/follow-ups')
    expect(parentOf('/projects/abc')).toBe('/projects')
    expect(parentOf('/projects/abc/edit')).toBe('/projects')
    expect(parentOf('/billing/invoices/inv1/edit')).toBe('/billing/invoices')
    expect(parentOf('/enquiry-forms/f1/')).toBe('/enquiry-forms')
  })

  it('skips parents that are only redirects, and falls back to the dashboard', () => {
    expect(parentOf('/settings/company')).toBe(HOME)
    expect(parentOf('/follow-ups')).toBe(HOME)
    expect(parentOf('/')).toBe(HOME)
  })
})
