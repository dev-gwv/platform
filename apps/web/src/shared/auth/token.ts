/**
 * Token store (replaces the Supabase session).
 *
 * Access token: 30 minutes, kept in memory and mirrored to sessionStorage so a
 * reload in the same tab does not need a round trip. Never localStorage.
 *
 * Refresh token: 30 days. Two modes, decided by the API:
 *   - body mode (default): the token arrives in the response body and is kept
 *     in localStorage so every tab can rotate.
 *   - cookie mode (AUTH_COOKIE=1 on the API): the body carries an empty
 *     refresh_token and the real one lives in an HttpOnly cookie on the API
 *     origin. Nothing is stored here; rotation sends the cookie.
 */
const KEY = 'ipc_access_token'
const REFRESH_KEY = 'ipc_refresh_token'

let accessToken: string | null = null

const read = (store: Storage | undefined, k: string): string | null => {
  try {
    return store?.getItem(k) ?? null
  } catch {
    return null
  }
}

const write = (store: Storage | undefined, k: string, v: string): void => {
  try {
    store?.setItem(k, v)
  } catch {
    /* storage disabled — session won't persist across reloads */
  }
}

const remove = (store: Storage | undefined, k: string): void => {
  try {
    store?.removeItem(k)
  } catch {
    /* no-op */
  }
}

const session = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)
const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage)

export function getToken(): string | null {
  accessToken ??= read(session(), KEY)
  return accessToken
}

/** The refresh token, when this client holds one (body mode). */
export function getRefreshToken(): string | null {
  return read(local(), REFRESH_KEY)
}

function setToken(token: string): void {
  accessToken = token
  write(session(), KEY, token)
}

/** Persist a freshly minted pair (sign-in, or a rotation). */
export function setTokens(pair: { access_token: string; refresh_token: string }): void {
  setToken(pair.access_token)
  // An empty refresh token means the API keeps it in its cookie.
  if (pair.refresh_token) write(local(), REFRESH_KEY, pair.refresh_token)
  else remove(local(), REFRESH_KEY)
}

export function clearToken(): void {
  accessToken = null
  remove(session(), KEY)
  remove(local(), REFRESH_KEY)
}

// A sign-in or sign-out in another tab should be felt here too: the access
// token is per tab, so the shared signal is the refresh token key.
export function onSessionChange(fn: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === REFRESH_KEY || e.key === null) fn()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
