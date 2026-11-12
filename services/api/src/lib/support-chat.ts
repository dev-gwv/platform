import type { AssistantLang } from '@ipc/contracts'

/**
 * The WhatsApp support agent's rules (0304), pure so they can be tested. The
 * database, the AI and sending are in ./support-chat-store.ts.
 *
 * A studio writes to the official number. The assistant answers what the help
 * can answer and hands the rest to the owner. It never changes data, a plan
 * or money, and never promises a date or a fix.
 */

/** Meta allows a free-form reply for 24 hours after the studio's last message; we keep half an hour spare. */
export const WINDOW_MS = 23.5 * 60 * 60 * 1000
/** "Did that fix it?" with no answer for two days closes the ticket. */
export const SILENCE_MS = 48 * 60 * 60 * 1000
/** Assistant answers a ticket may give in a day before the owner takes over. */
export const AI_REPLIES_A_DAY = 15
/** Answers the studio said did not help before the owner takes over. */
export const MISSES_TO_ESCALATE = 2

export const windowOpen = (lastInAt: string | Date | null, now = Date.now()): boolean =>
  !!lastInAt && now - new Date(lastInAt).getTime() < WINDOW_MS

export const silenceDue = (lastOutAt: string | Date | null, lastInAt: string | Date | null, now = Date.now()): boolean => {
  if (!lastOutAt) return false
  const out = new Date(lastOutAt).getTime()
  if (lastInAt && new Date(lastInAt).getTime() > out) return false
  return now - out >= SILENCE_MS
}

/** STOP / START are Meta's opt-out words and are dealt with elsewhere; never a ticket. */
export const isOptWord = (text: string): boolean => /^\s*(stop|start|unsubscribe)\s*$/i.test(text)

const HINGLISH = /\b(hai|hain|nahi|nahin|kaise|kya|kaha|kahan|karna|karu|karun|kar|raha|rahi|mera|meri|mujhe|hota|hoga|ho gaya|hogaya|kyu|kyun|bhai|ji|sir ji|aap|kripya|samajh|dikha|chahiye)\b/i

/** What the studio wrote in: Devanagari is Hindi, Hindi in English letters is Hinglish. */
export function langOf(text: string): AssistantLang {
  if (/[ऀ-ॿ]/.test(text)) return 'hi'
  return HINGLISH.test(text) ? 'hinglish' : 'en'
}

export type EscalateWhy = 'person' | 'money' | 'plan' | 'data' | 'bug' | 'upset' | 'misses' | 'no_answer' | 'ai_off' | 'many'

/** Said plainly on the ticket and in the group. */
export const WHY_WORDS: Record<EscalateWhy, string> = {
  person: 'Asked for a person',
  money: 'Money or a payment',
  plan: 'Wants a plan changed',
  data: 'Data lost or to be changed',
  bug: 'Something looks broken',
  upset: 'Upset',
  misses: 'Two answers did not help',
  no_answer: 'The help had no answer',
  ai_off: 'The assistant is off',
  many: 'Many messages today',
}

/** The kind of ticket an escalation suggests. */
export const WHY_KIND: Partial<Record<EscalateWhy, 'billing' | 'bug'>> = { money: 'billing', plan: 'billing', bug: 'bug' }

const RULES: readonly { re: RegExp; why: EscalateWhy }[] = [
  { re: /\b(talk|speak|connect|baat)\b.{0,25}\b(person|human|someone|agent|team|harsh|owner|aap se|kisi se|insaan)\b|\b(call|phone) (me|karo|kijiye|kar do)\b|\b(kisi|insaan|aap|team) se baat\b|\breal person\b|\bhuman\b|insaan se|किसी (से|इंसान)|बात (करनी|करवा)|कॉल (करो|कीजिए)/i, why: 'person' },
  { re: /\b(refund|charge-?back|money back|payment (failed|fail|stuck|pending|deducted)|deducted|debited|charged|double charge|paisa (kat|cut)|paise (kat|cut)|paisa wapas|paise wapas|invoice (from you|of subscription)|gst bill)\b|रिफंड|पैसे (कट|वापस)|पेमेंट (फेल|अटक)/i, why: 'money' },
  { re: /\b(upgrade|downgrade|renew|extend|activate|cancel)\b.{0,30}\b(plan|subscription|trial|account|diamond)\b|\b(plan|subscription|trial)\b.{0,20}\b(upgrade|change|badal|extend|renew|khatam|expired|ended|band)\b|प्लान (बदल|अपग्रेड|बढ़ा|खत्म)/i, why: 'plan' },
  { re: /\b(lost|deleted|missing|gone|disappeared|vanished|gayab|ud gaye?)\b.{0,30}\b(data|leads?|projects?|clients?|invoices?|photos?|everything|sab)\b|\b(data|leads?|projects?|clients?|invoices?|everything|sab kuch)\b.{0,20}\b(gone|missing|disappeared|deleted|lost|gayab|delete ho)\b|\b(delete|close|remove) my (account|studio|data)\b|\bhacked\b|गायब|डिलीट हो ग/i, why: 'data' },
  { re: /\b(fraud|cheat(ed|ing)?|scam|worst|useless|pathetic|bakwas|bekar|bekaar|ghatiya|consumer court|legal action|complaint)\b|बकवास|बेकार|घटिया|धोखा/i, why: 'upset' },
  { re: /\b(error|crash(ed|es|ing)?|bug|blank (page|screen)|white screen|not (loading|opening|working|saving)|won'?t (load|open|save)|doesn'?t (load|open|save|work)|stuck on loading|server down|site down|nahi (chal|khul|ho) raha|kaam nahi kar|load nahi|save nahi|khul nahi)\b|(काम नहीं|नहीं चल|नहीं खुल|एरर)/i, why: 'bug' },
]

/** A message the assistant must not answer itself, and why. Null: it may try. */
export function escalateWhy(text: string): EscalateWhy | null {
  for (const r of RULES) if (r.re.test(text)) return r.why
  return null
}

/** "Thanks, ho gaya" after an answer: the ticket is done. Only a short message counts. */
export function soundsFixed(text: string): boolean {
  const t = text.trim()
  if (t.length > 80 || soundsUnfixed(t)) return false
  return /\b(thanks?|thank you|thanku|thx|ty|solved|sorted|fixed|done|got it|ho gaya|hogaya|ho gya|samajh (gaya|gayi|aa gaya)|mil gaya|dhanyavad|dhanyawad|shukriya|perfect|great|ok+ (thanks|done))\b|धन्यवाद|शुक्रिया|हो गया|मिल गया|समझ (गया|गई|आ गया)|👍|🙏/i.test(t)
}

/** "Still not working" after an answer: that answer missed. */
export function soundsUnfixed(text: string): boolean {
  return /\b(still|abhi bhi|ab bhi|phir se|again)\b.{0,30}\b(not|nahi|nahin|same|error|problem)\b|\b(didn'?t|did not|does not|doesn'?t) (work|help)\b|\bnot (solved|fixed|working)\b|\bnahi (hua|hui|ho raha|ho rahi|chala|mila)\b|\bsame (problem|issue|error)\b|अभी भी|नहीं (हुआ|हुई|मिला|चला)/i.test(text)
}

/** Our own fixed lines, in the studio's language. Never AI-written. */
export const CHAT_SAY: Record<AssistantLang, { handed: string; fixed: string; askFixed: string; aiOff: string; more: string; closed: string }> = {
  en: {
    handed: "Thank you. I've passed this to our support team, and they will reply here personally soon.",
    fixed: 'Glad that is sorted! Write here any time you need help. 🙏',
    askFixed: 'Did that fix it?',
    aiOff: 'Thank you for writing to Studio AutoPilot support. Our team will reply here soon.',
    more: 'Got it, I have added this to your ticket. Our team will reply here.',
    closed: 'We have closed this for now. Just write here if you need anything else.',
  },
  hi: {
    handed: 'धन्यवाद। मैंने यह हमारी सपोर्ट टीम को भेज दिया है, वे जल्दी ही यहीं जवाब देंगे।',
    fixed: 'बढ़िया, हो गया! कभी भी मदद चाहिए तो यहीं लिखिए। 🙏',
    askFixed: 'क्या इससे हो गया?',
    aiOff: 'Studio AutoPilot सपोर्ट को लिखने के लिए धन्यवाद। हमारी टीम जल्दी ही यहीं जवाब देगी।',
    more: 'ठीक है, मैंने यह आपके टिकट में जोड़ दिया है। हमारी टीम यहीं जवाब देगी।',
    closed: 'अभी के लिए हम इसे बंद कर रहे हैं। कुछ और चाहिए तो यहीं लिखिए।',
  },
  hinglish: {
    handed: 'Thank you. Maine ye hamari support team ko bhej diya hai, woh jaldi yahin reply karenge.',
    fixed: 'Badhiya, ho gaya! Kabhi bhi help chahiye toh yahin likhiye. 🙏',
    askFixed: 'Kya isse ho gaya?',
    aiOff: 'Studio AutoPilot support ko likhne ke liye thank you. Hamari team jaldi yahin reply karegi.',
    more: 'Theek hai, maine ye aapke ticket mein jod diya hai. Hamari team yahin reply karegi.',
    closed: 'Abhi ke liye hum ise band kar rahe hain. Kuch aur chahiye toh yahin likhiye.',
  },
}

/** What WhatsApp needs on top of the help assistant's own prompt. */
export const WHATSAPP_RULES = `== YOU ARE ANSWERING ON WHATSAPP ==
A studio wrote to Studio AutoPilot's support number on WhatsApp. Answer in plain text for a phone:
- At most 6 short lines. No markdown: no **, no #, no tables. Steps as "1." "2." lines.
- Name the menu and the button exactly as the app prints them.
- You cannot change anything for them: no data, no plan, no payment, no refund. Never promise a date, a fix or a feature.
- If the help does not answer it, or the app seems broken for them, or they want a plan or money changed, call the hand-over tool instead of guessing.
- Do not ask "did that fix it?" yourself; we add that line.`

/** WhatsApp shows no markdown, so what the model wrote anyway is made plain. */
export function plainForWhatsapp(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1: $2')
    .replace(/\[([^\]]+)\]\(\/[^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-•]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3500)
}

/** The support group post when the owner is needed. */
export function escalationPost(p: { name: string; studioName: string | null; why: EscalateWhy; said: string; link: string }): string {
  const who = p.studioName ? `${p.name} · ${p.studioName}` : p.name
  const said = p.said.length > 300 ? `${p.said.slice(0, 297)}…` : p.said
  return [`🙋 WhatsApp: ${who} needs you (${WHY_WORDS[p.why]}).`, `"${said}"`, `Reply here: ${p.link}`].join('\n')
}

/** A new message on a ticket the owner already has. */
export function morePost(p: { name: string; studioName: string | null; said: string; link: string }): string {
  const who = p.studioName ? `${p.name} · ${p.studioName}` : p.name
  const said = p.said.length > 200 ? `${p.said.slice(0, 197)}…` : p.said
  return [`💬 ${who} wrote again: "${said}"`, p.link].join('\n')
}

/** The last ten digits, which is how a number is matched to a studio whatever its prefix. */
export const last10 = (digits: string): string => digits.replace(/\D/g, '').slice(-10)

/** The conversation as the model reads it: the studio is the user, our side the assistant. */
export function chatHistory(
  rows: readonly { dir: 'in' | 'out'; author: string; body: string }[],
  turns = 4,
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const r of rows) {
    const role = r.dir === 'in' ? 'user' : 'assistant'
    const last = out[out.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n${r.body}`
    else out.push({ role, content: r.body })
  }
  return out.slice(-turns)
}
