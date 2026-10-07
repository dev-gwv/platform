import type { Env } from '../context'
import { withService } from './db'
import { hashPassword } from './auth-token'

/**
 * The old app's people keep their passwords (0249).
 *
 * tools/legacy-import made their logins with no password: the password still
 * lives in the old app's Firebase project, and we never had its hashes. On
 * the first sign-in here, the email and password are put to Firebase once;
 * when Firebase says yes, the password becomes ours (argon2id) and the
 * legacy_logins row goes, so Firebase is never asked about that person again.
 *
 * FIREBASE_WEB_API_KEY is the old app's public web key (it shipped in every
 * browser). Unset, nobody is asked and they use Forgot password.
 */
export async function firebasePasswordOk(apiKey: string, email: string, password: string): Promise<boolean> {
  if (!apiKey) return false
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: false }),
        signal: AbortSignal.timeout(8000),
      },
    )
    return res.ok
  } catch {
    return false
  }
}

/**
 * True when `userId` is an imported login still waiting for its password and
 * Firebase accepts this one; the password is then saved as the login's own.
 */
export async function adoptLegacyPassword(env: Env, userId: string, email: string, password: string): Promise<boolean> {
  const waiting = await withService(env, (sql) =>
    sql<{ user_id: string }[]>`select user_id from legacy_logins where user_id = ${userId}`,
  )
  if (!waiting[0]) return false
  if (!(await firebasePasswordOk(env.FIREBASE_WEB_API_KEY, email, password))) return false
  const hash = await hashPassword(password)
  await withService(env, async (sql) => {
    // Only a login that still has no password: never overwrite one set meanwhile.
    await sql`
      update auth.users set encrypted_password = ${hash}, password_changed_at = now()
       where id = ${userId} and encrypted_password is null`
    await sql`delete from legacy_logins where user_id = ${userId}`
  })
  return true
}
