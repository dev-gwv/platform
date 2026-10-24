/**
 * The booking app's calendar, opened over Studio AutoPilot (0279).
 *
 * The support call link is a booking page, `<booking app>/<owner>/<event>`.
 * The same app serves `/embed/<owner>/<event>`, a calendar made to sit in a
 * frame, which takes the person's name and email to fill in and passes the
 * utm_* tags into the booking, so each booking says which studio asked and
 * from which page (utm_content is the studio, utm_term its id, parent the page).
 */

/**
 * Booking apps whose calendar may open inside the app. Each one is also in
 * frame-src in public/_headers (a test checks), or the popup would be blank.
 */
export const BOOKING_APP_ORIGINS = ['https://calendly-common-meeting-web-bjvr.vercel.app'] as const

export interface SupportCallContext {
  name?: string | null | undefined
  email?: string | null | undefined
  studio?: string | null | undefined
  /** The studio's id, so the server can name its plan in the support group (0280). */
  companyId?: string | null | undefined
  /** The page they pressed it on, e.g. "/projects/123". */
  page: string
  /** Our own origin, for the booking app's "booked from" record. */
  origin: string
}

/** The calendar's in-app address for a support call link, or null when it cannot open inside the app. */
export function embedUrlFor(link: string | null | undefined, ctx: SupportCallContext): string | null {
  if (!link) return null
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  if (!(BOOKING_APP_ORIGINS as readonly string[]).includes(url.origin)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] === 'embed') parts.shift()
  // <owner> alone is the whole booking page; <owner>/<event> is one kind of call.
  if (parts.length < 1 || parts.length > 2) return null

  const params = new URLSearchParams({
    utm_source: 'studioautopilot',
    utm_medium: 'app',
    utm_campaign: 'support-call',
  })
  if (ctx.studio?.trim()) params.set('utm_content', ctx.studio.trim())
  if (ctx.companyId) params.set('utm_term', ctx.companyId)
  params.set('parent', ctx.origin + ctx.page)
  if (ctx.name?.trim()) params.set('name', ctx.name.trim())
  if (ctx.email?.trim()) params.set('email', ctx.email.trim())
  return `${url.origin}/embed/${parts.map(encodeURIComponent).join('/')}?${params.toString()}`
}
