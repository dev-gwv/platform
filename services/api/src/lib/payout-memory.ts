/** One-tap payouts (owner, 11 Nov): what was paid before, read from past bookings. */

/** Amounts newest first, each once, at most three. */
export function lastAmounts(rows: { amount: number }[], max = 3): number[] {
  const out: number[] = []
  for (const r of rows) if (r.amount > 0 && !out.includes(r.amount) && out.length < max) out.push(r.amount)
  return out
}

/** Amounts by how often they were paid (ties: the newest first), at most three. */
export function usualAmounts(rows: { amount: number }[], max = 3): number[] {
  const count = new Map<number, number>()
  rows.forEach((r) => {
    if (r.amount > 0) count.set(r.amount, (count.get(r.amount) ?? 0) + 1)
  })
  // Map keeps first-seen order, which is newest first for rows given newest first.
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([a]) => a)
}
