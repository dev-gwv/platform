import type { TransactionSql } from 'postgres'
import type { Context } from 'hono'
import type { AppEnv } from '../../context'
import { fail } from '../../middleware/errors'
import { withUser, withService } from '../../lib/db'
import { attempt } from '../../lib/attempt'
import { grantableRoles, mayGrantRole, mayManageMember } from '@ipc/permissions'

export const duplicateCode = (code: string) => (code === '23505' ? ('duplicate' as const) : undefined)

// ── Running the team without being the owner ─────────────────────────────
// The owner can always add, edit and remove people. Anyone else can too when
// their access includes that Team Directory action -- with limits the owner
// does not have: never the owner or an admin, never their own record (that is
// My profile), never a role at or above their own (so nobody is made an
// admin), and never pay unless they also edit salaries. RLS lets only the
// owner write these tables, so a delegate's write goes through the service
// role AFTER these checks, always scoped to the caller's own studio.

export const DENIED_TEAM = 'You do not have access to this action.'

/** Pay fields: a delegate needs team_salaries edit to set any of them. */
export const PAY_KEYS = [
  'salary', 'freelancer_rate', 'rate_wedding_day', 'rate_half_day', 'payout_type', 'commission_pct', 'commission_basis', 'stipend_amount',
  'pay_effective_from', 'pay_effective_to', 'compensation_notes', 'payment_type', 'pay_components', 'payment_status',
] as const

export function teamGate(action: 'create' | 'edit' | 'delete') {
  return async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const auth = c.get('auth')
    if (!auth.isOwner && !auth.access.hasAction('team_directory', action)) fail(403, DENIED_TEAM)
    await next()
  }
}

export const actorOf = (c: Context<AppEnv>) => {
  const auth = c.get('auth')
  return { userId: auth.userId, role: auth.role, isOwner: auth.isOwner }
}

/** A delegate may hand out the base role, or one strictly below their own -- never admin. */
export function mayGrant(c: Context<AppEnv>, role: string | undefined): boolean {
  return !role || mayGrantRole(actorOf(c), role)
}

/** Does this body set pay? Defaults the form always sends (no components, 'active') do not count. */
export function setsPay(body: Record<string, unknown>): boolean {
  return PAY_KEYS.some((k) => {
    const v = body[k]
    if (v === undefined) return false
    if (k === 'pay_components') return Array.isArray(v) && v.length > 0
    if (k === 'payment_status') return v !== 'active'
    return v !== null
  })
}

export function mayTouchPay(c: Context<AppEnv>): boolean {
  const auth = c.get('auth')
  return auth.isOwner || auth.access.hasAction('team_salaries', 'edit')
}

/**
 * For a delegate: refuse the owner, an admin, themselves, or anyone at or
 * above their own level (see mayManageMember). Hands back the member's current
 * role. The owner passes straight through -- RLS already keeps them to their
 * own studio -- and gets null.
 */
export async function guardTarget(c: Context<AppEnv>, id: string, self = 'Change your own details from My profile.'): Promise<string | null> {
  const auth = c.get('auth')
  if (auth.isOwner) return null
  if (id === auth.userId) fail(409, self)
  const rows = await attempt(c, 'team.guard_target', () =>
    withService(c.env, (sql) => sql<{ role: string; is_owner: boolean }[]>`
      select u.role, (co.owner_user_id = u.user_id) as is_owner
        from users u join companies co on co.id = u.company_id
       where u.user_id = ${id} and u.company_id = ${auth.companyId} and u.deleted_at is null`),
  )
  if (!rows) fail(400, 'We could not check that team member.')
  const t = rows[0]
  if (!t) fail(404, 'We could not find that team member.')
  if (!mayManageMember(actorOf(c), { user_id: id, role: t.role, is_owner: t.is_owner })) {
    fail(403, t.is_owner || t.role === 'admin' || t.role === 'super_admin'
      ? 'Only the owner can change the owner or an admin.'
      : 'Only the owner or someone above them can change this member.')
  }
  return t.role
}

/** Invitations a delegate may see and act on: only for roles they could hand out. */
export function inviteScope(c: Context<AppEnv>, sql: TransactionSql) {
  const auth = c.get('auth')
  return auth.isOwner ? sql`true` : sql`role::text = any(${sql.array(grantableRoles(actorOf(c)), 1009)})`
}

/** The owner writes under RLS as always; a delegate, checked above, through the service role. */
export function asCaller<T>(c: Context<AppEnv>, fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
  const auth = c.get('auth')
  return auth.isOwner ? withUser(c.env, auth.userId, fn) : withService(c.env, fn)
}
