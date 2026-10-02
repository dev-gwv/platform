/**
 * How long the studio took to first reach a lead, in words: "First contact in
 * 2 h". The same stamp as Reports > Team's "First response" (the first call,
 * WhatsApp, SMS, email or meeting logged; notes do not count), so the lead
 * and the report always agree.
 */
export function firstContactWords(createdAt: string, contactedAt: string | null): string | null {
  if (!contactedAt) return null
  const mins = Math.max(0, Math.round((Date.parse(contactedAt) - Date.parse(createdAt)) / 60_000))
  if (mins < 1) return 'First contact within a minute'
  if (mins < 60) return `First contact in ${mins} min`
  const hours = mins / 60
  if (hours < 24) return `First contact in ${Math.round(hours)} h`
  const days = Math.round(hours / 24)
  return `First contact in ${days} day${days === 1 ? '' : 's'}`
}
