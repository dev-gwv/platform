import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyRazorpaySignature } from './razorpay'

// A made-up secret for tests only; never a real key.
const SECRET = 'test-only-razorpay-secret'
const sign = (message: string, secret = SECRET) => createHmac('sha256', secret).update(message).digest('hex')

describe('verifyRazorpaySignature', () => {
  it('accepts Razorpay’s HMAC-SHA256 over the raw webhook body', async () => {
    const body = JSON.stringify({ id: 'evt_1', event: 'payment.captured' })
    expect(await verifyRazorpaySignature(body, sign(body), SECRET)).toBe(true)
  })

  it('accepts a checkout signature over "order_id|payment_id"', async () => {
    const message = 'order_ABC|pay_XYZ'
    expect(await verifyRazorpaySignature(message, sign(message), SECRET)).toBe(true)
  })

  it('refuses a body changed after signing', async () => {
    const body = JSON.stringify({ id: 'evt_1', event: 'payment.failed' })
    const forged = body.replace('payment.failed', 'payment.captured')
    expect(await verifyRazorpaySignature(forged, sign(body), SECRET)).toBe(false)
  })

  it('refuses a signature made with another secret', async () => {
    const body = '{"id":"evt_1"}'
    expect(await verifyRazorpaySignature(body, sign(body, 'some-other-secret'), SECRET)).toBe(false)
  })

  it('refuses everything when no secret is set, even a body signed with an empty key', async () => {
    const body = '{"id":"evt_1"}'
    expect(await verifyRazorpaySignature(body, sign(body, ''), '')).toBe(false)
  })

  it('refuses a missing, truncated or padded signature', async () => {
    const body = '{"id":"evt_1"}'
    const good = sign(body)
    expect(await verifyRazorpaySignature(body, '', SECRET)).toBe(false)
    expect(await verifyRazorpaySignature(body, good.slice(0, -1), SECRET)).toBe(false)
    expect(await verifyRazorpaySignature(body, `${good}0`, SECRET)).toBe(false)
  })
})
