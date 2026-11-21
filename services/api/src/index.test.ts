import { describe, expect, it } from 'vitest'
import { healthBody } from '@ipc/contracts'
import app from './index'

describe('api app', () => {
  it('GET /health is public, names no environment, and matches its contract', async () => {
    const res = await app.request('/health', {}, { ENVIRONMENT: 'test', APP_VERSION: '1.2.3' })
    expect(res.status).toBe(200)
    const body = healthBody.parse(await res.json())
    expect(body).toMatchObject({ ok: true, service: 'ipc-api', version: '1.2.3', db: 'not_configured' })
    expect(body).not.toHaveProperty('env')
    expect(res.headers.get('X-Request-Id')).toBeTruthy()
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
  })

  it('GET /health fails (503) in production when no database is configured', async () => {
    const res = await app.request('/health', {}, { ENVIRONMENT: 'production', APP_VERSION: '1.2.3' })
    expect(res.status).toBe(503)
    const body = healthBody.parse(await res.json())
    expect(body).toMatchObject({ ok: false, db: 'not_configured' })
  })

  it('unknown route 404s cleanly', async () => {
    const res = await app.request('/nope', {}, { ENVIRONMENT: 'test' })
    expect(res.status).toBe(404)
  })

  it('POST /health/client-errors accepts a small report and rejects junk', async () => {
    const env = { ENVIRONMENT: 'test' }
    const good = await app.request('/health/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'error', message: 'boom', url: 'https://app.example/crm' }),
    }, env)
    expect(good.status).toBe(200)
    expect(await good.json()).toEqual({ ok: true })

    const empty = await app.request('/health/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'error', message: '   ' }),
    }, env)
    expect(empty.status).toBe(422)

    const huge = await app.request('/health/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'error', message: 'x'.repeat(501) }),
    }, env)
    expect(huge.status).toBe(422)
  })

  it('the Meta handshake refuses a wrong verify token and answers the right one', async () => {
    const env = { ENVIRONMENT: 'test', META_VERIFY_TOKEN: 'shh' }
    const bad = await app.request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123', {}, env)
    expect(bad.status).toBe(403)
    const good = await app.request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=shh&hub.challenge=123', {}, env)
    expect(good.status).toBe(200)
    expect(await good.text()).toBe('123')
    // Unconfigured = closed, not open.
    const none = await app.request('/webhooks/meta?hub.mode=subscribe&hub.verify_token=&hub.challenge=1', {}, { ENVIRONMENT: 'test' })
    expect(none.status).toBe(403)
  })

  it('a Razorpay webhook with a bad signature is refused before the body is read', async () => {
    const res = await app.request(
      '/webhooks/razorpay',
      { method: 'POST', body: 'not json', headers: { 'x-razorpay-signature': 'deadbeef' } },
      { ENVIRONMENT: 'test', RAZORPAY_WEBHOOK_SECRET: 's3cret' },
    )
    expect(res.status).toBe(401)
  })
})
