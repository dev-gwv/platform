import { describe, expect, it } from 'vitest'
import type { PickableRole } from './bulk'
import { canOfferNew, chosenSummary, exactRole, filterRoles } from './role-picker'

const roles: PickableRole[] = [
  { key: 'a', type_name: 'Candid Photographer', role_code: 'candid_photographer', stage: 'production', owned: true },
  { key: 'lib:video_editor', type_name: 'Video Editor', role_code: 'video_editor', stage: 'post', owned: false },
  { key: 'b', type_name: 'Drone Operator', role_code: 'drone_operator', stage: 'production', owned: true },
]

describe('filterRoles', () => {
  it('returns everything when nothing is typed', () => {
    expect(filterRoles(roles, '  ')).toHaveLength(3)
  })
  it('matches anywhere in the name, ignoring case and spacing', () => {
    expect(filterRoles(roles, 'EDIT').map((r) => r.key)).toEqual(['lib:video_editor'])
    expect(filterRoles(roles, ' drone  operator ').map((r) => r.key)).toEqual(['b'])
  })
})

describe('exactRole / canOfferNew', () => {
  it('finds a role typed under its exact name', () => {
    expect(exactRole(roles, 'video editor')?.key).toBe('lib:video_editor')
    expect(canOfferNew(roles, 'Video Editor')).toBe(false)
  })
  it('offers a new role for an unknown name of two or more characters', () => {
    expect(canOfferNew(roles, 'Generator Assistant')).toBe(true)
    expect(canOfferNew(roles, 'G')).toBe(false)
    expect(canOfferNew(roles, '')).toBe(false)
  })
})

describe('chosenSummary', () => {
  it('lists up to two names and counts the rest', () => {
    expect(chosenSummary([])).toBe('')
    expect(chosenSummary(['A'])).toBe('A')
    expect(chosenSummary(['A', 'B'])).toBe('A, B')
    expect(chosenSummary(['A', 'B', 'C', 'D'])).toBe('A, B and 2 more')
  })
})
