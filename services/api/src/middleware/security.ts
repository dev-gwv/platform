import type { Context, Next } from 'hono'
import type { AppEnv } from '../context'
import { routeLabel } from '../lib/route-label'
import { resolveClientIp } from '../lib/client-ip'

const HEADERS: ReadonlyArray<[string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'geolocation=()'],
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
  ['Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
]

/**
 * Headers a handler may loosen on purpose. The app and the API are two
 * origins (app. and api.studioautopilot.in), so a public file the app shows
 * in an <img> -- the studio's logo on a quotation -- is blocked by the
 * baseline `same-origin` resource policy; `serve()` in files/router.ts sets
 * `cross-origin` on those, and that must survive this middleware.
 */
const HANDLER_MAY_SET = new Set(['Cross-Origin-Resource-Policy'])

/**
 * Baseline security response headers on every response — including ones a
 * handler builds itself as a raw Response, which `c.header()` before `next()`
 * would not reach. Set after the handler so nothing can drop them.
 */
export async function securityHeaders(c: Context<AppEnv>, next: Next) {
  await next()
  for (const [name, value] of HEADERS) {
    if (HANDLER_MAY_SET.has(name) && c.res.headers.has(name)) continue
    c.res.headers.set(name, value)
  }
}

/**
 * Pure sliding-window rate-limit decision. Keeps only timestamps inside the
 * window and allows the request iff the count is under the limit.
 * Returns the pruned timestamp list to store back.
 */
export function slidingWindow(
  hits: ReadonlyArray<number>,
  now: number,
  windowMs: number,
  limit: number,
): { allowed: boolean; next: number[] } {
  const fresh = hits.filter((t) => t > now - windowMs)
  if (fresh.length >= limit) return { allowed: false, next: fresh }
  return { allowed: true, next: [...fresh, now] }
}

/**
 * A bounded in-process hit store. Every unique key used to live forever, so
 * the map grew by one entry per (address, path) pair for the life of the
 * process. Now: expired entries are swept on a cadence, and if the map is
 * still over capacity the oldest keys are evicted first.
 *
 * Each bucket remembers its own window (the longest any limiter asked of it),
 * and pruning and the sweep use that window: the sweep used to prune every
 * bucket by whichever limiter happened to trigger it, so a 60-second
 * limiter's sweep wiped the hour-long enquiry-form buckets.
 *
 * Single-process only — the API runs as one Bun process per VPS. Scale out
 * with a shared store (docs/RUNBOOK.md) before running more than one replica.
 */
export class HitStore {
  private readonly buckets = new Map<string, { hits: number[]; windowMs: number }>()
  private ops = 0

  constructor(
    private readonly maxKeys = 10_000,
    private readonly sweepEvery = 500,
  ) {}

  get size(): number {
    return this.buckets.size
  }

  /** Run the decision for `key`, persist the pruned window, return the outcome. */
  hit(key: string, now: number, windowMs: number, limit: number): ReturnType<typeof slidingWindow> {
    const prev = this.buckets.get(key)
    const keepFor = Math.max(prev?.windowMs ?? 0, windowMs)
    const kept = (prev?.hits ?? []).filter((t) => t > now - keepFor)
    const r = slidingWindow(kept, now, windowMs, limit)
    if (r.allowed) kept.push(now)
    // Re-insert so the map's insertion order doubles as recency for eviction.
    this.buckets.delete(key)
    this.buckets.set(key, { hits: kept, windowMs: keepFor })
    if (++this.ops % this.sweepEvery === 0) this.sweep(now)
    if (this.buckets.size > this.maxKeys) this.evictOldest(this.buckets.size - this.maxKeys)
    return r
  }

  /** Drops every bucket whose own window has fully passed. */
  sweep(now: number): void {
    for (const [key, b] of this.buckets) {
      if (b.hits.length === 0 || b.hits[b.hits.length - 1]! <= now - b.windowMs) this.buckets.delete(key)
    }
  }

  private evictOldest(n: number): void {
    for (const key of this.buckets.keys()) {
      if (n-- <= 0) break
      this.buckets.delete(key)
    }
  }
}

const store = new HitStore()

/**
 * The address a bucket is kept under. An IPv6 client usually holds a whole
 * /64 and can pick a fresh address from it for every request, so IPv6 is
 * folded to its first four groups; IPv4 (and IPv4-mapped IPv6) is kept whole.
 */
export function addressKey(ip: string): string {
  const raw = (ip.trim().replace(/^\[|\]$/g, '').split('%')[0] ?? '').toLowerCase()
  if (!raw.includes(':')) return raw
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(raw)
  if (mapped) return mapped[1]!
  let groups: string[]
  if (raw.includes('::')) {
    const [head = '', tail = ''] = raw.split('::', 2)
    const left = head ? head.split(':') : []
    const right = tail ? tail.split(':') : []
    groups = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
  } else {
    groups = raw.split(':')
  }
  if (groups.length < 4) return raw
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

let limiterSeq = 0

interface RateLimitOptions {
  windowMs: number
  limit: number
  /**
   * How the bucket key is built. 'ip' shares one bucket across every path
   * under this limiter (sign-in surfaces); 'ip+path' gives each route pattern
   * its own (every token under '/public/quote/:token' shares one).
   */
  scope?: 'ip' | 'ip+path'
  /** What a person is told when they hit the limit. */
  message?: string
  /** Test seam. */
  store?: HitStore
}

/** Best-effort per-IP rate limit. The client address comes from lib/client-ip. */
export function rateLimit(opts: RateLimitOptions) {
  const hits = opts.store ?? store
  const scope = opts.scope ?? 'ip+path'
  // Each limiter keeps its own buckets, so two limiters on one route never
  // count the same request twice.
  const id = ++limiterSeq
  return async (c: Context<AppEnv>, next: Next) => {
    const ip = addressKey(resolveClientIp(c.req.raw.headers, c.env.CLIENT_IP_HEADER))
    const key = scope === 'ip' ? `${id}|${ip}` : `${id}|${ip}|${routeLabel(c)}`
    const now = Date.now()
    const { allowed, next: updated } = hits.hit(key, now, opts.windowMs, opts.limit)
    c.header('RateLimit-Limit', String(opts.limit))
    if (!allowed) {
      c.header('Retry-After', String(Math.ceil(opts.windowMs / 1000)))
      c.header('RateLimit-Remaining', '0')
      return c.json({ error: opts.message ?? 'Too many requests. Please slow down.' }, 429)
    }
    c.header('RateLimit-Remaining', String(Math.max(0, opts.limit - updated.length)))
    await next()
  }
}
