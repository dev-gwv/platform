import type { Context, Next } from 'hono'
import type { ModuleAction, ModuleKey } from '@ipc/permissions'
import type { AppEnv } from '../context'
import { fail } from './errors'

const DENIED = 'You do not have access to this action.'

/** Gate a router/route on module visibility. */
export function requireModule(key: ModuleKey) {
  return async (c: Context<AppEnv>, next: Next) => {
    if (!c.get('auth').access.hasModule(key)) fail(403, DENIED)
    await next()
  }
}

/** Gate on a specific action (view/create/edit/delete). */
export function requireAction(key: ModuleKey, action: ModuleAction) {
  return async (c: Context<AppEnv>, next: Next) => {
    if (!c.get('auth').access.hasAction(key, action)) fail(403, DENIED)
    await next()
  }
}

/** Owner-only gate (settings, salaries, platform ops). */
export function requireOwner() {
  return async (c: Context<AppEnv>, next: Next) => {
    if (!c.get('auth').isOwner) fail(403, DENIED)
    await next()
  }
}

/** The owner, or anyone given this action -- for a write a delegate may also make. */
export function requireOwnerOr(key: ModuleKey, action: ModuleAction) {
  return async (c: Context<AppEnv>, next: Next) => {
    const auth = c.get('auth')
    if (!auth.isOwner && !auth.access.hasAction(key, action)) fail(403, DENIED)
    await next()
  }
}

/** Cross-tenant vendor console gate — the platform_admins allowlist only. */
export function requirePlatformAdmin() {
  return async (c: Context<AppEnv>, next: Next) => {
    if (!c.get('auth').isPlatformAdmin) fail(403, DENIED)
    await next()
  }
}
