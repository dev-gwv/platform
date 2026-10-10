/**
 * Razorpay Checkout, loaded on demand. The script is only injected when a
 * checkout actually opens — nobody pays for a payment SDK on the dashboard.
 */
const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

interface CheckoutSuccess {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface RazorpayOptions {
  key: string
  amount: number
  currency: string
  name: string
  description?: string
  order_id: string
  prefill?: { name?: string; email?: string }
  theme?: { color?: string }
  handler: (response: CheckoutSuccess) => void
  modal?: { ondismiss?: () => void }
}

interface RazorpayInstance {
  open(): void
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

let loading: Promise<boolean> | null = null

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true)
  loading ??= new Promise<boolean>((resolve) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve(!!window.Razorpay)
    script.onerror = () => {
      loading = null
      resolve(false)
    }
    document.head.appendChild(script)
  })
  return loading
}

interface OpenCheckoutInput {
  keyId: string
  razorpayOrderId: string
  amountRupees: number
  currency: string
  studioName: string
  description: string
  prefill?: { name?: string; email?: string }
}

/**
 * Resolves with the payment proof on success, or null when the person closed
 * the sheet. Rejects only if the SDK could not load.
 */
export async function openCheckout(input: OpenCheckoutInput): Promise<CheckoutSuccess | null> {
  const ready = await loadRazorpay()
  if (!ready || !window.Razorpay) throw new Error('The payment window could not be loaded. Check your connection and try again.')
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: input.keyId,
      amount: Math.round(input.amountRupees * 100),
      currency: input.currency,
      name: input.studioName,
      description: input.description,
      order_id: input.razorpayOrderId,
      ...(input.prefill ? { prefill: input.prefill } : {}),
      theme: { color: '#1b2a4a' },
      handler: (response) => resolve(response),
      modal: { ondismiss: () => resolve(null) },
    })
    rzp.open()
  })
}
