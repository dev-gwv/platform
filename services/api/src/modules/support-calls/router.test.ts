import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv } from '../../context'
import { signSupportCall } from '../../lib/support-calls'
import { supportCallWebhookRouter } from './router'

/**
 * The booking notice is refused before anything is read or written unless it
 * is signed with SUPPORT_CALL_WEBHOOK_SECRET, recent, and well formed.
 */
const app = new Hono<AppEnv>().route('/webhooks', supportCallWebhookRouter)
const env = { SUPPORT_CALL_WEBHOOK_SECRET: 'shh' } as unknown as AppEnv['Bindings']
const post = (body: string, signature?: string) =>
  app.request('/webhooks/support-call', { method: 'POST', body, headers: signature ? { 'x-signature': signature } : {} }, env)

describe('POST /webhooks/support-call', () => {
  it('refuses a notice with no signature, a wrong one or an old one', async () => {
    const body = '{"id":"evt_1"}'
    const now = Math.floor(Date.now() / 1000)
    expect((await post(body)).status).toBe(401)
    expect((await post(body, `t=${now},v1=${await signSupportCall(body, 'not it', now)}`)).status).toBe(401)
    expect((await post(body, `t=${now - 3600},v1=${await signSupportCall(body, 'shh', now - 3600)}`)).status).toBe(401)
  })

  it('refuses a signed notice that is not a booking', async () => {
    const body = '{"id":"evt_1","event":"booking.created"}'
    const now = Math.floor(Date.now() / 1000)
    const res = await post(body, `t=${now},v1=${await signSupportCall(body, 'shh', now)}`)
    expect(res.status).toBe(400)
  })

  it('refuses everything while the server has no secret', async () => {
    const body = '{"id":"evt_1"}'
    const now = Math.floor(Date.now() / 1000)
    const res = await app.request(
      '/webhooks/support-call',
      { method: 'POST', body, headers: { 'x-signature': `t=${now},v1=${await signSupportCall(body, 'anything', now)}` } },
      {} as AppEnv['Bindings'],
    )
    expect(res.status).toBe(401)
  })
})
