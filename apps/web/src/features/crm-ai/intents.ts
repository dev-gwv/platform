import type { AiLang, AiTone, LeadReplyIntent } from '@ipc/contracts'

/** What each reply is for, in the studio's words. */
export const INTENT_NAMES: Record<LeadReplyIntent, string> = {
  first_reply: 'First reply',
  share_packages: 'Share packages',
  ask_call: 'Ask for a call',
  no_answer: 'No reply yet',
  quote_follow_up: 'Follow up on quote',
  price_too_high: 'Price feels high',
  date_check: 'Is my date free?',
  booked_thanks: 'Thank you, booked',
  win_back: 'Win them back',
  custom: 'Something else',
}

export const LANG_NAMES: Record<AiLang, string> = { en: 'English', hi: 'हिन्दी', hinglish: 'Hinglish' }
export const TONE_NAMES: Record<AiTone, string> = { warm: 'Warm', premium: 'Premium', fun: 'Fun' }

/** The reply that fits where the lead is: a new one gets a first reply, a booked one a thank-you. */
export function defaultIntent(lead: {
  status: string | null | undefined
  contacted_status?: string | null | undefined
}): LeadReplyIntent {
  switch (lead.status) {
    case 'converted':
      return 'booked_thanks'
    case 'lost':
      return 'win_back'
    case 'proposal_sent':
      return 'quote_follow_up'
    case 'contacted':
    case 'qualified':
      return lead.contacted_status === 'uncontacted' ? 'first_reply' : 'ask_call'
    default:
      return lead.contacted_status === 'contacted' ? 'ask_call' : 'first_reply'
  }
}

const HINGLISH = /\b(hai|hain|kya|kitna|kitne|nahi|nahin|chahiye|karna|karni|aap|hum|bhai|ji|shaadi|shadi|bata|batao|accha|acha|theek|haan|kab|kaise)\b/gi

/** The language the client wrote in, when it is plainly not English. */
export function looksLike(text: string | null | undefined): AiLang | null {
  if (!text) return null
  if (/[ऀ-ॿ]/.test(text)) return 'hi'
  return (text.match(HINGLISH)?.length ?? 0) >= 2 ? 'hinglish' : null
}

/** wa.me with the text in: digits with the country code, a bare Indian number gets 91. */
export function waWithText(phone: string, text: string): string | null {
  const d = phone.replace(/\D/g, '').replace(/^0+/, '')
  if (d.length < 10) return null
  const n = d.length === 10 ? `91${d}` : d
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`
}
