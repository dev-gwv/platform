import { buildWhatsAppUrl, type ProjectGallery } from '@ipc/contracts'

type Gallery = NonNullable<ProjectGallery['gallery']>
type Client = NonNullable<ProjectGallery['client']>

const PLAN_NAMES: Record<string, string> = { starter: 'Starter', studio: 'Studio', pro: 'Pro', agency: 'Agency' }
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** "3 Mar 2027" from an ISO date or time. */
export const galleryDate = (iso: string) => dateFmt.format(new Date(iso))

/** "140 visits · 12 guests signed up", or null before anyone has opened it. */
export function galleryFigures(g: Gallery): string | null {
  const parts = [
    g.visits > 0 ? `${g.visits} ${g.visits === 1 ? 'visit' : 'visits'}` : null,
    g.guests ? `${g.guests} ${g.guests === 1 ? 'guest' : 'guests'} signed up` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/**
 * The client's own message: the link, the guests' PIN and their own
 * full-access PIN, to their number. The number goes through the one WhatsApp
 * rule (`normalizePhoneForWhatsApp`), so "098450 55012", "+91 98450 55012"
 * and "9845055012" all reach the same chat; null without a number.
 */
export function clientWhatsapp(client: Client, projectName: string, g: Gallery): { firstName: string; href: string } | null {
  if (!(client.phone ?? '').replace(/\D/g, '')) return null
  const firstName = client.name.trim().split(/\s+/)[0] || 'client'
  const lines = [
    `Hi ${firstName}! Your photos from ${projectName} are ready: ${g.gallery_url}`,
    g.pin ? `PIN for your guests: ${g.pin}` : null,
    g.full_access_pin ? `Your own PIN (shows every photo): ${g.full_access_pin}` : null,
  ].filter(Boolean)
  return { firstName, href: buildWhatsAppUrl(client.phone, lines.join('\n')) }
}

/** The plan line on Settings → Gallery: "Starter plan till 3 Mar 2027", or when it ended. */
export function framelinePlanLine(plan: string | null, validTill: string | null, now: number = Date.now()): { text: string; ended: boolean } | null {
  if (!plan && !validTill) return null
  const name = plan ? `${PLAN_NAMES[plan] ?? plan} plan` : 'Plan'
  if (!validTill) return { text: name, ended: false }
  const t = Date.parse(validTill)
  if (Number.isFinite(t) && t < now) return { text: `${name} ended on ${galleryDate(validTill)}. Renew it in Frameline.`, ended: true }
  return { text: `${name} till ${galleryDate(validTill)}`, ended: false }
}

