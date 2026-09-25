import { authToken, storedFile, type StoredFile, type z } from '@ipc/contracts'
import { config } from '../config'
import { getToken, getRefreshToken, setTokens, clearToken } from '../auth/token'
import { MOCK_ENABLED, mockResponse, NOT_MOCKED } from '../dev/mock'

/**
 * THE api client. Every call to services/api goes through here — never a
 * per-module copy. Injects the bearer token, validates the response against its
 * zod contract, and surfaces the server's error string as-is.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public correlationId?: string | null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Sign-in paths: a 401 here is bad credentials, not an aged-out token. */
const UNAUTHENTICATED_PATHS = new Set([
  '/auth/refresh',
  '/auth/login',
  '/auth/register',
  '/auth/verify',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/resend-verification',
  '/auth/invite',
  '/auth/accept-invite',
])

/**
 * In-flight rotation, shared by every caller that hits a 401 at once — a
 * refresh token is single-use, so a burst of parallel refreshes would spend
 * each other's tokens and look like theft to the server.
 */
let rotating: Promise<boolean> | null = null

/**
 * Called when a refresh is refused outright, so AuthProvider can drop the
 * session and let the route guard bounce to /login. Without it a dead session
 * leaves the shell rendered with every panel erroring.
 */
let onAuthLost: (() => void) | null = null
export function setAuthLostHandler(fn: (() => void) | null): void {
  onAuthLost = fn
}

/**
 * Rotate the session. In body mode the stored refresh token is sent; in cookie
 * mode there is nothing stored and the browser sends the HttpOnly cookie. With
 * neither (never signed in here) there is nothing to try.
 */
export async function rotateTokens(): Promise<boolean> {
  const before = getRefreshToken()
  if (!before && !hasCookieSession()) return false

  rotating ??= (async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(before ? { refresh_token: before } : {}),
      })
      if (!res.ok) {
        // Only an auth refusal means the session is over. A 429 from the shared
        // per-IP limit, a 5xx mid-deploy, or the 60s grace-window 401 that the
        // LOSER of a two-tab race gets are all survivable — clearing here would
        // also wipe the winning tab's freshly stored pair.
        if (res.status === 401 || res.status === 403) {
          if (getRefreshToken() === before) clearToken()
          markCookieSession(false)
          onAuthLost?.()
        }
        return false
      }
      const parsed = authToken.safeParse(await res.json().catch(() => null))
      if (!parsed.success) return false
      // The store may have been cleared by a sign-out while this was in flight;
      // writing then would resurrect the session we were told to end.
      if (getRefreshToken() !== before) return false
      setTokens(parsed.data)
      markCookieSession(!parsed.data.refresh_token)
      return true
    } catch {
      return false // network blip: keep the tokens, let the caller fail
    } finally {
      rotating = null
    }
  })()

  const ok = await rotating
  if (ok) return true
  // Another tab may have rotated while we waited; only a token that is actually
  // present counts — a cleared store is a failure, not someone else's success.
  const after = getRefreshToken()
  return !!after && after !== before
}

/**
 * Whether this browser is believed to hold a refresh cookie. The cookie is
 * HttpOnly, so it cannot be read; it is remembered from the last sign-in that
 * answered with an empty body token, and forgotten on refusal or sign-out.
 */
const COOKIE_FLAG = 'ipc_cookie_session'
function hasCookieSession(): boolean {
  try {
    return localStorage.getItem(COOKIE_FLAG) === '1'
  } catch {
    return false
  }
}
export function markCookieSession(on: boolean): void {
  try {
    if (on) localStorage.setItem(COOKIE_FLAG, '1')
    else localStorage.removeItem(COOKIE_FLAG)
  } catch {
    /* no-op */
  }
}

interface CallOptions<TOut extends z.ZodTypeAny> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Contract the response is parsed against. */
  responseSchema: TOut
  signal?: AbortSignal
}

export async function callApi<TOut extends z.ZodTypeAny>(
  path: string,
  opts: CallOptions<TOut>,
): Promise<z.infer<TOut>> {
  const method = opts.method ?? 'GET'

  // DEV UI-preview short-circuit — never reached in production.
  if (MOCK_ENABLED) {
    const canned = mockResponse(path, method, opts.body)
    if (canned !== NOT_MOCKED) return opts.responseSchema.parse(canned)
  }

  const send = () => {
    const token = getToken()
    const init: RequestInit = {
      method,
      // The refresh cookie lives on /auth; sending credentials there is what
      // makes cookie mode work, and it is harmless elsewhere.
      credentials: path.startsWith('/auth/') ? 'include' : 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
    }
    if (opts.signal) init.signal = opts.signal
    return fetch(`${config.apiBaseUrl}${path}`, init)
  }

  let res = await send()

  // Access tokens are short-lived by design, so a 401 is the normal way we
  // learn one has aged out: rotate and replay, once. Only the endpoints that
  // establish a session are exempt (a 401 there means bad credentials, and
  // /auth/refresh must not recurse). Authenticated /auth/* routes are NOT
  // exempt: skipping rotation on /auth/logout-all turned "sign out everywhere"
  // into a silent no-op for any tab idle past the access-token TTL.
  // Match on the path alone: /auth/invite carries the token as a query string.
  const canRotate = !UNAUTHENTICATED_PATHS.has(path.split('?')[0]!)
  if (res.status === 401 && canRotate && (await rotateTokens())) {
    res = await send()
  }

  const json: unknown = await res.json().catch(() => ({}))
  // Every response carries X-Request-Id; failures also set X-Correlation-Id
  // (the same value). Either one is what support greps the logs for.
  const correlationId =
    res.headers.get('X-Correlation-Id') ??
    res.headers.get('X-Request-Id') ??
    (typeof json === 'object' && json && 'correlation_id' in json
      ? String((json as { correlation_id: unknown }).correlation_id)
      : null)

  if (!res.ok) {
    const msg =
      typeof json === 'object' && json && 'error' in json
        ? String((json as { error: unknown }).error)
        : 'Request failed.'
    throw new ApiError(res.status, msg, correlationId)
  }

  return opts.responseSchema.parse(json)
}

/**
 * Fetch a file the API guards and hand it to the browser as a download.
 *
 * A plain <a href download> cannot carry the Authorization header — the
 * access token is never a cookie — so every such link came back 401. This
 * asks with the header, rotates once like any other call, and saves the
 * bytes it gets.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const send = () => {
    const token = getToken()
    return fetch(`${config.apiBaseUrl}${path}`, {
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  }
  let res = await send()
  if (res.status === 401 && (await rotateTokens())) res = await send()
  if (!res.ok) {
    throw new ApiError(res.status, res.status === 404 ? 'That file is no longer available.' : 'We could not download that file.')
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Fetch a guarded file as a Blob -- for playing a voice note or showing a
 * private image, which an <audio src> or <img src> cannot do on its own
 * because the access token is never a cookie. Rotates once like callApi.
 */
export async function fetchFileBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const send = () => {
    const token = getToken()
    const init: RequestInit = { credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {} }
    if (signal) init.signal = signal
    return fetch(`${config.apiBaseUrl}${path}`, init)
  }
  let res = await send()
  if (res.status === 401 && (await rotateTokens())) res = await send()
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'That file is no longer available.' : 'We could not load that file.')
  return res.blob()
}

/**
 * A multipart POST to a route of its own (an ID proof goes to the profile, not
 * to /files). Same token handling as uploadFile; the browser sets the boundary.
 */
export async function postForm(path: string, makeForm: () => FormData): Promise<unknown> {
  const send = () => {
    const token = getToken()
    return fetch(`${config.apiBaseUrl}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: makeForm(),
    })
  }
  let res = await send()
  if (res.status === 401 && (await rotateTokens())) res = await send()
  const json: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof json === 'object' && json && 'error' in json ? String((json as { error: unknown }).error) : 'We could not upload that file.'
    throw new ApiError(res.status, msg, res.headers.get('X-Correlation-Id'))
  }
  return json
}

/**
 * Upload one file to /files and get back the URL to store.
 *
 * Separate from `callApi` because that one sets `Content-Type: application/json`
 * and stringifies the body; a multipart upload needs the browser to set the
 * header itself so it can add the boundary. `isPublic` is for branding assets
 * that a client's browser has to load with no session — the server only honours
 * it for image types.
 */
export async function uploadFile(file: File, opts: { isPublic?: boolean } = {}): Promise<StoredFile> {
  const send = () => {
    const token = getToken()
    const form = new FormData()
    form.append('file', file)
    return fetch(`${config.apiBaseUrl}/files${opts.isPublic ? '?public=1' : ''}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
  }
  let res = await send()
  if (res.status === 401 && (await rotateTokens())) res = await send()
  const json: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof json === 'object' && json && 'error' in json
        ? String((json as { error: unknown }).error)
        : 'We could not upload that file.'
    throw new ApiError(res.status, msg, res.headers.get('X-Correlation-Id'))
  }
  return storedFile.parse(json)
}
