/**
 * Cleaning the name, phone and email a lead arrives with, before capture_lead
 * sees them. Every lead path (Meta webhooks, web forms, the Test Center, a
 * retried import) goes through here, so a lead is never lost to a value the
 * database refuses.
 *
 * Why this exists: a lead also becomes a CRM contact (crm_link_contact, 0045),
 * and crm_contacts caps phone at 30 characters, name at 160 and email at 200.
 * Meta's Lead Ads Testing Tool fills the phone with placeholder text such as
 * "<test lead: dummy data for phone_number>" (40 characters), which failed
 * that check and dropped the whole lead. crm_leads.phone and
 * crm_contacts.phone are both nullable, so a phone we cannot use is stored as
 * null and its raw value kept in the lead's meta instead.
 */

const PHONE_MAX_DIGITS = 15 // E.164
const PHONE_MIN_DIGITS = 7 // what crm_normalize_phone (0013) treats as a number
const NAME_MAX = 160
const EMAIL_MAX = 200
const RAW_MAX = 100

/**
 * A phone number as we store it, or null when there is no usable number.
 *
 * - Everything but digits goes, keeping one leading "+" (spaces, dashes,
 *   dots, brackets, words).
 * - "00" in front is the international prefix, the same as "+".
 * - India first: 10 digits (or 0 + 10 digits) is a local number and becomes
 *   +91XXXXXXXXXX; 91 + 10 digits becomes +91XXXXXXXXXX.
 * - Any other 7-15 digit number is kept, with its "+" if it had one.
 * - Anything shorter, longer, or with no digits at all is null.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  let plus = trimmed.startsWith('+')
  let digits = trimmed.replace(/\D/g, '')
  if (digits.startsWith('00')) {
    digits = digits.slice(2)
    plus = true
  }
  if (!plus && digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (!plus && digits.length === 10) return `+91${digits}`
  if (!plus && digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) return null
  return plus ? `+${digits}` : digits
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/** A trimmed email that looks like one, or null. */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const v = input.trim()
  if (!v || v.length > EMAIL_MAX || !EMAIL_RE.test(v)) return null
  return v
}

/** A trimmed name within the contact's limit, or null. */
export function normalizeName(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const v = input.trim().replace(/\s+/g, ' ')
  if (!v) return null
  return v.length > NAME_MAX ? v.slice(0, NAME_MAX).trim() : v
}

export interface RawLead {
  name?: string | null | undefined
  phone?: string | null | undefined
  email?: string | null | undefined
  meta?: Record<string, unknown> | undefined
}

export interface CleanLead {
  name: string | null
  phone: string | null
  email: string | null
  meta: Record<string, unknown>
  /** Why the phone is null: nothing was sent, or what was sent was not a number. */
  phoneIssue: 'missing' | 'rejected' | null
}

/**
 * The lead as capture_lead should receive it. A phone or email that could
 * not be used is kept, shortened, under meta.raw_phone / meta.raw_email so
 * nothing the person typed is lost.
 */
export function cleanLead(lead: RawLead): CleanLead {
  const meta: Record<string, unknown> = { ...(lead.meta ?? {}) }
  const rawPhone = typeof lead.phone === 'string' ? lead.phone.trim() : ''
  const phone = normalizePhone(rawPhone)
  let phoneIssue: CleanLead['phoneIssue'] = null
  if (!rawPhone) phoneIssue = 'missing'
  else if (!phone) {
    phoneIssue = 'rejected'
    meta.raw_phone = rawPhone.slice(0, RAW_MAX)
  }
  const rawEmail = typeof lead.email === 'string' ? lead.email.trim() : ''
  const email = normalizeEmail(rawEmail)
  if (rawEmail && !email) meta.raw_email = rawEmail.slice(0, RAW_MAX)
  return { name: normalizeName(lead.name), phone, email, meta, phoneIssue }
}
