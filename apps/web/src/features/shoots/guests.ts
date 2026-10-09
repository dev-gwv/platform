/**
 * How many guests a shoot day expects (0251). The studio plans the crew and
 * the cards from it, so it rides on the day's line beside the venue.
 */

/** "350 guests", "1 guest", "1,200 guests"; null when nobody has said. */
export function guestsLabel(count: number | null | undefined): string | null {
  if (count == null) return null
  return `${count.toLocaleString('en-IN')} ${count === 1 ? 'guest' : 'guests'}`
}

/**
 * What the box holds, as the API wants it: a whole number, or null for blank.
 * Commas and spaces are forgiven ("1,200"); anything else that is not a whole
 * number is treated as blank rather than refused.
 */
export function guestCountFromText(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, '')
  if (!/^\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return n <= 100000 ? n : null
}

/** The box's text for a stored count. */
export const guestCountText = (count: number | null | undefined): string => (count == null ? '' : String(count))
