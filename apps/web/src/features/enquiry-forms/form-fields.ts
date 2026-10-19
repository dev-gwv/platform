import { ENQUIRY_FIELD_KEYS, type EnquiryFieldKey, type EnquiryFields, type EnquiryFieldSetting } from '@ipc/contracts'

/**
 * What an enquiry form asks (0240, 0274), in the words the person filling it
 * sees. Name and mobile are always asked; the rest are the studio's choice.
 */
export const FIELD_LABEL: Record<EnquiryFieldKey, string> = {
  email: 'Email',
  event_type: 'Event',
  event_date: 'Date',
  city: 'City',
  services: 'What do you need?',
  guests: 'Guests',
  budget: 'Budget (₹)',
  message: 'Anything else?',
}

/** The same questions as the studio's list names them ("Questions on your form"). */
export const LIST_LABEL: Record<EnquiryFieldKey, string> = {
  email: 'Email',
  event_type: 'Event',
  event_date: 'Event date',
  city: 'City',
  services: 'What they need (they can tick several)',
  guests: 'Number of guests',
  budget: 'Budget',
  message: 'Anything else?',
}

export const SETTING_LABEL: Record<EnquiryFieldSetting, string> = { off: 'Off', optional: 'Ask', required: 'Required' }

/** A new form asks email, event, date and "Anything else?" -- fewer questions, more enquiries. */
export const DEFAULT_FIELDS: EnquiryFields = {
  email: 'optional',
  event_type: 'optional',
  event_date: 'optional',
  city: 'off',
  services: 'off',
  guests: 'off',
  budget: 'off',
  message: 'optional',
}

/** The fields shown, in the form's order. */
export const askedFields = (fields: EnquiryFields): EnquiryFieldKey[] => ENQUIRY_FIELD_KEYS.filter((k) => fields[k] !== 'off')

export type EnquiryValues = Partial<Record<Exclude<EnquiryFieldKey, 'services'>, string>> & { services?: string[] }

/** The first required field left empty, as the person would read it; null when all is there. */
export function firstMissing(fields: EnquiryFields, values: EnquiryValues): string | null {
  const key = ENQUIRY_FIELD_KEYS.find((k) => fields[k] === 'required' && isEmpty(k, values))
  return key ? FIELD_LABEL[key].replace('?', '') : null
}

const isEmpty = (k: EnquiryFieldKey, v: EnquiryValues) =>
  k === 'services' ? !(v.services ?? []).length : !((v[k] as string | undefined) ?? '').trim()

export type FieldErrors = Partial<Record<EnquiryFieldKey | 'name' | 'phone', string>>

/** The checks before sending (spec 3.9), each under its own field. */
export function checkEnquiry(fields: EnquiryFields, name: string, phone: string, values: EnquiryValues): FieldErrors {
  const out: FieldErrors = {}
  if (name.trim().length < 2) out.name = 'Enter your name'
  const digits = phone.replace(/\D/g, '')
  const ten = digits.slice(-10)
  if (digits.length < 10 || digits.length > 13 || !/^[6-9]\d{9}$/.test(ten)) out.phone = 'Enter a valid 10-digit mobile number'
  const email = values.email?.trim()
  if (fields.email !== 'off' && email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) out.email = 'Enter a valid email'
  for (const k of ENQUIRY_FIELD_KEYS) {
    if (fields[k] === 'required' && !out[k] && isEmpty(k, values)) out[k] = k === 'services' ? 'Tick at least one' : 'Please fill this in'
  }
  return out
}

/** "Asks name, phone, event, date and city · 1 required" -- one line for the form's card. */
export function fieldsLine(fields: EnquiryFields): string {
  const asked = askedFields(fields).map((k) =>
    k === 'message' ? 'a message' : k === 'services' ? 'what they need' : k === 'budget' ? 'budget' : FIELD_LABEL[k].toLowerCase(),
  )
  const all = ['name', 'phone', ...asked]
  const list = all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}` : all[0]
  const required = ENQUIRY_FIELD_KEYS.filter((k) => fields[k] === 'required').length
  return `Asks ${list}${required ? ` · ${required} more required` : ''}`
}
