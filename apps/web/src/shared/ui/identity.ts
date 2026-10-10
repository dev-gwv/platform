/**
 * Turning a person's name into something you can recognise at a glance.
 *
 * A studio's lists are full of the same handful of people; initials in a
 * consistent colour let the eye find "Sana's rows" without reading a word.
 * The colour is derived from the name, so it is the same on every screen and
 * every device without anything being stored.
 */

/** Letters only — an apostrophe or a bracket is not an initial. */
const letters = (word: string): string => word.replace(/[^a-z0-9]/gi, '')

/** Up to two initials: first and last word, or the first two letters. */
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .map(letters)
    .filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase()
}

/**
 * A stable hue per name. Deliberately not random and not stored: the same
 * person is the same colour in the directory, on a task, and in attendance.
 */
export function hueFor(name: string | null | undefined): number {
  const key = (name ?? '').trim().toLowerCase()
  if (!key) return 0
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360_000
  }
  return hash % 360
}

interface AvatarColors {
  background: string
  color: string
}

/**
 * Light tint, dark ink of the same hue — legible on both light and dark
 * surfaces, and quiet enough that a row of them does not shout over the text
 * they sit beside.
 */
export function avatarColors(name: string | null | undefined, dark = false): AvatarColors {
  const hue = hueFor(name)
  return dark
    ? { background: `oklch(0.32 0.06 ${hue})`, color: `oklch(0.88 0.08 ${hue})` }
    : { background: `oklch(0.92 0.05 ${hue})`, color: `oklch(0.42 0.12 ${hue})` }
}
