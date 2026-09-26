/**
 * A shoot's map link is stored as whatever was pasted: a real link, a plus
 * code, or a venue name shared from WhatsApp. Only the first is safe to put
 * behind an <a href>; the rest is shown as text.
 */
export function mapHref(link: string | null | undefined): string | null {
  const trimmed = link?.trim() ?? ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

/** A Google Maps search for a typed venue, for when there is no link. */
export function mapSearchHref(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
}
