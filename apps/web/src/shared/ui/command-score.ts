/**
 * Ranking for the command palette.
 *
 * Kept apart from the component because this is the part that can be quietly
 * wrong: a palette that finds nothing for "prof" or puts "Production Board"
 * above "Profitability" is useless in a way no type checks.
 */

/** Higher is better. `null` means no match at all — the item is dropped. */
export function scoreMatch(query: string, text: string): number | null {
  const q = query.trim().toLowerCase()
  const t = text.toLowerCase()
  if (q === '') return 1
  if (t === q) return 1000

  // Typing the start of a name is the commonest case and should always win.
  if (t.startsWith(q)) return 900 - t.length

  // "board" should find "Production Board", not just things starting with it.
  const words = t.split(/[\s/&·—-]+/).filter(Boolean)
  if (words.some((w) => w.startsWith(q))) return 700 - t.length

  // Initials: "pb" finds "Production Board".
  if (q.length > 1 && words.length > 1) {
    const initials = words.map((w) => w[0]).join('')
    if (initials.startsWith(q)) return 600 - t.length
  }

  if (t.includes(q)) return 500 - t.length

  // Last resort, characters in order but not adjacent: "prft" finds
  // "Profitability". Scored below everything above so it never outranks a
  // real substring hit.
  const gaps = subsequenceGaps(q, t)
  if (gaps !== null) return 300 - gaps - t.length / 100

  return null
}

/**
 * Characters of `q` appearing in order within `t`; returns how scattered they
 * were, or null if they do not all appear. Fewer gaps is a tighter match.
 */
function subsequenceGaps(q: string, t: string): number | null {
  let gaps = 0
  let at = -1
  for (const ch of q) {
    const next = t.indexOf(ch, at + 1)
    if (next === -1) return null
    if (at !== -1) gaps += next - at - 1
    at = next
  }
  return gaps
}

interface Ranked<T> {
  item: T
  score: number
}

/**
 * Filter and sort by match quality. Ties keep the original order, so the nav's
 * own ordering survives an empty query rather than being shuffled.
 */
export function rankBy<T>(
  query: string,
  items: readonly T[],
  textOf: (item: T) => string,
  limit = 8,
): T[] {
  const ranked: Array<Ranked<T> & { at: number }> = []
  items.forEach((item, at) => {
    const score = scoreMatch(query, textOf(item))
    if (score !== null) ranked.push({ item, score, at })
  })
  ranked.sort((a, b) => b.score - a.score || a.at - b.at)
  return ranked.slice(0, limit).map((r) => r.item)
}
