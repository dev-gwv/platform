/**
 * Money maths. Rupees are held as JS numbers at the boundary but ALL rounding
 * goes through here so tax/discount permutations never drift by a paisa.
 * Internally we round via integer paise to dodge float error.
 */

/** Round a rupee amount to 2 decimals (nearest paisa), half-up. */
export function roundINR(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

/** Sum a list of rupee amounts with a single final rounding. */
export function sumINR(amounts: ReadonlyArray<number>): number {
  return roundINR(amounts.reduce((a, b) => a + b, 0))
}

/**
 * Apply a discount to a base amount.
 * `kind: 'percent'` → value is 0..100; `kind: 'flat'` → value is rupees.
 * Never returns below zero.
 */
export function applyDiscount(
  base: number,
  discount: { kind: 'percent' | 'flat'; value: number },
): number {
  const off = discount.kind === 'percent' ? (base * discount.value) / 100 : discount.value
  return roundINR(Math.max(0, base - off))
}
