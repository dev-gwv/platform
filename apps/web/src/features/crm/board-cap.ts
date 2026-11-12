/**
 * A board column draws its first 30 cards and offers the rest behind
 * "Show N more": a column of 600 enquiries is 600 cards to lay out before the
 * page can scroll, and nobody reads past the first screenful without asking.
 */
export const BOARD_CAP = 30

export function capped<T>(list: readonly T[], expanded: boolean, cap = BOARD_CAP): { shown: readonly T[]; more: number } {
  if (expanded || list.length <= cap) return { shown: list, more: 0 }
  return { shown: list.slice(0, cap), more: list.length - cap }
}
