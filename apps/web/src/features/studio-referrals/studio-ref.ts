/**
 * The referral code a new studio arrived with (?studio_ref=ABCD1234 on any
 * page). Kept in this browser for 60 days so a visitor who reads the home
 * page today and signs up next week still counts for the studio that sent
 * them. Only the code is stored -- never anything about the person.
 */
const KEY = 'studio_ref'
const DAYS = 60

export function parseStudioRef(search: string): string | null {
  const raw = new URLSearchParams(search).get('studio_ref')?.trim().toUpperCase() ?? ''
  return /^[A-Z0-9]{6,12}$/.test(raw) ? raw : null
}

export function captureStudioRef(search: string = window.location.search, now: number = Date.now()): void {
  const code = parseStudioRef(search)
  if (!code) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: now }))
  } catch {
    // Private window or blocked storage: the code rides only this visit.
  }
}

export function readStudioRef(now: number = Date.now(), search: string = window.location.search): string | null {
  const here = parseStudioRef(search)
  if (here) return here
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { code?: string; at?: number } | null
    if (!saved?.code || typeof saved.at !== 'number' || now - saved.at > DAYS * 86_400_000) return null
    return parseStudioRef(`?studio_ref=${saved.code}`)
  } catch {
    return null
  }
}

/** "Hi, I use Studio AutoPilot to run my studio…" -- the message the share button opens. */
export function shareText(studio: string, link: string): string {
  return `Hi! ${studio} runs on Studio AutoPilot -- leads, quotations, shoots, team and payments in one place. Try it with my link: ${link}`
}
