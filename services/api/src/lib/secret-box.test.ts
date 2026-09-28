import { describe, expect, it } from 'vitest'
import { open, seal, secretBoxReady } from './secret-box'

const env = { ENVIRONMENT: 'production', JWT_SECRET: 'j', WHATSAPP_TOKEN_KEY: 'a-long-server-key' }

describe('secret box', () => {
  it('round-trips, and the stored form never contains the secret', async () => {
    const sealed = await seal(env, 'EAAG-token-123')
    expect(sealed.startsWith('v1:')).toBe(true)
    expect(sealed).not.toContain('EAAG')
    expect(await open(env, sealed)).toBe('EAAG-token-123')
  })

  it('cannot be opened with another key', async () => {
    const sealed = await seal(env, 'EAAG-token-123')
    await expect(open({ ...env, WHATSAPP_TOKEN_KEY: 'other' }, sealed)).rejects.toThrow()
  })

  it('refuses in production without a key, works in dev', async () => {
    expect(secretBoxReady({ ENVIRONMENT: 'production', JWT_SECRET: 'j' })).toBe(false)
    await expect(seal({ ENVIRONMENT: 'production', JWT_SECRET: 'j' }, 'x')).rejects.toThrow(/WHATSAPP_TOKEN_KEY/)
    expect(secretBoxReady({ ENVIRONMENT: 'ci', JWT_SECRET: 'j' })).toBe(true)
  })
})
