/**
 * The arithmetic and the two derivations the invoice form does, kept out of
 * the component so they can be tested without rendering a dialog.
 */

/**
 * A line while it is being typed.
 *
 * Quantity and rate are STRINGS on purpose. Held as numbers and round-tripped
 * through `Number()` on every keystroke, "1500." collapses to 1500 and the box
 * re-renders without the dot — so paise could not be typed at all. A string
 * keeps the half-finished value the user is looking at, and the parse happens
 * once, at the edge.
 */
export interface InvoiceLineDraft {
  description: string
  subtext?: string | undefined
  quantity: string
  rate: string
  gst_rate: number
  /** HSN (goods) or SAC (services), digits only. */
  hsn_sac?: string | undefined
  /** The saved item this line was picked from, if any. */
  preset_id?: string | undefined
}

/** Blank and half-typed values ("", "12.") are 0 so far — not an error. */
export const toAmount = (v: string): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The studio's own state, matched from its free-text address to a GST code.
 *
 * `companies.state` is a name ("Maharashtra"); place_of_supply is a code
 * ('27'). Matching them is what lets intra_state be derived instead of asked.
 */
export function matchStudioState<T extends { code: string; name: string }>(
  states: readonly T[] | undefined,
  companyState: string | null | undefined,
): T | undefined {
  const want = (companyState ?? '').trim().toLowerCase()
  if (!want) return undefined
  return (states ?? []).find((st) => st.name.trim().toLowerCase() === want)
}

/**
 * CGST+SGST or IGST, worked out from the two states rather than asked.
 *
 * It used to be a checkbox sitting next to the place-of-supply select, free to
 * contradict it — and picking the wrong one produces a tax split that is wrong
 * on a legal document without anything saying so. `null` means we cannot tell
 * (the studio's state does not match any GST state, or no place of supply is
 * chosen yet), and the caller leaves the current value alone.
 */
export function deriveIntraState(
  placeOfSupply: string,
  studioCode: string | null | undefined,
): boolean | null {
  if (!studioCode || !placeOfSupply) return null
  return placeOfSupply === studioCode
}
