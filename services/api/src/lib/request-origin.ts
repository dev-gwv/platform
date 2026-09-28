import type { Context } from 'hono'
import type { AppEnv } from '../context'

/** The address the outside world reaches us on: behind Traefik the request URL is the inside one. */
export function apiOrigin(c: Context<AppEnv>): string {
  const url = new URL(c.req.url)
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? url.host
  const proto = c.req.header('x-forwarded-proto') ?? url.protocol.replace(':', '')
  return `${proto.split(',')[0]!.trim()}://${host.split(',')[0]!.trim()}`
}
