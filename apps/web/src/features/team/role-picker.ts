import type { PickableRole } from './bulk'

/** What was typed, ready to compare: trimmed, one space between words, lower case. */
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** The roles whose name contains what was typed; everything when nothing was. */
export function filterRoles(pickable: readonly PickableRole[], q: string): PickableRole[] {
  const needle = norm(q)
  if (!needle) return [...pickable]
  return pickable.filter((r) => norm(r.type_name).includes(needle))
}

/** A role already in the list under that exact name, if there is one. */
export const exactRole = (pickable: readonly PickableRole[], q: string): PickableRole | undefined => {
  const needle = norm(q)
  return needle ? pickable.find((r) => norm(r.type_name) === needle) : undefined
}

/**
 * Whether what was typed can become a new role: at least two characters, and
 * not the name of one the list already has (then the answer is to pick it).
 */
export const canOfferNew = (pickable: readonly PickableRole[], q: string): boolean =>
  norm(q).length >= 2 && !exactRole(pickable, q)

/** "Candid Photographer, Editor and 2 more" for the status line under the box. */
export function chosenSummary(names: readonly string[], max = 2): string {
  if (names.length === 0) return ''
  const shown = names.slice(0, max).join(', ')
  const rest = names.length - max
  return rest > 0 ? `${shown} and ${rest} more` : shown
}
