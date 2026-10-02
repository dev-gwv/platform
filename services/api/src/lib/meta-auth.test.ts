import { afterEach, describe, expect, it, vi } from 'vitest'
import { MetaError, checkPageToken, isMetaAuthError, subscribePage } from './meta'

const graphError = (status: number, error: Record<string, unknown>) =>
  vi.fn(async () => new Response(JSON.stringify({ error }), { status }))

afterEach(() => vi.unstubAllGlobals())

describe('a Facebook connection that no longer works', () => {
  it('knows an expired or revoked token from any other failure', () => {
    expect(isMetaAuthError(new MetaError('Error validating access token: The user has not authorized application 1.', 190, 'OAuthException'))).toBe(true)
    expect(isMetaAuthError(new MetaError('Session has expired', 102))).toBe(true)
    expect(isMetaAuthError(new MetaError('(#200) Permissions error', 200))).toBe(true)
    expect(isMetaAuthError(new MetaError('(#10) Application does not have permission', 10))).toBe(true)
    expect(isMetaAuthError(new MetaError('The app is not authorized for this page'))).toBe(true)
    expect(isMetaAuthError(new MetaError('(#4) Application request limit reached', 4))).toBe(false)
    expect(isMetaAuthError(new Error('fetch failed'))).toBe(false)
  })

  it('reads the code Facebook sends with a failure', async () => {
    vi.stubGlobal('fetch', graphError(400, { message: 'Error validating access token', code: 190, type: 'OAuthException' }))
    const e = await subscribePage('t', '111').then(() => null, (x: unknown) => x)
    expect(e).toBeInstanceOf(MetaError)
    expect((e as MetaError).code).toBe(190)
    expect(isMetaAuthError(e)).toBe(true)
  })

  it('says a page token is expired only when Facebook says so', async () => {
    vi.stubGlobal('fetch', graphError(400, { message: 'The user has not authorized application', code: 190 }))
    expect(await checkPageToken('t', '111')).toBe('expired')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: '111' }), { status: 200 })))
    expect(await checkPageToken('t', '111')).toBe('ok')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await checkPageToken('t', '111')).toBe('unknown')
    vi.stubGlobal('fetch', graphError(500, { message: 'An unexpected error has occurred', code: 2 }))
    expect(await checkPageToken('t', '111')).toBe('unknown')
  })

  it('never puts the token in the error it raises', async () => {
    vi.stubGlobal('fetch', graphError(400, { message: 'Error validating access token', code: 190 }))
    const e = (await subscribePage('SECRET-PAGE-TOKEN', '111').catch((x: unknown) => x)) as Error
    expect(e.message).not.toContain('SECRET-PAGE-TOKEN')
  })
})
