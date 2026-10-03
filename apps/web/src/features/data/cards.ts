/**
 * Memory cards on a data record: a count, and the cards by name when the
 * studio labels them ("SD-04"). Kept apart from the dialog so it can be
 * argued with in tests.
 */

/** A typed card name as it is stored: trimmed, upper-case, at most 20 characters. */
export const cleanCardLabel = (raw: string): string => raw.trim().toUpperCase().slice(0, 20)

/**
 * Add what was typed. Several at once are fine ("SD-01, SD-02"); a name
 * already there is not added twice. Never more than 40.
 */
export function addCardLabels(labels: readonly string[], typed: string): string[] {
  const out = [...labels]
  for (const part of typed.split(/[,\n]/)) {
    const label = cleanCardLabel(part)
    if (label && !out.includes(label) && out.length < 40) out.push(label)
  }
  return out
}

/** "3 cards · SD-01, SD-02, SD-04", "2 cards", or null when nothing is known. */
export function cardsLine(count: number | null | undefined, labels: readonly string[] = []): string | null {
  const n = Math.max(count ?? 0, labels.length)
  if (n === 0) return null
  const words = `${n} card${n === 1 ? '' : 's'}`
  return labels.length ? `${words} · ${labels.join(', ')}` : words
}
