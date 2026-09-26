import { grantableRoles, mayManageMember } from '@ipc/permissions'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

/**
 * What the signed-in person may do to the team. The owner may do everything;
 * someone given Team Directory actions may add, edit and remove people below
 * them (never the owner or an admin, never themselves), hand out only a role
 * below their own, and set pay only if they also edit salaries. The API
 * enforces the same rules with the same functions -- this only decides which
 * buttons are worth showing.
 */
export function useTeamPowers() {
  const { session } = useAuth()
  const access = useAccess()
  const isOwner = !!session?.is_owner
  const actor = { userId: session?.user_id ?? '', role: session?.role ?? 'employee', isOwner }
  const canEdit = isOwner || access.hasAction('team_directory', 'edit')
  const canDelete = isOwner || access.hasAction('team_directory', 'delete')
  const roles = grantableRoles(actor)
  return {
    isOwner,
    canCreate: isOwner || access.hasAction('team_directory', 'create'),
    canEdit,
    canDelete,
    /** Pay fields: the owner, or whoever edits salaries. */
    canPay: isOwner || access.hasAction('team_salaries', 'edit'),
    /** Job roles are the studio's own list: only the owner adds to it. */
    canAddJobRoles: isOwner,
    roles,
    mayGrant: (role: string) => (roles as string[]).includes(role),
    row: (m: { user_id: string; role: string }) => {
      const ok = mayManageMember(actor, m)
      return { edit: canEdit && ok, remove: canDelete && ok && m.user_id !== actor.userId }
    },
  }
}

export const ROLE_LABEL: Record<'admin' | 'manager' | 'employee', string> = {
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
}

/**
 * The same ladder in the words the add-people screens use: "What can they
 * see?" -- a team member sees their own work, a manager runs the studio's
 * projects, an admin sees everything but the owner's settings.
 */
export const CAN_SEE_LABEL: Record<'admin' | 'manager' | 'employee', string> = {
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Team member',
}

export const CAN_SEE_HINT: Record<'admin' | 'manager' | 'employee', string> = {
  employee: 'Only their own shoots and tasks.',
  manager: 'Every project and the production board.',
  admin: 'Everything except owner-only settings and salaries.',
}

/** "Works as": on salary (in-house) or per shoot (freelancer). */
export const WORKS_AS_LABEL: Record<'in_house' | 'freelancer', string> = {
  in_house: 'On salary',
  freelancer: 'Per shoot',
}

const PAY_KEYS = [
  'salary', 'freelancer_rate', 'payout_type', 'commission_pct', 'commission_basis', 'stipend_amount',
  'pay_effective_from', 'pay_effective_to', 'compensation_notes', 'payment_type',
] as const

/** The same request with no pay in it -- for someone who does not handle salaries. */
export function withoutPay<T extends Record<string, unknown>>(body: T): T {
  const out: Record<string, unknown> = { ...body }
  for (const k of PAY_KEYS) delete out[k]
  if ('pay_components' in out) out.pay_components = []
  if ('payment_status' in out) out.payment_status = 'active'
  return out as T
}
