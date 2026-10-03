import { ENQUIRY_FIELD_KEYS, type EnquiryFieldKey, type EnquiryFields, type EnquiryFieldSetting } from '@ipc/contracts'

/**
 * What an enquiry form asks (0240), in the words the person filling it sees.
 * Name and phone are always asked; the rest are the studio's choice.
 */
export const FIELD_LABEL: Record<EnquiryFieldKey, string> = {
  email: 'Email',
  event_type: 'Event',
  event_date: 'Date',
  city: 'City',
  budget: 'Budget',
  message: 'Anything else?',
}

export const SETTING_LABEL: Record<EnquiryFieldSetting, string> = { off: 'Off', optional: 'Ask', required: 'Required' }

export const DEFAULT_FIELDS: EnquiryFields = {
  email: 'off',
  event_type: 'optional',
  event_date: 'optional',
  city: 'optional',
  budget: 'off',
  message: 'optional',
}

/** The fields shown, in the form's order. */
export const askedFields = (fields: EnquiryFields): EnquiryFieldKey[] => ENQUIRY_FIELD_KEYS.filter((k) => fields[k] !== 'off')

export type EnquiryValues = Partial<Record<EnquiryFieldKey, string>>

/** The first required field left empty, as the person would read it; null when all is there. */
export function firstMissing(fields: EnquiryFields, values: EnquiryValues): string | null {
  const key = ENQUIRY_FIELD_KEYS.find((k) => fields[k] === 'required' && !(values[k] ?? '').trim())
  return key ? FIELD_LABEL[key].replace('?', '') : null
}

/** "Asks name, phone, event, date and city · 1 required" -- one line for the form's card. */
export function fieldsLine(fields: EnquiryFields): string {
  const asked = askedFields(fields).map((k) => (k === 'message' ? 'a message' : FIELD_LABEL[k].toLowerCase()))
  const all = ['name', 'phone', ...asked]
  const list = all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}` : all[0]
  const required = ENQUIRY_FIELD_KEYS.filter((k) => fields[k] === 'required').length
  return `Asks ${list}${required ? ` · ${required} more required` : ''}`
}
