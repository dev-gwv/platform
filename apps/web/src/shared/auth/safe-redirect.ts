/**
 * Where a `?redirect=` may send someone after signing in: a page of this site
 * only. The address is resolved the way the browser would resolve it, so
 * `//evil.com`, `/\evil.com` (browsers read a backslash as a slash) and
 * `https://evil.com` all land somewhere else and are refused. Returns the
 * same-site path (with its query and hash) or null.
 */
export function safeRedirect(redirect: string | null | undefined, origin: string): string | null {
  if (!redirect || !redirect.startsWith('/')) return null
  // A backslash or a control character has no business in one of our paths.
  if (redirect.includes('\\') || [...redirect].some((ch) => ch.charCodeAt(0) < 0x20)) return null
  let url: URL
  try {
    url = new URL(redirect, origin)
  } catch {
    return null
  }
  if (url.origin !== new URL(origin).origin) return null
  return `${url.pathname}${url.search}${url.hash}`
}
