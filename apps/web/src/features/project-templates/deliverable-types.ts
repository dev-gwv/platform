/**
 * A day count typed into one of the deliverable-type boxes.
 *
 * Blank is not zero: blank means "not set", so the usual number for that name
 * answers instead, while 0 is a real answer ("no work needed"). Anything else
 * has to be a whole number the API will take, and saying why here beats a 422.
 */
export type ParsedDays = { ok: true; value: number | null } | { ok: false; message: string }

export const MAX_DAYS = 365

export function parseDays(text: string): ParsedDays {
  const t = text.trim()
  if (!t) return { ok: true, value: null }
  if (!/^\d+$/.test(t)) return { ok: false, message: 'Type a number of days, like 30.' }
  const n = Number(t)
  if (n > MAX_DAYS) return { ok: false, message: `Up to ${MAX_DAYS} days.` }
  return { ok: true, value: n }
}

/** A stored day count as the box shows it: blank when not set. */
export const daysText = (n: number | null): string => (n === null ? '' : String(n))
