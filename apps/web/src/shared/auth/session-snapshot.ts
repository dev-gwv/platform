import { sessionState, type SessionState } from '@ipc/contracts'

/**
 * The last confirmed session, kept on the device so a new tab or a reload can
 * draw the shell and the kept pages at once while the server confirms who is
 * signed in (owner, 12 Nov: "like when you open up a folder on a laptop").
 *
 * It holds who and which studio, role, permissions, plan gate and setup state
 * -- what /auth/session answers -- and never a token: the key is named so it
 * cannot be mistaken for one, and the access token stays per tab in memory.
 * Only a 401/403 from /auth/refresh ends a session; that clears this too.
 */
export const SESSION_VIEW_KEY = 'ipc_session_view'

/** The kept session, or null when there is none or it no longer fits the contract. */
export function readSessionView(): SessionState | null {
  try {
    const raw = localStorage.getItem(SESSION_VIEW_KEY)
    if (!raw) return null
    const parsed = sessionState.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeSessionView(s: SessionState | null): void {
  try {
    if (s) localStorage.setItem(SESSION_VIEW_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_VIEW_KEY)
  } catch {
    /* private window or blocked storage: the app still works, one round trip slower */
  }
}

/**
 * Is the confirmed session the same as the one drawn from the device? Then the
 * drawn one is kept as it is, so nothing on screen re-renders for no change.
 */
export function sameSession(a: SessionState | null, b: SessionState | null): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Does the confirmed session belong to someone else, or another studio? Then
 * nothing drawn from the device may stay on screen.
 */
export function otherPerson(a: SessionState | null, b: SessionState | null): boolean {
  if (!a || !b) return false
  return a.user_id !== b.user_id || a.company_id !== b.company_id
}
