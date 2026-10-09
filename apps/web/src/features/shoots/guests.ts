/** "~400 guests" -- an estimate, so it always reads as one. */
export function guestsLabel(n: number | null | undefined): string | null {
  if (!n || n < 1) return null
  return `~${n.toLocaleString('en-IN')} guests`
}

/** What the box holds as a number for the API: blank is "not known". */
export function guestsValue(text: string): number | null {
  const n = Number.parseInt(text.replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100000) : null
}
