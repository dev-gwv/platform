/**
 * Clock-time helpers for the time box, kept pure so the picker's parsing can
 * be tested without a DOM and the wizard can print a call time in a summary.
 *
 * The value contract is the browser's: "HH:MM" on a 24-hour clock. Postgres
 * hands back "HH:MM:SS" for a `time` column, so that is read too, and always
 * written back without the seconds.
 */

export interface Clock {
  /** 0–23 */
  h: number
  /** 0–59 */
  m: number
}

export type Period = 'AM' | 'PM'

const pad = (n: number) => String(n).padStart(2, '0')

/** "15:05", "15:05:00" or "9:05" → { h: 15, m: 5 }; anything else → null. */
export function parseTime(v: string | null | undefined): Clock | null {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*$/.exec(v ?? '')
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return { h, m: min }
}

export const toHHMM = ({ h, m }: Clock): string => `${pad(h)}:${pad(m)}`

/** "15:05" → "3:05 PM" — how a person says it. Blank stays blank; junk is returned as-is. */
export function niceTime(v: string | null | undefined): string {
  if (!v) return ''
  const c = parseTime(v)
  if (!c) return v
  const { hour12, minute, period } = to12h(c)
  return `${hour12}:${pad(minute)} ${period}`
}

export function to12h({ h, m }: Clock): { hour12: number; minute: number; period: Period } {
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute: m, period: h < 12 ? 'AM' : 'PM' }
}

export function from12h(hour12: number, minute: number, period: Period): Clock {
  const base = hour12 % 12
  return { h: period === 'PM' ? base + 12 : base, m: minute }
}

/**
 * The half of the day a bare hour most likely means on a shoot: 6 to 11 is
 * morning, 12 and 1 to 5 is afternoon. Nobody calls the crew for 4 AM.
 */
export const defaultPeriod = (hour12: number): Period => (hour12 >= 6 && hour12 <= 11 ? 'AM' : 'PM')

/**
 * What someone types into the box, read generously: "3:15 pm", "3.15pm",
 * "03:15PM", "3 pm", "3pm", "15:15", "1515", "930", or just "3" (→ 3 PM by
 * defaultPeriod) and "15" (→ 15:00). Returns "HH:MM" or null.
 */
export function parseTypedTime(text: string): string | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  const m = /^(\d{1,2})(?:[:.\s]?(\d{2}))?\s*(am|pm|a|p)?$/.exec(t)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] === undefined ? 0 : Number(m[2])
  const period = m[3] ? (m[3].startsWith('p') ? 'PM' : 'AM') : null
  if (min > 59) return null
  if (period) {
    if (h < 1 || h > 12) return null
    return toHHMM(from12h(h, min, period))
  }
  // No AM/PM: two digits above 12 are a 24-hour time; anything up to 12 with
  // no minutes leans on the shoot-day default.
  if (h > 23) return null
  if (m[2] === undefined && h >= 1 && h <= 12) h = from12h(h, 0, defaultPeriod(h)).h
  return toHHMM({ h, m: min })
}

/** The call times a studio actually uses, offered as one-tap chips. */
export const QUICK_TIMES: readonly string[] = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '16:00', '17:00', '18:00', '19:00', '20:00',
]

export const MINUTE_STEPS: readonly number[] = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
