/**
 * Keeps an open tab on the newest release.
 *
 * Nobody is signed out unless they sign out (0221), so a tab, the desktop
 * app or the Android app can stay open for days on the build it first
 * loaded, and a deploy never reaches it: studios said the new Enquiry form &
 * QR codes page "is not on our account". Every few minutes, and whenever the
 * tab comes back into view, we read the live index.html and compare its main
 * script with ours. When a new one is out, the next tap on a link loads the
 * page fresh, and a tab sitting in the background reloads at once. Forms keep
 * their drafts (useFormDraft), so nothing typed is lost.
 */

const CHECK_EVERY_MS = 10 * 60_000
const MIN_GAP_MS = 60_000

/** The main script an index.html names, e.g. "/assets/index-XZSFM8hr.js". */
export function mainScriptOf(html: string): string | null {
  return html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null
}

/** True when the live page names a different main script from the one running. */
export function isNewer(running: string | null, live: string | null): boolean {
  return !!running && !!live && running !== live
}

function runningScript(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  return el ? new URL(el.src).pathname : null
}

let stale = false
let lastCheck = 0

async function check(): Promise<void> {
  if (stale || Date.now() - lastCheck < MIN_GAP_MS) return
  lastCheck = Date.now()
  try {
    const res = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } })
    if (!res.ok) return
    if (isNewer(runningScript(), mainScriptOf(await res.text()))) {
      stale = true
      if (document.visibilityState === 'hidden') window.location.reload()
    }
  } catch {
    /* offline or the host is busy: try again later */
  }
}

/**
 * Start watching. `onNavigate` subscribes to the router's navigations and
 * returns nothing useful; a stale tab turns the next one into a full load.
 */
export function watchForNewRelease(onNavigate: (cb: (href: string) => void) => void): void {
  if (typeof window === 'undefined' || !import.meta.env.PROD) return
  if (!runningScript()) return
  onNavigate((href) => {
    if (stale) window.location.assign(href)
  })
  window.setInterval(() => void check(), CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
    else if (stale) window.location.reload()
  })
}
