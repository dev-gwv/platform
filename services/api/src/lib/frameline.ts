import { sign, verify } from 'hono/jwt'
import type { AuthContext, Env } from '../context'

/**
 * Frameline, the gallery add-on (0261): its own app on Cloudflare, where the
 * studio uploads a project's photos and guests open them with the PIN.
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
    // Frameline names a new studio from this, and only for the owner; an owner
    // whose name could not be read is stopped before any call (nameMissing).
    // The placeholder is for everyone else, who can never set a studio up.
    cname: p.companyName.trim().slice(0, 160) || 'Studio',
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
 * the studio up; 'missing' is a project whose gallery Frameline does not have
 * (never made, or deleted there); 'misconfigured' is a refusal that trying
 * again will not fix (the two secrets differ, Frameline is not set up for us,
 * or the address is wrong); 'refused' and 'unreachable' may pass; 'no_name' is
 * an owner whose studio name could not be read, so nothing was sent.
 */
export type FramelineFailure = 'not_connected' | 'owner_first' | 'missing' | 'misconfigured' | 'refused' | 'unreachable' | 'no_name'
export type FramelineResult<T> = { ok: true; data: T } | { ok: false; kind: FramelineFailure; status: number }

/**
 * The owner's first call makes their Frameline studio, named from the company:
 * never send it without the name (it used to make a studio called "Studio").
 */
export const nameMissing = (p: FramelinePerson) => p.auth.isOwner && !p.companyName.trim()

/** What the studio is told when Frameline could not do it, by why. */
export const FRAMELINE_SAYS = {
  misconfigured: 'The gallery add-on isn’t linked properly. Book a support call and we’ll set it right.',
  no_answer: 'The gallery app did not answer. Please try again in a minute.',
  no_name: 'We could not read your studio’s name just now. Please try again in a minute.',
  not_connected: 'The gallery add-on is not connected yet. Ask us on WhatsApp to switch it on.',
} as const

/** Trouble the studio can do nothing about but tell us, apart from a blip that passes. */
export function framelineTrouble(kind: FramelineFailure): 'misconfigured' | 'unreachable' {
  return kind === 'misconfigured' || kind === 'not_connected' ? 'misconfigured' : 'unreachable'
}

/** How a refusal reads: 401/403/501, or a 404 that is not Frameline's own, will not pass on a retry. */
export function refusalKind(status: number, code: string | undefined): FramelineFailure {
  if (status === 409 && code === 'partner_studio_not_set_up') return 'owner_first'
  // Frameline's own "not found" carries its code; a bare 404 is the wrong address.
  if (status === 404) return code === 'not_found' ? 'missing' : 'misconfigured'
  if (status === 401 || status === 403 || status === 501 || code === 'not_configured') return 'misconfigured'
  return 'refused'
}

async function call<T>(env: Env, p: FramelinePerson, method: 'GET' | 'POST', path: string, body?: unknown, fetchImpl: FetchLike = fetch): Promise<FramelineResult<T>> {
  if (!framelineConnected(env)) return { ok: false, kind: 'not_connected', status: 0 }
  if (nameMissing(p)) {
    console.error(`[frameline] ${method} ${path} not sent: the studio's name could not be read`)
    return { ok: false, kind: 'no_name', status: 0 }
  }
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
    const kind = refusalKind(res.status, problem.code)
    if (kind !== 'owner_first' && kind !== 'missing') console.error(`[frameline] ${method} ${path} ${kind} ${res.status} ${problem.code ?? ''}`)
    return { ok: false, kind, status: res.status }
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

/** The day Frameline's plan ended, or null while it runs (or nobody knows). */
export function planEndedOn(validTill: string | null | undefined, now: number = Date.now()): string | null {
  if (!validTill) return null
  const t = Date.parse(validTill)
  return Number.isFinite(t) && t < now ? validTill : null
}
