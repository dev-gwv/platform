/**
 * The words and links around the enquiry form (0270): where a client lands
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
