import type { Env } from '../context'

/**
 * Environments where it is safe to behave like a test bench: echo raw tokens in
 * responses, activate a plan without a payment signature. Fails CLOSED — an
 * unset or unrecognised ENVIRONMENT is treated as production.
 */
const DEV_LIKE = new Set(['development', 'test', 'ci', 'local'])

export const isDevLike = (env: Pick<Env, 'ENVIRONMENT'>): boolean =>
  DEV_LIKE.has(env.ENVIRONMENT ?? '')

/** Razorpay is "on" when both halves of the key pair are present. */
export const razorpayConfigured = (
  env: Pick<Env, 'RAZORPAY_KEY_ID' | 'RAZORPAY_KEY_SECRET'>,
): boolean => !!env.RAZORPAY_KEY_ID && !!env.RAZORPAY_KEY_SECRET
