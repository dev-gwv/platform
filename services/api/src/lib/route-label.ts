import type { Context } from 'hono'
import { routePath } from 'hono/route'

/**
 * The route a request matched, as registered ('/public/quote/:token'), for
 * logs and rate-limit buckets -- never the raw path, which carries the link
 * tokens of public pages (a quotation, terms, a client's tracker) straight into
 * the logs (audit, 21 Nov). When no route is known, any long id-like segment of
 * the path is masked instead.
 */
export function routeLabel(c: Context): string {
  try {
    const p = routePath(c, -1)
    if (p && p !== '*' && p !== '/*') return p
  } catch {
    // No match result (a request that never reached the router): mask below.
  }
  return maskPath(c.req.path)
}

/** Replaces each path segment that looks like a token or id with ':id'. */
export function maskPath(path: string): string {
  return path
    .split('/')
    .map((seg) => (/^[A-Za-z0-9._~%-]{20,}$/.test(seg) || (/\d/.test(seg) && seg.length >= 8) ? ':id' : seg))
    .join('/')
}
