/**
 * A rupee amount as a studio types it: "1,50,000", "₹ 15,000", "2500.50".
 * Commas, the rupee sign and spaces go; anything left that is not a number
 * is 0, so a half-typed field never turns a total into NaN. (Bug sweep,
 * 6 Nov: Number("1,50,000") is NaN, so a package typed with Indian commas
 * was saved as ₹0.)
 */
export function parseAmount(v: string | number | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(String(v ?? '').replace(/[,₹\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
