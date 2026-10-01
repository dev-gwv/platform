/**
 * A pin out of whatever the owner pastes: a Google Maps link, a shared
 * "geo:" link, or plain "19.0760, 72.8777".
 *
 * Google writes the same spot several ways. A place page carries the pin as
 * `!3d<lat>!4d<lng>` and the map's centre as `@<lat>,<lng>,<zoom>z`; the pin
 * is the one that matters (the centre drifts as the map is panned), so it
 * wins. Search and direction links use `q=`, `query=`, `ll=` or
 * `destination=`. Short links (maps.app.goo.gl) carry no coordinates at all
 * -- the API follows them to the long form first (`isMapsHost`).
 */
export interface Pin {
  lat: number
  lng: number
}

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`

const valid = (lat: number, lng: number): Pin | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
    ? { lat, lng }
    : null

const PATTERNS: RegExp[] = [
  new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
  new RegExp(String.raw`[?&](?:q|query|ll|destination|center)=(?:loc:)?${NUM}(?:,|%2C)\s*${NUM}`, 'i'),
  new RegExp(String.raw`@${NUM},${NUM}`),
  new RegExp(String.raw`^geo:${NUM},${NUM}`, 'i'),
  new RegExp(String.raw`^\s*${NUM}\s*[, ]\s*${NUM}\s*$`),
]

export function coordsFromText(text: string): Pin | null {
  const t = decodeURIComponentSafe(text.trim())
  for (const re of PATTERNS) {
    const m = re.exec(t)
    if (!m) continue
    const pin = valid(Number(m[1]), Number(m[2]))
    if (pin) return pin
  }
  return null
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Google's map hosts, the only ones the API will follow a short link on. */
export function isMapsHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return (
    h === 'maps.app.goo.gl' ||
    h === 'goo.gl' ||
    /^(www\.|maps\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(h)
  )
}
