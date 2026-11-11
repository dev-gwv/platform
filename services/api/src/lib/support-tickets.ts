import type { SupportTicketKind, SupportTicketStatus, SupportTicketWatch } from '@ipc/contracts'
import { SUPPORT_TICKET_KINDS, SUPPORT_TICKET_WATCHES, SUPPORT_TICKET_WATCH_LABEL } from '@ipc/contracts'
import type { ChatMessage } from './ai'
import { istWhen } from './support-calls'

/**
 * The support ticket assistant (0300): the rules with no database, so each is
 * tested. The owner takes every call alone; the point is that a ticket keeps
 * itself -- a brief before the call, a nudge after it, and a voice note that
 * becomes the summary -- and nothing here ever messages a studio.
 *
 * Posts go only to the support group, which holds the owner and the bot. The
 * AI writes the brief and reads the voice note; when it cannot, the plain
 * facts go instead, so a post is never lost to a model being down.
 */

/** The brief goes this long before the call, on the five-minute tick. */
export const BRIEF_BEFORE_MS = 75 * 60_000
/** The "how did it go?" nudge waits this long after the call ends. */
export const NUDGE_AFTER_MS = 10 * 60_000
/** A call older than this is never asked about. */
export const NUDGE_WITHIN_MS = 24 * 3600_000
/** A call with no end time is taken to last this long. */
export const DEFAULT_CALL_MS = 30 * 60_000

export function briefDue(startsAt: string, now: number): boolean {
  const start = Date.parse(startsAt)
  return start > now && start - now <= BRIEF_BEFORE_MS
}

export function callEnd(startsAt: string, endsAt: string | null): number {
  return endsAt ? Date.parse(endsAt) : Date.parse(startsAt) + DEFAULT_CALL_MS
}

export function nudgeDue(startsAt: string, endsAt: string | null, now: number): boolean {
  const end = callEnd(startsAt, endsAt)
  return now - end >= NUDGE_AFTER_MS && now - end < NUDGE_WITHIN_MS
}

/** What we know about the studio that booked, from its own data. Counts only. */
export interface StudioFacts {
  studio: string | null
  plan: string | null
  /** 'trial' | 'paid' | 'lifetime' | 'expired' | null when unknown */
  access: 'trial' | 'paid' | 'lifetime' | 'expired' | null
  daysLeft: number | null
  joinedDaysAgo: number | null
  projects: number
  invoices: number
  leads: number
  shoots: number
  team: number
  activeDays7: number
  lastActiveDaysAgo: number | null
  /** Screens they opened and left, or were refused on, in the last 30 days. */
  stuck: { flow: string; times: number }[]
  /** Earlier calls, newest first. */
  earlier: { when: string; summary: string }[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The facts as plain lines: the brief when the AI is away, and what the AI reads. */
export function factsText(f: StudioFacts | null, booking: { name: string; email: string | null; notes: string | null; page: string | null }): string {
  const lines: string[] = []
  if (!f) {
    lines.push(`Not matched to a studio${booking.email ? ` (booked as ${booking.email})` : ''}. Probably a new or would-be studio.`)
  } else {
    const access =
      f.access === 'lifetime'
        ? 'open for life'
        : f.access === 'expired'
          ? 'access has ENDED'
          : f.access === 'trial'
            ? `free trial${f.daysLeft !== null ? `, ${plural(f.daysLeft, 'day')} left` : ''}`
            : f.access === 'paid'
              ? `${f.plan ?? 'paid plan'}${f.daysLeft !== null ? `, ${plural(f.daysLeft, 'day')} left` : ''}`
              : (f.plan ?? 'plan unknown')
    lines.push(`${f.studio ?? 'Studio'} · ${access}${f.joinedDaysAgo !== null ? ` · joined ${f.joinedDaysAgo === 0 ? 'today' : `${plural(f.joinedDaysAgo, 'day')} ago`}` : ''}`)
    lines.push(
      `Made: ${plural(f.projects, 'project')}, ${plural(f.invoices, 'invoice')}, ${plural(f.leads, 'lead')}, ${plural(f.shoots, 'shoot')}, team of ${f.team}`,
    )
    lines.push(
      f.lastActiveDaysAgo === null
        ? 'Not seen in the app in the last 30 days'
        : `In the app on ${plural(f.activeDays7, 'day')} this week, last ${f.lastActiveDaysAgo === 0 ? 'today' : `${plural(f.lastActiveDaysAgo, 'day')} ago`}`,
    )
    if (f.stuck.length) lines.push(`Got stuck on: ${f.stuck.map((s) => `${s.flow} (${s.times}×)`).join(', ')}`)
    for (const e of f.earlier.slice(0, 3)) lines.push(`Earlier call ${e.when}: ${e.summary}`)
  }
  if (booking.notes) lines.push(`They wrote: "${booking.notes.replace(/\s+/g, ' ').slice(0, 300)}"`)
  if (booking.page) lines.push(`Booked from the page ${booking.page}`)
  return lines.join('\n')
}

/** Asking the AI for a brief: three short lines, from the facts only. */
export function briefMessages(facts: string, name: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You help the one person who takes support calls for Studio AutoPilot, an app that runs Indian wedding photography studios ' +
        '(leads, projects, quotations, invoices, shoots, team, post-production, photo galleries). ' +
        'Write a brief to read one minute before a call: at most 3 short lines, plain text, no headings, no markdown, no emoji. ' +
        'Line 1: who they are and where they are with the app. Line 2: what they most likely need, from where they got stuck, what they wrote or what they have not set up. ' +
        'Line 3 (only if useful): one thing to check or show on the call. Use only the facts given; never invent numbers, names or problems.',
    },
    { role: 'user', content: `Call with ${name}.\n${facts}` },
  ]
}

/** Reading the owner's words after the call. */
export function noteMessages(transcript: string, context: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You keep support tickets for Studio AutoPilot, an app for Indian wedding photography studios. The person who took the call ' +
        'describes it in a voice note, often in Hindi, Hinglish or English. Reply with JSON only, no other words:\n' +
        '{"summary": "2-3 plain English sentences: what they asked and what was done", ' +
        `"kind": one of ${SUPPORT_TICKET_KINDS.map((k) => `"${k}"`).join(', ')} ` +
        '(training = showed them how; bug = something in the app is broken; billing = plan, payment, access; feature = they want something new), ' +
        '"status": "solved" if nothing is left to do, "waiting_us" if the support person still has to do something, "waiting_them" if the studio has to do something, ' +
        '"next_action": "the one next step, short, or empty when solved", ' +
        '"due_in_days": a whole number of days for the next step (0 = today, 1 = tomorrow), or null, ' +
        `"watch": if the studio is now to do one of these in the app, which one: ${SUPPORT_TICKET_WATCHES.map((w) => `"${w}" (${SUPPORT_TICKET_WATCH_LABEL[w]})`).join(', ')}; otherwise null}\n` +
        'Use only what the note says. Never invent promises or dates.',
    },
    { role: 'user', content: `About the call:\n${context}\n\nThe note:\n${transcript}` },
  ]
}

export interface NoteReading {
  summary: string
  kind: SupportTicketKind
  status: Extract<SupportTicketStatus, 'open' | 'waiting_us' | 'waiting_them' | 'solved'>
  nextAction: string | null
  dueInDays: number | null
  /** What the studio is to do that its own data will show (0301). */
  watch: SupportTicketWatch | null
}

const STATUSES = ['open', 'waiting_us', 'waiting_them', 'solved'] as const

/**
 * The model's answer, read forgivingly: code fences, words around the JSON, a
 * kind it made up. When nothing can be read the note itself is the summary
 * and the ticket stays open, so a bad answer never loses what was said.
 */
export function readNoteReply(text: string, transcript: string): NoteReading {
  const fallback: NoteReading = { summary: transcript.trim().slice(0, 1200), kind: 'other', status: 'open', nextAction: null, dueInDays: null, watch: null }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return fallback
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return fallback
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const kind = SUPPORT_TICKET_KINDS.find((k) => k === str(raw.kind)) ?? 'other'
  const status = STATUSES.find((s) => s === str(raw.status)) ?? 'open'
  const days = typeof raw.due_in_days === 'number' && Number.isFinite(raw.due_in_days) ? Math.min(60, Math.max(0, Math.round(raw.due_in_days))) : null
  const next = str(raw.next_action)
  return {
    summary: str(raw.summary).slice(0, 2000) || fallback.summary,
    kind,
    status,
    nextAction: status === 'solved' ? null : next.slice(0, 500) || null,
    dueInDays: status === 'solved' ? null : days,
    watch: status === 'solved' ? null : (SUPPORT_TICKET_WATCHES.find((w) => w === str(raw.watch)) ?? null),
  }
}

// ── step 2 (0301): the follow-up, the bug issue, the Monday summary ────────

/** A tutorial the follow-up may point to. */
export interface TutorialPick {
  key: string
  title: string
}

/**
 * Asking the AI for the follow-up to the studio: short, warm, in the language
 * the call was in. It picks tutorials by key from the list; we add the links,
 * so it can never invent an address.
 */
export function followupMessages(ctx: { name: string; summary: string; nextAction: string | null; transcript: string | null }, tutorials: readonly TutorialPick[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You write the WhatsApp message that Studio AutoPilot support sends a photography studio after a support call. ' +
        'Reply with JSON only: {"message": "...", "tutorials": ["key", ...]}. ' +
        'The message: greet them by first name, thank them for the call in one line, recap what was shown or fixed in one or two lines, ' +
        'say what happens next (what they should do, or what we will do) in one line. At most 6 short lines, plain text, no markdown, at most one emoji. ' +
        'Language: if the notes from the call contain Hindi or Hinglish words (for example "nahi", "karna", "hai", "unko", "maine"), write the whole message in Hinglish -- Hindi in English letters, the way people text in India; only if the notes are plain English, write simple English. Button and menu names stay in English. ' +
        'Never promise anything the notes do not say; no prices, no dates beyond the notes. Do not sign off with a name. ' +
        'tutorials: up to 2 keys from the list that would help them do it themselves next time, or [] if none fits. ' +
        'The videos are added under the message by us: never mention tutorials, videos, keys or links in the message itself.',
    },
    {
      role: 'user',
      content:
        `Studio contact: ${ctx.name}\nWhat happened: ${ctx.summary}\n${ctx.nextAction ? `Next step: ${ctx.nextAction}\n` : ''}` +
        `${ctx.transcript ? `Notes from the call: ${ctx.transcript.slice(0, 1500)}\n` : ''}` +
        `\nTutorials:\n${tutorials.map((t) => `${t.key}: ${t.title}`).join('\n')}`,
    },
  ]
}

/** The follow-up's words and tutorial keys, read forgivingly; null when nothing usable came back. */
export function readFollowupReply(text: string, known: readonly TutorialPick[]): { message: string; tutorials: TutorialPick[] } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let message = ''
  let keys: unknown[] = []
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1)
    // A model sometimes breaks a line inside the JSON string itself; read it as \n.
    for (const candidate of [slice, slice.replace(/\r?\n/g, '\\n')]) {
      try {
        const raw = JSON.parse(candidate) as { message?: unknown; tutorials?: unknown }
        message = typeof raw.message === 'string' ? raw.message.trim() : ''
        keys = Array.isArray(raw.tutorials) ? raw.tutorials : []
        break
      } catch {
        message = ''
      }
    }
  } else {
    message = text.trim()
  }
  // A line that names a tutorial key or a link anyway is dropped: the links go under the message.
  const keyWords = known.map((t) => t.key)
  message = message
    .split('\n')
    .filter((line) => !/https?:\/\//.test(line) && !keyWords.some((k) => new RegExp(`['"\`]${k}['"\`]`).test(line)))
    .join('\n')
    .trim()
  if (message.length < 5) return null
  const picked = keys.flatMap((k) => known.filter((t) => t.key === k)).slice(0, 2)
  return { message: message.slice(0, 1500), tutorials: picked }
}

/** The message as it is sent: the words, then each tutorial with its link. */
export function followupText(message: string, tutorials: readonly TutorialPick[], appUrl: string): string {
  const base = appUrl.replace(/\/+$/, '')
  const links = tutorials.map((t) => `▶️ ${t.title}: ${base}/help?play=${encodeURIComponent(t.key)}`)
  return [message.trim(), ...(links.length ? ['', ...links] : [])].join('\n')
}

/** A WhatsApp chat with the message written, for the owner to press Send. */
export function waLink(phone: string | null, text: string): string {
  const to = (phone ?? '').replace(/\D/g, '')
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`
}

/**
 * A new GitHub issue, filled in from a bug ticket. Never the studio's phone
 * or email: an issue is read by whoever works on the code.
 */
export function issueUrl(
  repo: string,
  t: { studio: string | null; plan: string | null; when: string; summary: string | null; nextAction: string | null; bookingNotes: string | null; link: string },
): string {
  const title = `Support: ${(t.summary ?? 'bug from a support call').replace(/\s+/g, ' ').slice(0, 90)}`
  const body = [
    `**From a support call** · ${t.studio ?? 'unknown studio'}${t.plan ? ` (${t.plan})` : ''} · ${t.when}`,
    '',
    '### What happened',
    t.summary ?? '-',
    ...(t.bookingNotes ? ['', '### What they wrote when booking', t.bookingNotes] : []),
    ...(t.nextAction ? ['', '### Next step', t.nextAction] : []),
    '',
    `Ticket: ${t.link}`,
  ].join('\n')
  return `https://github.com/${repo}/issues/new?labels=${encodeURIComponent('bug,support')}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}

export interface WeekStats {
  calls: number
  solved: number
  open: number
  closedByThemselves: number
  kinds: { kind: SupportTicketKind; n: number }[]
  bugsOpen: number
  stuck: { flow: string; studios: number }[]
  repeat: { name: string; calls: number }[]
}

const KIND_WORD: Record<SupportTicketKind, string> = {
  training: 'showing how',
  bug: 'bugs',
  billing: 'plan & billing',
  feature: 'feature requests',
  other: 'other',
}

/** The Monday post: last week in a few lines, and what to fix so the same calls stop. Null in an empty week. */
export function weeklyText(w: WeekStats): string | null {
  if (!w.calls && !w.open) return null
  const lines = [`📊 Support last week: ${plural(w.calls, 'call')}, ${w.solved} solved${w.closedByThemselves ? ` (${w.closedByThemselves} closed by themselves)` : ''}, ${w.open} still open`]
  if (w.kinds.length) lines.push(`By type: ${w.kinds.map((k) => `${k.n} ${KIND_WORD[k.kind]}`).join(' · ')}`)
  if (w.bugsOpen) lines.push(`🐞 ${plural(w.bugsOpen, 'bug')} still open`)
  if (w.stuck.length) lines.push(`Where studios got stuck: ${w.stuck.map((s) => `${s.flow} (${plural(s.studios, 'studio')})`).join(', ')}`)
  if (w.repeat.length) lines.push(`Called more than once this month: ${w.repeat.map((r) => `${r.name} (${r.calls})`).join(', ')}`)
  const top = w.kinds.find((k) => k.kind === 'training')
  if (top && w.stuck[0] && top.n >= 2) lines.push(`Fix first: ${w.stuck[0].flow} -- the screen behind most "show me how" calls.`)
  return lines.join('\n')
}

/** The line when a ticket closes itself. */
export function closedPost(name: string, studio: string | null, did: SupportTicketWatch): string {
  return `✅ Closed by itself: ${who(name, studio)} went on to ${SUPPORT_TICKET_WATCH_LABEL[did]} after the call.`
}

/** India's date `days` from now, as YYYY-MM-DD. */
export function indiaDatePlus(now: number, days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now + days * 86_400_000))
}

const who = (name: string, studio: string | null) => [name || 'Someone', studio].filter(Boolean).join(' · ')

/** The group's brief post. */
export function briefPost(b: { name: string; studioName: string | null; startsAt: string; endsAt: string | null }, brief: string, link: string): string {
  return [`🗒️ Before your call: ${who(b.name, b.studioName)}`, istWhen(b.startsAt, b.endsAt), '', brief.trim(), '', `Ticket: ${link}`].join('\n')
}

/** The group's after-call nudge. */
export function nudgePost(b: { name: string; studioName: string | null }, link: string): string {
  return [`📝 How did the call with ${who(b.name, b.studioName)} go?`, `Record a voice note and the ticket fills itself: ${link}`].join('\n')
}

/** One line for the 9 am post: what is open and what waits on the owner. */
export function ticketsLine(open: number, waitingOnYou: { name: string; action: string | null; late: boolean }[]): string | null {
  if (!open && !waitingOnYou.length) return null
  const lines = [`🎫 ${plural(open, 'ticket')} open${waitingOnYou.length ? `, ${waitingOnYou.length} waiting on you` : ''}`]
  for (const w of waitingOnYou.slice(0, 5)) lines.push(`• ${w.late ? '⏰ ' : ''}${w.name}${w.action ? `: ${w.action}` : ''}`)
  return lines.join('\n')
}

/** Groq and OpenAI name their Whisper models differently. */
export function speechModelFor(baseUrl: string): string {
  return /openai\.com/i.test(baseUrl) ? 'whisper-1' : 'whisper-large-v3-turbo'
}
