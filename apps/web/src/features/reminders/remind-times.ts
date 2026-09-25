import { createReminderRequest } from '@ipc/contracts'

/**
 * When a "Remind me" choice lands, worked out in India time.
 *
 * The studios are in India, and the hourly job that turns a reminder into an
 * alert compares real instants, so "tomorrow 9 am" has to mean 9 am in
 * Kolkata even on a laptop set to London or a phone whose zone was never
 * changed. India has one zone and no daylight saving, so a fixed +05:30 is
 * exact: no time-zone database, and the same answer on every device.
 *
 * Everything takes `now`, so the tests can stand at any moment of the week.
 */
export const IST_OFFSET_MINUTES = 330

const OFFSET_MS = IST_OFFSET_MINUTES * 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** The Kolkata wall clock at an instant. `month` counts from 0; `weekday` 0 is Sunday. */
export interface IstParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

export function istParts(at: Date): IstParts {
  const wall = new Date(at.getTime() + OFFSET_MS)
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth(),
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    weekday: wall.getUTCDay(),
  }
}

/** The instant a Kolkata wall-clock time names. Day 32 rolls into the next month, and so on. */
export function istInstant(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - OFFSET_MS)
}

/** Whole Kolkata calendar days since 1970 — what "today" and "tomorrow" count in. */
function istDay(at: Date): number {
  return Math.floor((at.getTime() + OFFSET_MS) / DAY_MS)
}

export type QuickKey = 'hour' | 'evening' | 'tomorrow' | 'monday'

/**
 * Where one quick choice lands. "Monday" is the next Monday after today, so
 * on a Monday it is a week on — "today at 9 am" would be a different choice.
 */
export function quickAt(key: QuickKey, now: Date): Date {
  const t = istParts(now)
  switch (key) {
    case 'hour':
      return new Date(now.getTime() + HOUR_MS)
    case 'evening':
      return istInstant(t.year, t.month, t.day, 18)
    case 'tomorrow':
      return istInstant(t.year, t.month, t.day + 1, 9)
    case 'monday':
      return istInstant(t.year, t.month, t.day + ((8 - t.weekday) % 7 || 7), 9)
  }
}

export interface QuickChoice {
  key: QuickKey
  label: string
  at: Date
  /** The date or time it lands on, shown beside the label when the label alone does not say. */
  hint: string | null
}

/**
 * The quick choices for right now. "This evening" goes once it is 5 pm —
 * 6 pm is then an hour or less away, which "In 1 hour" already covers — and
 * on a Sunday "Monday 9 am" is the same moment as "Tomorrow 9 am", so only
 * one of the two is offered.
 */
export function quickChoices(now: Date): QuickChoice[] {
  const hour = quickAt('hour', now)
  const tomorrow = quickAt('tomorrow', now)
  const monday = quickAt('monday', now)
  const choices: QuickChoice[] = [{ key: 'hour', label: 'In 1 hour', at: hour, hint: clockLabel(hour) }]
  if (istParts(now).hour < 17) {
    choices.push({ key: 'evening', label: 'This evening (6 pm)', at: quickAt('evening', now), hint: null })
  }
  choices.push({ key: 'tomorrow', label: 'Tomorrow 9 am', at: tomorrow, hint: dayLabel(tomorrow) })
  if (monday.getTime() !== tomorrow.getTime()) {
    choices.push({ key: 'monday', label: 'Monday 9 am', at: monday, hint: dayLabel(monday) })
  }
  return choices
}

/** "9 am", "6 pm", "11:37 am", "12 pm" — the way people say a time. */
export function clockLabel(at: Date): string {
  const { hour, minute } = istParts(at)
  const h = hour % 12 || 12
  const half = hour < 12 ? 'am' : 'pm'
  return minute === 0 ? `${h} ${half}` : `${h}:${String(minute).padStart(2, '0')} ${half}`
}

/** "Sat 26 Sep". */
export function dayLabel(at: Date): string {
  const p = istParts(at)
  return `${WEEKDAYS[p.weekday]!.slice(0, 3)} ${p.day} ${MONTHS[p.month]}`
}

/** "5 Oct", with the year once it is not the year it is now. */
export function dateLabel(at: Date, now: Date): string {
  const p = istParts(at)
  const year = p.year === istParts(now).year ? '' : ` ${p.year}`
  return `${p.day} ${MONTHS[p.month]}${year}`
}

/**
 * The end of "I'll remind you …": "today at 6 pm", "tomorrow at 9 am",
 * "on Monday at 9 am" within the week, "on 5 Oct at 9 am" after it.
 */
export function whenPhrase(at: Date, now: Date): string {
  const days = istDay(at) - istDay(now)
  const clock = clockLabel(at)
  if (days === 0) return `today at ${clock}`
  if (days === 1) return `tomorrow at ${clock}`
  if (days > 1 && days < 7) return `on ${WEEKDAYS[istParts(at).weekday]} at ${clock}`
  return `on ${dateLabel(at, now)} at ${clock}`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A datetime-local value ("2026-09-26T09:00") for an instant, read as India time. */
export function toIstInputValue(at: Date): string {
  const p = istParts(at)
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/**
 * The instant a datetime-local value names, read as India time whatever zone
 * the device is in. Null for anything that is not a real date and time —
 * 31 Feb is refused rather than quietly becoming 3 March.
 */
export function fromIstInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim())
  if (!m) return null
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number]
  const at = istInstant(year, month - 1, day, hour, minute)
  const back = istParts(at)
  const same =
    back.year === year && back.month === month - 1 && back.day === day && back.hour === hour && back.minute === minute
  return same ? at : null
}

/** The most a reminder title may hold, read from the contract so the two cannot drift. */
const TITLE_MAX = createReminderRequest.shape.title.maxLength ?? 200

/**
 * "Follow up: Photo Album · Sharma Wedding". The context — usually the
 * project — is there because "Photo Album" or "Haldi" alone could be any
 * wedding by the time the alert arrives.
 */
export function reminderTitle(name: string, context?: string | null): string {
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()
  const what = tidy(name)
  const where = context ? tidy(context) : ''
  const about = [what, where && where !== what ? where : ''].filter(Boolean).join(' · ')
  const title = about ? `Follow up: ${about}` : 'Follow up'
  return title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`
}
