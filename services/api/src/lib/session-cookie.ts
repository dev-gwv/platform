import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AppEnv, Env } from '../context'

/**
 * Refresh-token cookie mode (AUTH_COOKIE=1).
 *
 * The refresh token is the long-lived credential (90 days from its last use). In localStorage any script that
 * runs on the page can read it; as an HttpOnly cookie scoped to /auth on the
 * API origin, no script can. Access tokens stay in the response body — they
 * live 30 minutes and are what the SPA attaches to every call.
 *
 * Off by default so a bench, CI and a split-domain deployment keep working
 * with body tokens; the client handles both shapes.
 */
const REFRESH_COOKIE = 'ipc_refresh'
// 90 days, renewed on every rotation (0221): it ends after 90 idle days, not 90 of use.
const MAX_AGE_S = 90 * 24 * 60 * 60

export const cookieMode = (env: Pick<Env, 'AUTH_COOKIE'>): boolean => (env.AUTH_COOKIE ?? '') === '1'

type SameSite = 'Lax' | 'None' | 'Strict'
function sameSite(env: Pick<Env, 'AUTH_COOKIE_SAMESITE'>): SameSite {
  const v = (env.AUTH_COOKIE_SAMESITE ?? 'lax').toLowerCase()
  return v === 'none' ? 'None' : v === 'strict' ? 'Strict' : 'Lax'
}

function attrs(env: Env) {
  return {
    httpOnly: true,
    // SameSite=None is refused by browsers without Secure; a dev bench on http
    // uses Lax, which is the default.
    secure: sameSite(env) === 'None' || (env.ENVIRONMENT ?? '') === 'production',
    sameSite: sameSite(env),
    path: '/auth',
    ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
  }
}

export function setRefreshCookie(c: Context<AppEnv>, raw: string): void {
  setCookie(c, REFRESH_COOKIE, raw, { ...attrs(c.env), maxAge: MAX_AGE_S })
}

export function clearRefreshCookie(c: Context<AppEnv>): void {
  deleteCookie(c, REFRESH_COOKIE, attrs(c.env))
}

export function readRefreshCookie(c: Context<AppEnv>): string | null {
  return getCookie(c, REFRESH_COOKIE) ?? null
}
