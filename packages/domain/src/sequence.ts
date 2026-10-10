import { crmTemplateVars, renderTemplate } from './template'

/**
 * What a sequence message may say, in the words a studio uses. The editor
 * offers these as chips; the sender and the "Send now" screen fill them the
 * same way, so what the studio previews is what the client gets.
 */
export const SEQUENCE_VARS = [
  { key: 'first_name', label: 'First name' },
  { key: 'name', label: 'Full name' },
  { key: 'event_type', label: 'Event' },
  { key: 'event_date', label: 'Event date' },
  { key: 'city', label: 'City' },
  { key: 'studio', label: 'Studio name' },
  { key: 'website', label: 'Your website' },
] as const

export interface SequenceLead {
  name?: string | null
  phone?: string | null
  email?: string | null
  city?: string | null
  event_type?: string | null
  event_date?: string | null
  follow_up_at?: string | null
}

const fmtDate = (d: string) => {
  const t = new Date(`${d.slice(0, 10)}T00:00:00`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Fill a sequence message for one lead. A missing value becomes a sensible
 * word rather than a gap: "your event", "there" -- a message that reads
 * "Hi , about your  on " is worse than one a little less personal.
 */
export function fillSequenceText(body: string, lead: SequenceLead, studio: { name: string; website?: string | null }): string {
  const base = crmTemplateVars(lead, studio.name)
  const first = (lead.name ?? '').trim().split(/\s+/)[0] ?? ''
  const vars: Record<string, string> = {
    ...base,
    name: base.name || 'there',
    first_name: first || 'there',
    event_type: (lead.event_type ?? '').trim() || 'event',
    event_date: lead.event_date ? fmtDate(lead.event_date) : 'your date',
    website: (studio.website ?? '').trim(),
  }
  // No website yet: drop the sentence that points at it, not just the link.
  const text = vars.website ? body : body.replace(/[^.!?\n]*\{\{\s*website\s*\}\}[^\n]*/g, '')
  return renderTemplate(text, vars)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The number wa.me wants: digits with the country code; a bare Indian number gets 91. */
function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, '')
  return d.length === 10 ? `91${d}` : d.replace(/^0+/, '')
}

/** A link that opens WhatsApp on this device with the message typed in. */
export function waLink(phone: string, text?: string): string {
  const base = `https://wa.me/${waNumber(phone)}`
  return text ? `${base}?text=${encodeURIComponent(text)}` : base
}
