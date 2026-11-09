import { sequenceInput, type SequenceDraftAsk, type SequenceInput } from '@ipc/contracts'
import { SEQUENCE_VARS } from '@ipc/domain'
import type { ChatMessage } from './ai'
import { LANG_LINE, TONE_LINE } from './lead-writer'

/**
 * The follow-up sequence maker (owner, 9 Nov): a whole series of messages
 * written from what happened with the lead. The model writes one step per
 * line; the parser here is forgiving about its punctuation and strict about
 * what comes out -- known words only, hours a person is awake, days in
 * order, the channels the studio chose -- so the editor always opens on a
 * sequence that would save.
 */

type Req = Omit<SequenceDraftAsk, 'hint'> & { hint?: string }

const GOAL: Record<Req['goal'], { name: string; what: string }> = {
  new_no_reply: {
    name: 'New enquiry, no reply yet',
    what: 'A new enquiry has not replied to the first message. Start warm, share why the studio is a good fit, invite a short call, and end with a gentle last check.',
  },
  quote_quiet: {
    name: 'Quotation sent, gone quiet',
    what: 'The quotation was sent and the couple went quiet. Check they saw it, offer to explain or adjust it, share what makes the studio special, and close kindly.',
  },
  after_call: {
    name: 'After the first call',
    what: 'The studio had a first call with the couple. Thank them, recap that the studio understands their plans, share the next step (quotation or meeting) and follow up until they decide.',
  },
  price_too_high: {
    name: 'Price felt high',
    what: 'The couple said the price is high. Show the value (experience, quality, what they receive), offer to adjust the package, and keep it respectful. Never offer a discount unless the studio wrote one below.',
  },
  after_shoot: {
    name: 'After the shoot: review and referrals',
    what: 'The wedding is shot. Thank them, ask for a Google review a few days later, and later ask if any friend or family member is getting married (a referral).',
  },
  win_back: {
    name: 'Win back a lost lead',
    what: 'The couple chose another studio or stopped replying weeks ago. Gracious, short messages that keep the door open: other functions, a pre-wedding shoot, a friend\'s wedding.',
  },
  custom: { name: 'Follow-up', what: 'Write the follow-up the studio describes below.' },
}

const DAYS: Record<Req['length'], number> = { week: 7, two_weeks: 14, month: 30 }
const STEPS: Record<Req['pace'], number> = { gentle: 3, normal: 5, persistent: 7 }
const CHANNELS: Record<Req['channels'], ('whatsapp' | 'reminder' | 'email')[]> = {
  whatsapp: ['whatsapp'],
  whatsapp_calls: ['whatsapp', 'reminder'],
  whatsapp_calls_email: ['whatsapp', 'reminder', 'email'],
}

export const stepCount = (r: Pick<Req, 'pace' | 'length'>) =>
  Math.max(2, Math.min(STEPS[r.pace] + (r.length === 'month' ? 1 : 0) - (r.length === 'week' ? 1 : 0), 10))

export function sequenceWriterMessages(r: Req): ChatMessage[] {
  const g = GOAL[r.goal]
  const n = stepCount(r)
  const chans = CHANNELS[r.channels]
  const vars = SEQUENCE_VARS.map((v) => `{{${v.key}}} = ${v.label.toLowerCase()}`).join(', ')
  const system = [
    'You write follow-up sequences for an Indian wedding photography and film studio: messages sent to a couple over several days.',
    `Write exactly ${n} steps over ${DAYS[r.length]} days. The first step is on day 0 or 1, every next step on a later day, the last step no later than day ${DAYS[r.length]}.`,
    `Channels you may use: ${chans.join(', ')}. ${chans.includes('reminder') ? 'A "reminder" step is a note to the studio to CALL the couple (one short line saying what to talk about), not a message.' : ''} ${chans.includes('email') ? 'Use email at most twice.' : ''}`,
    `Write each step on ONE line exactly like this:\nDay 2 | 11 | whatsapp | the message\nDay 5 | 18 | reminder | what to talk about on the call\n${chans.includes('email') ? 'Day 7 | 11 | email | Subject: the subject // the email body\n' : ''}The second number is the hour to send, from 9 to 20 (24-hour).`,
    'Inside a message, write a new line as " / ". WhatsApp messages: 2 to 5 short lines, friendly and human, at most 2 emoji, no markdown.',
    `You may use these words in curly braces, and no others: ${vars}. Start a message with "Hi {{first_name}}" where natural.`,
    'Never invent prices, discounts, offers, deadlines, dates, awards or facts the studio did not give. Each step should say something new, never repeat the same message.',
    TONE_LINE[r.tone],
    LANG_LINE[r.language],
    `Answer with the ${n} lines only, nothing before or after.`,
  ]
    .filter(Boolean)
    .join('\n')
  const user = [`What happened with the lead: ${g.what}`, r.hint?.trim() ? `The studio adds: ${r.hint.trim()}` : '']
    .filter(Boolean)
    .join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

const KNOWN = new Set<string>(SEQUENCE_VARS.map((v) => v.key))

/** Keep only the words the sender can fill; anything else in braces goes, with its braces. */
export function keepKnownVars(text: string): string {
  return text
    .replace(/\{\{\s*([a-z_]+)\s*\}\}|\{([a-z_]+)\}/gi, (m, a?: string, b?: string) => {
      const k = (a ?? b ?? '').toLowerCase()
      if (KNOWN.has(k)) return `{{${k}}}`
      return a ? '' : m
    })
    .replace(/[ \t]{2,}/g, ' ')
}

const CHANNEL_WORDS: Record<string, 'whatsapp' | 'reminder' | 'email'> = {
  whatsapp: 'whatsapp',
  wa: 'whatsapp',
  message: 'whatsapp',
  reminder: 'reminder',
  call: 'reminder',
  'call reminder': 'reminder',
  email: 'email',
  mail: 'email',
}

const clean = (s: string) =>
  s
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\*\*|__|`/g, '')
    .trim()

type Step = SequenceInput['steps'][number]

/** One line of the model's answer as a step, or null when it is not one. */
export function parseStepLine(line: string): Step | null {
  const l = clean(line).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
  const m = /^day\s*(\d{1,3})\s*[|:–—-]+\s*(\d{1,2})(?:\s*(am|pm))?\s*[|:–—-]+\s*([a-z ]{2,15}?)\s*[|:–—-]+\s*(.+)$/i.exec(l)
  if (!m) return null
  let hour = Number(m[2])
  const ampm = m[3]?.toLowerCase()
  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  const channel = CHANNEL_WORDS[m[4]!.trim().toLowerCase()]
  if (!channel) return null
  let text = m[5]!.trim().replace(/\s+\/\s+/g, '\n').replace(/^["“](.*)["”]$/s, '$1').trim()
  let subject: string | null = null
  if (channel === 'email') {
    const sm = /^subject\s*:\s*(.+?)\s*(?:\/\/|\n)\s*([\s\S]+)$/i.exec(text)
    if (sm) {
      subject = sm[1]!.trim().slice(0, 150)
      text = sm[2]!.trim()
    } else {
      subject = text.split(/[.!?\n]/)[0]!.slice(0, 80) || 'Following up'
    }
  }
  text = keepKnownVars(text).trim()
  if (!text) return null
  const day = Math.min(365, Math.max(0, Number(m[1])))
  return channel === 'reminder'
    ? { day_offset: day, channel, send_hour: Math.min(21, Math.max(6, hour)), note: text.slice(0, 300), body: null, subject: null }
    : {
        day_offset: day,
        channel,
        send_hour: Math.min(21, Math.max(6, hour)),
        body: text.slice(0, 4000),
        subject: channel === 'email' ? keepKnownVars(subject ?? 'Following up').trim() || 'Following up' : null,
      }
}

/**
 * The model's answer as a sequence the editor can open: the chosen channels
 * only, days in order, at most the steps asked for, nothing empty. Null when
 * fewer than two good steps came back.
 */
export function parseSequenceDraft(raw: string, r: Req): SequenceInput | null {
  const allowed = new Set(CHANNELS[r.channels])
  const max = stepCount(r)
  const steps = clean(raw)
    .split('\n')
    .map(parseStepLine)
    .filter((s): s is Step => !!s && allowed.has(s.channel))
    .sort((a, b) => a.day_offset - b.day_offset)
    .slice(0, max)
  if (steps.length < 2) return null
  const draft = {
    name: GOAL[r.goal].name.slice(0, 80),
    description: r.hint?.trim() ? r.hint.trim().slice(0, 500) : null,
    is_active: true,
    auto_start: false,
    stage_filter: null,
    source_filter: null,
    stop_on_reply: true,
    steps,
  }
  const ok = sequenceInput.safeParse(draft)
  return ok.success ? draft : null
}
