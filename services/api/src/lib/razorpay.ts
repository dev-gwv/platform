import type { Env } from '../context'
import { timingSafeEqual, toHex } from './crypto'

/**
 * Razorpay HMAC-SHA256 signature verification (Web Crypto — Workers-native).
 * For a payment: message = `${order_id}|${payment_id}`.
 * For a webhook: message = the raw request body.
 */
export async function verifyRazorpaySignature(
  message: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  if (!secret || !signatureHex) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return timingSafeEqual(toHex(mac), signatureHex)
}

interface RazorpayOrder {
  id: string
  amount: number
  currency: string
}

/**
 * Create an order with Razorpay's Orders API so Checkout has something to
 * charge against. `amount` is whole rupees; Razorpay wants paise. Throws on
 * any non-2xx so the caller can decide how to report it — an order that does
 * not exist at the provider must not be handed to the browser as if it did.
 */
export async function createRazorpayOrder(
  env: Pick<Env, 'RAZORPAY_KEY_ID' | 'RAZORPAY_KEY_SECRET'>,
  input: { amountRupees: number; receipt: string; notes?: Record<string, string> },
): Promise<RazorpayOrder> {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(input.amountRupees * 100),
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes ?? {},
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`razorpay order failed ${res.status}: ${detail.slice(0, 200)}`)
  }
  const body = (await res.json()) as { id?: string; amount?: number; currency?: string }
  if (!body.id) throw new Error('razorpay order response had no id')
  return { id: body.id, amount: body.amount ?? 0, currency: body.currency ?? 'INR' }
}

interface RazorpayPayment {
  id: string
  status: string
  amount: number
  order_id: string | null
  email: string | null
}

/**
 * The payments Razorpay holds for one order. Used before crediting an order
 * by hand: the payment id comes from Razorpay itself, never from a request.
 */
export async function fetchOrderPayments(
  env: Pick<Env, 'RAZORPAY_KEY_ID' | 'RAZORPAY_KEY_SECRET'>,
  razorpayOrderId: string,
): Promise<RazorpayPayment[]> {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)
  const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}/payments`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`razorpay payments lookup failed ${res.status}: ${detail.slice(0, 200)}`)
  }
  const body = (await res.json()) as { items?: Array<Partial<RazorpayPayment>> }
  return (body.items ?? [])
    .filter((p): p is Partial<RazorpayPayment> & { id: string } => typeof p.id === 'string')
    .map((p) => ({ id: p.id, status: p.status ?? '', amount: p.amount ?? 0, order_id: p.order_id ?? null, email: p.email ?? null }))
}
