/**
 * The words and links around the enquiry form (0274): where a client lands
 * after sending, what the studio shares, and what a partner is sent. One
 * place, so the API, the hub and the public page say the same thing.
 */

/** wa.me wants the number as digits with the country code: 919876543210. */
export function waDigits(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length === 10) return `91${d}`
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`
  return d.length >= 11 && d.length <= 15 ? d : null
}

/** A chat with that number, the text typed in. No number: WhatsApp asks whom to send it to. */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  const d = waDigits(phone)
  return `https://wa.me/${d ?? ''}?text=${encodeURIComponent(text)}`
}

/** +91 98769 21126 */
export function formatIndianPhone(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '')
  const ten = d.slice(-10)
  if (ten.length < 10) return phone ?? ''
  return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`
}

/** What the studio stores: +91 and ten digits, or null when it is not a mobile number. */
export function toIndianMobile(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d
  return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null
}

export const firstWord = (name: string): string => name.trim().split(/\s+/)[0] ?? name

/** The studio sharing its form link. */
export const formShareText = (link: string): string =>
  `Tell us about your event and we'll get back to you: ${link}`

/** The studio sending a partner their page. */
export const partnerPageText = (partner: string, studio: string, link: string): string =>
  `Hi ${firstWord(partner)}, here is your page for enquiries that come to ${studio} through your QR code. ` +
  `You can see each one and where it stands: ${link}`

/** The studio's own first line, or the default one. */
export const whatsappFirstLine = (studio: string, own?: string | null): string =>
  own?.trim() || `Hi ${studio}! I just sent you an enquiry.`

/** The sample under the first line in "What they'll send you". */
export const whatsappPreview = (studio: string, own?: string | null): string =>
  `${whatsappFirstLine(studio, own)}\n\nName: Priya Sharma\nEvent: Wedding, 14 Feb 2027`

/** A form or partner link: the main form's readable link, with ?p= for a partner. */
export function partnerFormUrl(formUrl: string, code: string): string {
  return `${formUrl}${formUrl.includes('?') ? '&' : '?'}p=${code}`
}

/** "12 scans · 4 enquiries · 1 booked" -- singular at 1, booked left out at 0. */
export function partnerCounts(scans: number, enquiries: number, booked: number): string {
  const parts = [`${scans} ${scans === 1 ? 'scan' : 'scans'}`, `${enquiries} ${enquiries === 1 ? 'enquiry' : 'enquiries'}`]
  if (booked > 0) parts.push(`${booked} booked`)
  return parts.join(' · ')
}

/** A file or link name: lowercase words joined by dashes. */
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '') || 'studio'

/** The kinds a partner can tick; "Something else" adds the studio's own. */
export const PARTNER_KINDS = [
  'Boutique',
  'Jeweller',
  'Venue',
  'Salon',
  'Photographer',
  'Decorator',
  'Wedding planner',
  'Caterer',
  'Influencer',
  'Store',
] as const

/** Saved as one text, ", "-joined; read back by splitting on commas. */
export const joinKinds = (kinds: readonly string[]): string | null => {
  const clean = [...new Set(kinds.map((k) => k.trim()).filter(Boolean))]
  return clean.length ? clean.join(', ').slice(0, 120) : null
}
export const splitKinds = (label: string | null | undefined): string[] =>
  (label ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

/** The studio sending a partner their own QR link, to share or print. */
export const partnerQrText = (partner: string, studio: string, link: string): string =>
  `Hi ${firstWord(partner)}, here is ${studio}'s enquiry link for your counter. ` +
  `Every enquiry through it is marked as yours: ${link}`

/** "today", "yesterday", "4 days ago", "3 weeks ago", "5 months ago". */
export function agoWords(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

type PartnerFigures = {
  scans: number
  enquiries: number
  booked: number
  last_enquiry_at?: string | null | undefined
  page_viewed_at?: string | null | undefined
}

/**
 * One partner as a sentence (owner, 20 Oct audit): "12 scans · 4 enquiries ·
 * 1 booked (25%) · last one 4 days ago · saw their page yesterday".
 */
export function partnerLine(p: PartnerFigures, now: Date = new Date()): string {
  const parts = [`${p.scans} ${p.scans === 1 ? 'scan' : 'scans'}`, `${p.enquiries} ${p.enquiries === 1 ? 'enquiry' : 'enquiries'}`]
  if (p.booked > 0) parts.push(`${p.booked} booked${p.enquiries > 0 ? ` (${Math.round((p.booked / p.enquiries) * 100)}%)` : ''}`)
  if (p.last_enquiry_at) parts.push(`last one ${agoWords(p.last_enquiry_at, now)}`)
  if (p.page_viewed_at) parts.push(`saw their page ${agoWords(p.page_viewed_at, now)}`)
  return parts.join(' · ')
}

/** The partner who brought the most bookings (then enquiries), when anyone has booked at all. */
export function topPartnerId<T extends { id: string; booked: number; enquiries: number }>(rows: readonly T[]): string | null {
  let top: T | null = null
  for (const r of rows) {
    if (r.booked <= 0) continue
    if (!top || r.booked > top.booked || (r.booked === top.booked && r.enquiries > top.enquiries)) top = r
  }
  return rows.length > 1 && top ? top.id : null
}

