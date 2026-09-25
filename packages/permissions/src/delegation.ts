import { ROLE_RANK, type AppRole } from './roles'

/**
 * Running the team without being the owner.
 *
 * The owner can change anyone. Someone the owner trusted with Team Directory
 * actions can change people BELOW them on the role ladder (and plain
 * employees) -- never the owner, never an admin, never themselves (that is
 * My profile), and they can hand out only a role below their own, so nobody is
 * ever made an admin except by the owner. The API enforces this; the web uses
 * the same function to decide which rows show Edit and Remove.
 */
export interface Actor {
  userId: string
  role: string
  isOwner: boolean
}

export interface Target {
  user_id: string
  role: string
  is_owner?: boolean
}

const rank = (role: string): number => ROLE_RANK[role as AppRole] ?? 0

/** The roles this person may give someone (the owner: any assignable one). */
export function grantableRoles(actor: Pick<Actor, 'role' | 'isOwner'>): ('admin' | 'manager' | 'employee')[] {
  if (actor.isOwner) return ['admin', 'manager', 'employee']
  return (['manager', 'employee'] as const).filter((r) => r === 'employee' || rank(r) < rank(actor.role))
}

export function mayGrantRole(actor: Pick<Actor, 'role' | 'isOwner'>, role: string): boolean {
  return (grantableRoles(actor) as string[]).includes(role)
}

/** May this person edit or remove this member at all (their own access to the action aside)? */
export function mayManageMember(actor: Actor, target: Target): boolean {
  if (actor.isOwner) return !target.is_owner || target.user_id === actor.userId
  if (target.user_id === actor.userId) return false
  if (target.is_owner || target.role === 'super_admin' || target.role === 'admin') return false
  return target.role === 'employee' || rank(target.role) < rank(actor.role)
}
