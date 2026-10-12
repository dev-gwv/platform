import { describe, expect, it } from 'vitest'
import { verify } from 'hono/jwt'
import type { Env } from '../context'
import { createFramelineGallery, framelineClaims, framelineConnected, framelineSignInUrl, readFramelineGallery, type FramelinePerson } from './frameline'

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
