import type { Context, Next } from 'hono'
import { resolveAccess, type AppRole } from '@ipc/permissions'
import type { PlanGate } from '@ipc/contracts'
import type { AppEnv, AuthContext } from '../context'
import { fail } from './errors'
import { verifyToken } from '../lib/auth-token'
import { withUser } from '../lib/db'
import * as Sentry from '@sentry/bun'

function bearer(c: Context<AppEnv>): string {
  const h = c.req.header('Authorization') ?? ''
  const [scheme, token] = h.split(' ')
  if (scheme !== 'Bearer' || !token) fail(401, 'Please sign in to continue.')
  return token
}

interface AuthContextRow {
  company_id: string
  role: AppRole
  is_owner: boolean
  is_platform_admin: boolean
  display_name: string
  email: string
  plan_expiry: string | null
  plan_gate: PlanGate
  profile_key: string | null
  overrides: { permission_key: string; enabled: boolean }[] | null
  password_changed_at: string | null
  password_version: number
}

/**
 * Resolve identity + tenant + effective access, once per request.
 *   1. verify the app JWT locally (no auth server round-trip)
 *   2. run get_auth_context() as the caller inside an RLS-scoped transaction
 *      (withUser sets auth.uid() via the request.jwt.claim.sub GUC)
 *   3. reject tokens older than the last password change
 *   4. compose effective permissions with the shared resolver
 */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const token = bearer(c)
  const claims = await verifyToken(c.env, token)
  if (!claims) fail(401, 'Your session has expired. Please sign in again.')
  const auth = await authContextFor(c, claims.uid, claims.pwv)

  // Who and which studio, on every event and span raised for the rest of this
  // request. Without it a Sentry issue says a thing broke but not for whom,
  // and in a multi-tenant product "one studio" and "everyone" are the same
  // stack trace with very different urgency.
  //
  // Deliberately id-only: no name, no email. sendDefaultPii is off for the
  // same reason, and a support question is answerable from the user id.
  Sentry.setUser({ id: claims.uid })
  Sentry.setTag('company_id', auth.companyId)
  Sentry.setTag('role', auth.role)

  c.set('auth', auth)

  await next()
}

/**
 * Steps 2-4 for a user id and password version already proven (a verified
 * access token, or a refresh just rotated). Fails 403 with no studio and 401
 * on a stale password version, as requireAuth always has.
 */
export async function authContextFor(c: Context<AppEnv>, uid: string, pwv: number): Promise<AuthContext> {
  const row = await withUser(c.env, uid, async (sql) => {
    const rows = await sql<AuthContextRow[]>`select * from get_auth_context()`
    return rows[0]
  })
  if (!row) fail(403, 'No studio is linked to this account.')

  // Tokens are stateless, so a password reset can't revoke them directly:
  // anything carrying a stale password_version is refused here instead.
  if (pwv !== row.password_version) {
    fail(401, 'Your password was changed. Please sign in again.')
  }

  const access = resolveAccess({
    role: row.role,
    isOwner: row.is_owner,
    profileKey: row.profile_key,
    overrides: row.overrides ?? [],
  })

  return {
    userId: uid,
    companyId: row.company_id,
    role: row.role,
    isOwner: row.is_owner,
    isPlatformAdmin: row.is_platform_admin ?? false,
    displayName: row.display_name,
    email: row.email,
    planGate: row.plan_gate,
    planExpiry: row.plan_expiry,
    access,
  }
}
