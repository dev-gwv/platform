import { sign, verify } from 'hono/jwt'
import type { AuthContext, Env } from '../context'

/**
 * Frameline, the gallery add-on (0261): its own app on Cloudflare, where the
 * studio uploads a project's photos and guests find theirs with a selfie.
 *
 * Studio AutoPilot speaks to it with tokens it signs itself, using the secret
 * both servers hold (FRAMELINE_SECRET here, STUDIOAUTOPILOT_SECRET there):
 *   - 'sso' tokens ride in the link "Open gallery" opens, and sign the person
 *     into Frameline as themselves;
 *   - 'api' tokens go server to server to make or read a project's gallery.
 * Each is good for one minute and once only (Frameline spends its jti), so a
 * link left in a browser history is worth nothing.
 *
 * Billing is Frameline's: a studio pays for the add-on from Frameline's own
 * wallet. Nothing here checks or charges for it.
 */

/** Frameline's issuer check: these tokens are ours and only ours. */
const ISSUER = 'studioautopilot'
const LIFETIME_SEC = 60
const TIMEOUT_MS = 10_000

/** Both settings, or the add-on is not connected. */
export function framelineConnected(env: Pick<Env, 'FRAMELINE_API_URL' | 'FRAMELINE_SECRET'>): boolean {
  return !!env.FRAMELINE_API_URL && !!env.FRAMELINE_SECRET && env.FRAMELINE_SECRET.length >= 32
}

const base = (env: Env) => env.FRAMELINE_API_URL!.replace(/\/+$/, '')

/** Just the call this file makes, so a test can stand in for it. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Who the person is, as Frameline is told it. */
export interface FramelinePerson {
  auth: Pick<AuthContext, 'userId' | 'companyId' | 'isOwner' | 'displayName' | 'email'>
  companyName: string
  /**
   * Only when this login has confirmed its email. Team logins may carry any
   * email at all, so Frameline matches by email only on this word, and gives
   * everyone else a placeholder address instead.
   */
  emailVerified: boolean
}

/**
 * Pure apart from the clock and the random jti, so the claims are tested.
 *
 * The owner sets the studio up in Frameline (the add-on's wallet is theirs);
 * everyone else Studio AutoPilot lets open a gallery joins as an editor.
 */
export function framelineClaims(p: FramelinePerson, purpose: 'sso' | 'api', to?: string) {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: ISSUER,
    aud: 'frameline',
    sub: p.auth.userId,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + LIFETIME_SEC,
    purpose,
    cid: p.auth.companyId,
    cname: p.companyName.slice(0, 160) || 'Studio',
    name: p.auth.displayName.slice(0, 120),
    email: p.auth.email.slice(0, 254),
    email_verified: p.emailVerified,
    role: p.auth.isOwner ? 'owner' : 'editor',
    ...(to ? { to } : {}),
  }
}

export function framelineToken(env: Env, p: FramelinePerson, purpose: 'sso' | 'api', to?: string): Promise<string> {
  return sign(framelineClaims(p, purpose, to), env.FRAMELINE_SECRET!, 'HS256')
}

/** The link "Open gallery" opens: one minute, once. */
export async function framelineSignInUrl(env: Env, p: FramelinePerson, to?: string): Promise<string> {
  const token = await framelineToken(env, p, 'sso', to)
  return `${base(env)}/v1/integrations/studioautopilot/sso?token=${encodeURIComponent(token)}`
}

/** A project's gallery, as Frameline reports it. */
export interface FramelineGallery {
  projectId: string
  eventId: string
  shortId: string
  name: string
  status: string
  photoCount: number
  galleryUrl: string
  pin: string | null
  /** The couple-and-family PIN; only when guests see just their own photos and the studio set one. */
  fullAccessPin?: string | null
  facePrivacy?: boolean
  expiresAt?: string
  visits?: number
  /** Signed-up guests; only on the single-gallery read. */
  guests?: number
  adminPath: string
  createdAt: string
}

/** The Frameline studio joined to this company, for Settings. */
export interface FramelineStudio {
  linked: boolean
  studioName: string | null
  plan: string | null
  validTill: string | null
  walletRupees: number | null
  photosUsed: number | null
  photosLimit: number | null
  galleries: number
  adminUrl: string
}

/**
 * Deliberately not a thrown error, like lib/ai.ts: every caller decides what
 * the studio is told. 'owner_first' is Frameline saying only the owner may set
 * the studio up; 'missing' is a project with no gallery yet.
 */
export type FramelineResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_connected' | 'owner_first' | 'missing' | 'refused' | 'unreachable'; status: number }

async function call<T>(env: Env, p: FramelinePerson, method: 'GET' | 'POST', path: string, body?: unknown, fetchImpl: FetchLike = fetch): Promise<FramelineResult<T>> {
  if (!framelineConnected(env)) return { ok: false, kind: 'not_connected', status: 0 }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${base(env)}/v1/integrations/studioautopilot${path}`, {
      method,
      signal: abort.signal,
      headers: {
        Authorization: `Bearer ${await framelineToken(env, p, 'api')}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (res.ok) return { ok: true, data: (await res.json()) as T }
    const problem = (await res.json().catch(() => ({}))) as { code?: string }
    if (res.status === 409 && problem.code === 'partner_studio_not_set_up') return { ok: false, kind: 'owner_first', status: 409 }
    if (res.status === 404) return { ok: false, kind: 'missing', status: 404 }
    console.error(`[frameline] ${method} ${path} refused ${res.status} ${problem.code ?? ''}`)
    return { ok: false, kind: 'refused', status: res.status }
  } catch (e) {
    console.error(`[frameline] ${method} ${path} unreachable`, e instanceof Error ? e.message : e)
    return { ok: false, kind: 'unreachable', status: 0 }
  } finally {
    clearTimeout(timer)
  }
}

/** Makes the project's gallery, or returns the one already made. */
export function createFramelineGallery(
  env: Env,
  p: FramelinePerson,
  project: { id: string; name: string; date: string; city: string },
  fetchImpl?: FetchLike,
): Promise<FramelineResult<FramelineGallery>> {
  return call(env, p, 'POST', '/events', { projectId: project.id, name: project.name, date: project.date, city: project.city }, fetchImpl)
}

/** How the project's gallery is doing: photos so far, live or not. */
export function readFramelineGallery(env: Env, p: FramelinePerson, projectId: string, fetchImpl?: FetchLike): Promise<FramelineResult<FramelineGallery>> {
  return call(env, p, 'GET', `/events/${encodeURIComponent(projectId)}`, undefined, fetchImpl)
}

/** Every gallery made for this company, newest first. */
export function listFramelineGalleries(env: Env, p: FramelinePerson, fetchImpl?: FetchLike): Promise<FramelineResult<{ items: FramelineGallery[] }>> {
  return call(env, p, 'GET', '/events', undefined, fetchImpl)
}

/** The Frameline studio behind this company: linked yet, plan, wallet, photos used. */
export function readFramelineStudio(env: Env, p: FramelinePerson, fetchImpl?: FetchLike): Promise<FramelineResult<FramelineStudio>> {
  return call(env, p, 'GET', '/studio', undefined, fetchImpl)
}

/**
 * A gallery-changed notice from Frameline (POST /webhooks/frameline), checked:
 * signed with the same shared secret, issued by Frameline for us, still fresh,
 * and naming the company it is about. The notice only says "go and look" --
 * the caller re-reads the gallery through the signed API -- so a replay does
 * nothing a fresh read would not.
 */
export async function verifyFramelineNotice(env: Env, token: string | undefined): Promise<{ companyId: string } | null> {
  if (!framelineConnected(env) || !token) return null
  try {
    const claims = (await verify(token, env.FRAMELINE_SECRET!, 'HS256')) as Record<string, unknown>
    if (claims.iss !== 'frameline' || claims.aud !== ISSUER || claims.purpose !== 'notice') return null
    if (typeof claims.iat !== 'number' || typeof claims.exp !== 'number' || claims.exp - claims.iat > 300) return null
    return typeof claims.cid === 'string' && claims.cid.length > 0 ? { companyId: claims.cid } : null
  } catch {
    return null
  }
}
