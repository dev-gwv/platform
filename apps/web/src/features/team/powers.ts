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
    /**
     * Set someone's email and password for them (Sign-in details): the owner
     * or an admin -- a password opens everything that person can see.
     */
    canSetSignIn: canEdit && (isOwner || session?.role === 'admin' || session?.role === 'super_admin'),
    /**
     * Anyone who may add people may add a job role while doing it -- no
     * closed field. Renaming and deleting roles stays the owner's.
     */
    canAddJobRoles: isOwner || access.hasAction('team_directory', 'create'),
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
