import { createHmac } from 'node:crypto'
import { Hono } from 'hono'
import type { TransactionSql } from 'postgres'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../../context'
import type * as DbModule from '../../lib/db'
import { errorHandler } from '../../middleware/errors'
import { requestId } from '../../middleware/request-id'
import { webhooksRouter } from './router'

/**
 * POST /webhooks/razorpay (CLAUDE.md, 0226): only money that arrived gives a
 * plan. The route runs as written; only the database is a fake, which answers
 * the three statements the route sends -- the ledger write, the order lookup
 * and activate_subscription -- and records what it was asked.
 */
interface Call {
  text: string
  values: unknown[]
}

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  fresh: true as boolean,
  orderId: 'po-1' as string | null,
  failLedger: false,
  failActivate: false,
}))

vi.mock('../../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>()
  const sql = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?')
      db.calls.push({ text, values })
      if (text.includes('record_webhook_event')) {
        if (db.failLedger) throw new Error('ledger down')
        return [{ fresh: db.fresh }]
      }
      if (text.includes('from payment_orders')) return db.orderId ? [{ id: db.orderId }] : []
      if (text.includes('activate_subscription')) {
        if (db.failActivate) throw new Error('activation failed')
        return [{ duplicate: false, expires_at: null }]
      }
      throw new Error(`unexpected statement: ${text}`)
    },
    { json: (v: unknown) => v },
  )
  return {
    ...actual,
    withService: vi.fn(async (_env: unknown, fn: (s: TransactionSql) => Promise<unknown>) => fn(sql as unknown as TransactionSql)),
    withUser: vi.fn(async () => {
      throw new Error('the Razorpay webhook must not run as a user')
    }),
  }
})

// A made-up secret for tests only; never a real key.
const SECRET = 'test-only-webhook-secret'
const env = { ENVIRONMENT: 'test', RAZORPAY_WEBHOOK_SECRET: SECRET } as AppEnv['Bindings']

const app = new Hono<AppEnv>()
app.use('*', requestId)
app.route('/webhooks', webhooksRouter)
app.onError(errorHandler)

const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex')

function event(name: string, payment: Record<string, unknown> = { id: 'pay_TEST1', order_id: 'order_TEST1' }, id = `evt_${name}`) {
  return JSON.stringify({ id, event: name, payload: { payment: { entity: { amount: 3300000, ...payment } } } })
}

function post(body: string, signature: string | null = sign(body), bindings: AppEnv['Bindings'] = env) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature !== null) headers['x-razorpay-signature'] = signature
  return app.request('/webhooks/razorpay', { method: 'POST', body, headers }, bindings)
}

const ledgerWrites = () => db.calls.filter((c) => c.text.includes('record_webhook_event'))
const activations = () => db.calls.filter((c) => c.text.includes('activate_subscription'))

beforeEach(() => {
  db.calls = []
  db.fresh = true
  db.orderId = 'po-1'
  db.failLedger = false
  db.failActivate = false
  // attempt() and the unknown-order warning log to stderr; keep the run quiet.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a webhook that is not Razorpay’s', () => {
  it('is refused with 401 and never reaches the database', async () => {
    const body = event('payment.captured')
    const res = await post(body, sign(body, 'not-the-secret'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid signature.' })
    expect(db.calls).toEqual([])
  })

  it('is refused without a signature header', async () => {
    const res = await post(event('payment.captured'), null)
    expect(res.status).toBe(401)
    expect(db.calls).toEqual([])
  })

  it('is refused when the body was changed after signing (a failure dressed up as a capture)', async () => {
    const real = event('payment.failed')
    const forged = real.replace('payment.failed', 'payment.captured')
    const res = await post(forged, sign(real))
    expect(res.status).toBe(401)
    expect(db.calls).toEqual([])
  })

  it('is refused while no webhook secret is set on the server', async () => {
    const body = event('payment.captured')
    const res = await post(body, sign(body, ''), { ...env, RAZORPAY_WEBHOOK_SECRET: '' })
    expect(res.status).toBe(401)
    expect(db.calls).toEqual([])
  })
})

describe('an event that is not money arriving', () => {
  it.each(['payment.failed', 'payment.authorized', 'refund.created', 'refund.processed', 'payment.dispute.created', 'order.notification.delivered'])(
    '%s is recorded in the ledger and never activates a plan',
    async (name) => {
      const res = await post(event(name))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(ledgerWrites()).toHaveLength(1)
      expect(activations()).toEqual([])
      expect(db.calls.some((c) => c.text.includes('from payment_orders'))).toBe(false)
    },
  )

  it('an event with no name never activates', async () => {
    const body = JSON.stringify({ id: 'evt_noname', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } })
    const res = await post(body)
    expect(res.status).toBe(200)
    expect(activations()).toEqual([])
  })
})

describe('money that arrived', () => {
  it.each(['payment.captured', 'order.paid'])('%s activates the order it was paid against', async (name) => {
    const res = await post(event(name, { id: 'pay_LIVE42', order_id: 'order_RZP42' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(ledgerWrites()).toHaveLength(1)
    expect(ledgerWrites()[0]!.values[0]).toBe(`evt_${name}`)
    const lookup = db.calls.find((c) => c.text.includes('from payment_orders'))
    expect(lookup?.values).toEqual(['order_RZP42'])
    expect(activations()).toHaveLength(1)
    expect(activations()[0]!.values).toEqual(['po-1', 'pay_LIVE42'])

    // The ledger row is written before anything is activated.
    const order = db.calls.map((c) => c.text)
    expect(order.findIndex((t) => t.includes('record_webhook_event'))).toBeLessThan(
      order.findIndex((t) => t.includes('activate_subscription')),
    )
  })

  it('a replayed event that is not a payment is a no-op', async () => {
    db.fresh = false
    const res = await post(event('payment.failed'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
    expect(activations()).toEqual([])
  })

  it('a replayed capture tries the plan again (a no-op for an order already paid)', async () => {
    db.fresh = false
    const res = await post(event('payment.captured'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
    expect(activations()).toHaveLength(1)
  })

  it('when the plan cannot be activated, answers 503 so Razorpay sends it again', async () => {
    db.failActivate = true
    const res = await post(event('payment.captured'))
    expect(res.status).toBe(503)
  })

  it('a capture for an order we never made activates nothing', async () => {
    db.orderId = null
    const res = await post(event('payment.captured'))
    expect(res.status).toBe(200)
    expect(activations()).toEqual([])
  })

  it('a capture missing its order or payment id activates nothing', async () => {
    for (const payment of [{ id: 'pay_1', order_id: undefined }, { id: undefined, order_id: 'order_1' }]) {
      db.calls = []
      const res = await post(event('payment.captured', payment, `evt_${String(payment.id)}_${String(payment.order_id)}`))
      expect(res.status).toBe(200)
      expect(activations()).toEqual([])
    }
  })

  it('when the ledger cannot be written, answers 503 so Razorpay retries, and activates nothing', async () => {
    db.failLedger = true
    const res = await post(event('payment.captured'))
    expect(res.status).toBe(503)
    expect(activations()).toEqual([])
  })
})

describe('a signed body that is not an event', () => {
  it('is 422 when it is not JSON', async () => {
    const res = await post('not json')
    expect(res.status).toBe(422)
    expect(db.calls).toEqual([])
  })

  it('is 422 without an event id', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } })
    const res = await post(body)
    expect(res.status).toBe(422)
    expect(db.calls).toEqual([])
  })
})
