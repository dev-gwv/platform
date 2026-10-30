import { describe, expect, it } from 'vitest'
import { sign, verify } from 'hono/jwt'
import type { Env } from '../context'
import { createFailure } from '../modules/projects/routes-gallery'
import {
  createFramelineGallery,
  driveOut,
  FRAMELINE_SAYS,
  type FetchLike,
  framelineClaims,
  framelineConnected,
  framelineSignInUrl,
  framelineTrouble,
  nameMissing,
  planEndedOn,
  readFramelineGallery,
  readFramelineStudio,
  refusalKind,
  verifyFramelineNotice,
  type FramelinePerson,
} from './frameline'

/**
 * Frameline, the gallery add-on (0261). Its own suite checks the other half
 * (apps/api/test/integrations.test.ts in the Frameline repo): that it accepts
 * these tokens once, matches people by id, and lets the owner set up first.
 */

const SECRET = 'frameline-shared-secret-0123456789-abcdef'
const env = { FRAMELINE_API_URL: 'https://fl.example/', FRAMELINE_SECRET: SECRET } as Env

const owner: FramelinePerson = {
  auth: { userId: 'u-owner', companyId: 'c-1', isOwner: true, displayName: 'Asha', email: 'asha@studio.test' },
  companyName: 'Asha Studio',
  emailVerified: true,
}
const manager: FramelinePerson = {
  auth: { userId: 'u-mgr', companyId: 'c-1', isOwner: false, displayName: 'Nitin', email: 'made-up@anything.test' },
  companyName: 'Asha Studio',
  emailVerified: false,
}

const gallery = {
  projectId: 'p-1', eventId: 'ev_1', shortId: 'AB12CD3', name: 'Wedding', status: 'draft', photoCount: 0,
  galleryUrl: 'https://g.example/AB12CD3', pin: '4821', adminPath: '/events/ev_1', createdAt: '2026-10-12T00:00:00.000Z',
}
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('who Frameline is told the person is', () => {
  it('makes the owner the owner, and everyone else an editor', () => {
    expect(framelineClaims(owner, 'sso').role).toBe('owner')
    expect(framelineClaims(manager, 'sso').role).toBe('editor')
  })

  it('passes on whether the email is confirmed, never assumes it', () => {
    // Team logins may carry any email; Frameline matches by email only on this word.
    expect(framelineClaims(owner, 'api').email_verified).toBe(true)
    expect(framelineClaims(manager, 'api').email_verified).toBe(false)
  })

  it('is good for a minute, once', () => {
    const a = framelineClaims(owner, 'sso')
    const b = framelineClaims(owner, 'sso')
    expect(a.exp - a.iat).toBe(60)
    expect(a.jti).not.toBe(b.jti)
    expect(a).toMatchObject({ iss: 'studioautopilot', aud: 'frameline', sub: 'u-owner', cid: 'c-1', cname: 'Asha Studio', purpose: 'sso' })
  })
})

describe('the sign-in link', () => {
  it('carries a token signed with the shared secret, and where to land', async () => {
    const url = new URL(await framelineSignInUrl(env, owner, '/events/ev_1'))
    expect(`${url.origin}${url.pathname}`).toBe('https://fl.example/v1/integrations/studioautopilot/sso')
    const claims = await verify(url.searchParams.get('token')!, SECRET, 'HS256')
    expect(claims).toMatchObject({ purpose: 'sso', to: '/events/ev_1', role: 'owner' })
  })
})

describe('talking to Frameline', () => {
  it('needs both settings, and a secret long enough to mean something', () => {
    expect(framelineConnected(env)).toBe(true)
    expect(framelineConnected({ FRAMELINE_API_URL: 'https://fl.example' } as Env)).toBe(false)
    expect(framelineConnected({ FRAMELINE_API_URL: 'https://fl.example', FRAMELINE_SECRET: 'short' } as Env)).toBe(false)
  })

  it('says so instead of calling out when it is not connected', async () => {
    let called = false
    const r = await createFramelineGallery({} as Env, owner, { id: 'p-1', name: 'W', date: '2026-12-11', city: '' }, async () => {
      called = true
      return new Response()
    })
    expect(r).toMatchObject({ ok: false, kind: 'not_connected' })
    expect(called).toBe(false)
  })

  it('sends a fresh server token and the project', async () => {
    let seen: { url: string; auth: string; body: unknown } | null = null
    const r = await createFramelineGallery(env, owner, { id: 'p-1', name: 'Wedding', date: '2026-12-11T00:00:00.000Z', city: '' }, async (url, init) => {
      seen = { url: String(url), auth: String((init?.headers as Record<string, string>).Authorization), body: JSON.parse(String(init?.body)) }
      return new Response(JSON.stringify(gallery), { status: 201 })
    })
    expect(r).toEqual({ ok: true, data: gallery })
    expect(seen!.url).toBe('https://fl.example/v1/integrations/studioautopilot/events')
    expect(seen!.body).toEqual({ projectId: 'p-1', name: 'Wedding', date: '2026-12-11T00:00:00.000Z', city: '' })
    expect(await verify(seen!.auth.replace('Bearer ', ''), SECRET, 'HS256')).toMatchObject({ purpose: 'api' })
  })

  it('tells "the owner goes first" apart from a missing gallery and a refusal', async () => {
    const p = { id: 'p-1', name: 'W', date: '2026-12-11', city: '' }
    expect(await createFramelineGallery(env, manager, p, reply(409, { code: 'partner_studio_not_set_up' }))).toMatchObject({ ok: false, kind: 'owner_first' })
    expect(await readFramelineGallery(env, owner, 'p-1', reply(404, { code: 'not_found' }))).toMatchObject({ ok: false, kind: 'missing' })
    expect(await createFramelineGallery(env, owner, p, reply(500, {}))).toMatchObject({ ok: false, kind: 'refused', status: 500 })
    expect(
      await createFramelineGallery(env, owner, p, async () => {
        throw new Error('ECONNREFUSED')
      }),
    ).toMatchObject({ ok: false, kind: 'unreachable' })
  })
})

describe('Google Drive, which lives in Frameline', () => {
  const p = { id: 'p-1', name: 'Wedding', date: '2026-12-11T00:00:00.000Z', city: '' }

  it('asks for the full-size photos in Drive only when the studio chose it', async () => {
    const bodies: unknown[] = []
    const capture: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify(gallery), { status: 201 })
    }
    await createFramelineGallery(env, owner, { ...p, originalsIn: 'drive' }, capture)
    await createFramelineGallery(env, owner, p, capture)
    expect(bodies[0]).toMatchObject({ originalsIn: 'drive' })
    // Unset: Frameline follows the studio's own Drive default.
    expect(bodies[1]).not.toHaveProperty('originalsIn')
  })

  it('says plainly that Drive is not connected, rather than "try again"', async () => {
    expect(await createFramelineGallery(env, owner, { ...p, originalsIn: 'drive' }, reply(409, { code: 'drive_not_connected' }))).toMatchObject({ ok: false, kind: 'drive_off' })
    expect(createFailure('drive_off')).toEqual({ status: 409, message: FRAMELINE_SAYS.drive_off })
  })

  it('carries the studio’s Drive state, and nothing from a Frameline too old to say', () => {
    expect(
      driveOut({ available: true, importAvailable: true, connected: true, needsReconnect: false, email: 'a@gmail.com', defaultForNewEvents: true, settingsPath: '/settings/drive' }),
    ).toEqual({ available: true, import_available: true, connected: true, needs_reconnect: false, email: 'a@gmail.com', default_for_new: true })
    expect(driveOut(undefined)).toBeNull()
  })
})

describe('Frameline\'s gallery-changed notice', () => {
  const notice = (over: Record<string, unknown> = {}, secret = SECRET) => {
    const now = Math.floor(Date.now() / 1000)
    return sign({ iss: 'frameline', aud: 'studioautopilot', purpose: 'notice', cid: 'c-1', jti: 'j-1', iat: now, exp: now + 60, ...over }, secret, 'HS256')
  }

  it('takes a fresh notice Frameline signed for us, and names its company', async () => {
    expect(await verifyFramelineNotice(env, await notice())).toEqual({ companyId: 'c-1' })
  })

  it('refuses anything else: another secret, issuer, audience or purpose, an old or long-lived token, or none', async () => {
    expect(await verifyFramelineNotice(env, await notice({}, 'another-secret-0123456789-0123456789-xx'))).toBeNull()
    expect(await verifyFramelineNotice(env, await notice({ iss: 'studioautopilot' }))).toBeNull()
    expect(await verifyFramelineNotice(env, await notice({ aud: 'frameline' }))).toBeNull()
    expect(await verifyFramelineNotice(env, await notice({ purpose: 'api' }))).toBeNull()
    const now = Math.floor(Date.now() / 1000)
    expect(await verifyFramelineNotice(env, await notice({ iat: now - 600, exp: now - 300 }))).toBeNull()
    expect(await verifyFramelineNotice(env, await notice({ exp: now + 3600 }))).toBeNull()
    expect(await verifyFramelineNotice(env, await notice({ cid: '' }))).toBeNull()
    expect(await verifyFramelineNotice(env, undefined)).toBeNull()
    expect(await verifyFramelineNotice({} as Env, await notice())).toBeNull()
  })
})

describe('telling a blip from a link only we can fix', () => {
  it('reads 401, 403, 501 and a bare 404 as not linked properly, and Frameline’s own 404 as a gallery gone', () => {
    expect(refusalKind(401, 'invalid_partner_token')).toBe('misconfigured')
    expect(refusalKind(403, undefined)).toBe('misconfigured')
    expect(refusalKind(501, 'not_configured')).toBe('misconfigured')
    // A wrong FRAMELINE_API_URL answers 404 to everything: never "the gallery was deleted".
    expect(refusalKind(404, undefined)).toBe('misconfigured')
    expect(refusalKind(404, 'not_found')).toBe('missing')
    expect(refusalKind(409, 'partner_studio_not_set_up')).toBe('owner_first')
    expect(refusalKind(500, 'internal')).toBe('refused')
    expect(refusalKind(503, undefined)).toBe('refused')
  })

  it('says "tell us" only for what a retry cannot fix', () => {
    expect(framelineTrouble('misconfigured')).toBe('misconfigured')
    expect(framelineTrouble('not_connected')).toBe('misconfigured')
    expect(framelineTrouble('refused')).toBe('unreachable')
    expect(framelineTrouble('unreachable')).toBe('unreachable')
    expect(framelineTrouble('no_name')).toBe('unreachable')
  })

  it('sees a secret mismatch through the call itself', async () => {
    expect(await readFramelineStudio(env, owner, reply(401, { code: 'invalid_partner_token' }))).toMatchObject({ ok: false, kind: 'misconfigured', status: 401 })
    expect(await readFramelineGallery(env, owner, 'p-1', reply(404, {}))).toMatchObject({ ok: false, kind: 'misconfigured' })
  })
})

describe('the owner’s studio is never made as "Studio"', () => {
  const nameless: FramelinePerson = { ...owner, companyName: '  ' }

  it('stops an owner whose studio name could not be read, before anything is sent', async () => {
    expect(nameMissing(nameless)).toBe(true)
    expect(nameMissing({ ...manager, companyName: '' })).toBe(false)
    let called = false
    const r = await createFramelineGallery(env, nameless, { id: 'p-1', name: 'W', date: '2026-12-11', city: '' }, async () => {
      called = true
      return new Response(JSON.stringify(gallery), { status: 201 })
    })
    expect(r).toMatchObject({ ok: false, kind: 'no_name' })
    expect(called).toBe(false)
  })

  it('sends the studio’s own name, trimmed', () => {
    expect(framelineClaims({ ...owner, companyName: '  Asha Studio ' }, 'api').cname).toBe('Asha Studio')
  })
})

describe('a Frameline plan that ended', () => {
  const now = Date.parse('2026-10-23T06:00:00Z')
  it('names the day only once it has passed', () => {
    expect(planEndedOn('2026-10-01T00:00:00Z', now)).toBe('2026-10-01T00:00:00Z')
    expect(planEndedOn('2027-03-03T00:00:00Z', now)).toBeNull()
    expect(planEndedOn(null, now)).toBeNull()
    expect(planEndedOn('not a date', now)).toBeNull()
  })
})
