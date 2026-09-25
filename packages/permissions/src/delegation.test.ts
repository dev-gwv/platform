import { describe, expect, it } from 'vitest'
import { grantableRoles, mayGrantRole, mayManageMember } from './delegation'

const owner = { userId: 'o', role: 'super_admin', isOwner: true }
const admin = { userId: 'a', role: 'admin', isOwner: false }
const manager = { userId: 'm', role: 'manager', isOwner: false }
const employee = { userId: 'e', role: 'employee', isOwner: false }

describe('delegated team management', () => {
  it('the owner hands out any role; others only what sits below them, never admin', () => {
    expect(grantableRoles(owner)).toEqual(['admin', 'manager', 'employee'])
    expect(grantableRoles(admin)).toEqual(['manager', 'employee'])
    expect(grantableRoles(manager)).toEqual(['employee'])
    expect(grantableRoles(employee)).toEqual(['employee'])
    expect(mayGrantRole(manager, 'manager')).toBe(false)
    expect(mayGrantRole(admin, 'admin')).toBe(false)
  })

  it('nobody but the owner touches the owner or an admin, and nobody manages themselves here', () => {
    const theOwner = { user_id: 'o', role: 'super_admin', is_owner: true }
    const anAdmin = { user_id: 'a2', role: 'admin' }
    expect(mayManageMember(admin, theOwner)).toBe(false)
    expect(mayManageMember(admin, anAdmin)).toBe(false)
    expect(mayManageMember(owner, anAdmin)).toBe(true)
    expect(mayManageMember(manager, { user_id: 'm', role: 'manager' })).toBe(false)
  })

  it('a delegate manages people below them, and plain employees', () => {
    expect(mayManageMember(admin, { user_id: 'm2', role: 'manager' })).toBe(true)
    expect(mayManageMember(manager, { user_id: 'm2', role: 'manager' })).toBe(false)
    expect(mayManageMember(manager, { user_id: 'e2', role: 'employee' })).toBe(true)
    expect(mayManageMember(employee, { user_id: 'e2', role: 'employee' })).toBe(true)
  })
})
