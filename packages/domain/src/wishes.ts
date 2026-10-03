/**
 * Wishes (0243): a client's birthdays and anniversary, when each next comes
 * round, and the words of the wish. One place, so the Wishes tab, the
 * "Send on WhatsApp" link and (later) the automatic wishes all say the same.
 */

export type OccasionKind = 'birthday' | 'anniversary'

export interface OccasionDay {
  kind: OccasionKind
  person_name: string
  month: number
  day: number
  year: number | null
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** The day in a given year; 29 Feb is kept on 28 Feb in a year without it. */
function onYear(month: number, day: number, year: number): string {
  const d = month === 2 && day === 29 && !isLeap(year) ? 28 : day
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** The next time the day comes round, on or after `today` (YYYY-MM-DD, India's today). */
export function nextOccurrence(o: Pick<OccasionDay, 'month' | 'day'>, today: string): string {
  const year = Number(today.slice(0, 4))
  const thisYear = onYear(o.month, o.day, year)
  return thisYear >= today ? thisYear : onYear(o.month, o.day, year + 1)
}

/** Whole days from `today` to `date`, both YYYY-MM-DD. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/** "Today", "Tomorrow", "In 5 days". */
export function whenWords(days: number): string {
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

/** Which birthday or anniversary this is, when the year is known: 1, 2, 25… */
export function yearsOn(o: Pick<OccasionDay, 'year'>, date: string): number | null {
  if (!o.year) return null
  const n = Number(date.slice(0, 4)) - o.year
  return n > 0 ? n : null
}

/** 1st, 2nd, 3rd, 11th, 21st, 112th. */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name.trim()

/** "Priya & Rahul" from the client's birthdays, else the client's first name. */
export function coupleName(clientName: string, occasions: ReadonlyArray<Pick<OccasionDay, 'kind' | 'person_name'>>): string {
  const people = occasions.filter((o) => o.kind === 'birthday' && o.person_name.trim()).map((o) => first(o.person_name))
  const unique = [...new Set(people)].slice(0, 2)
  return unique.length === 2 ? `${unique[0]} & ${unique[1]}` : first(clientName)
}

/** The words of the wish. Plain, warm, signed by the studio. */
export function wishWords(input: {
  occasion: OccasionDay
  clientName: string
  studioName: string
  /** The date it is for, YYYY-MM-DD: the year counts the anniversary. */
  on: string
  /** The client's other dates, so an anniversary can name the couple. */
  others?: ReadonlyArray<Pick<OccasionDay, 'kind' | 'person_name'>>
}): string {
  const { occasion, clientName, studioName, on } = input
  const years = yearsOn(occasion, on)
  if (occasion.kind === 'birthday') {
    const who = first(occasion.person_name || clientName)
    return `Happy birthday, ${who}! Wishing you a wonderful year ahead — from all of us at ${studioName}.`
  }
  const couple = coupleName(clientName, input.others ?? [])
  const which = years ? `${ordinal(years)} anniversary` : 'anniversary'
  return `Happy ${which}, ${couple}! It was an honour to be part of your wedding. Wishing you many more years together — ${studioName}.`
}

/** The order a list of dates is shown in: soonest first. */
export function sortBySoonest<T extends Pick<OccasionDay, 'month' | 'day'>>(list: T[], today: string): T[] {
  return [...list].sort((a, b) => nextOccurrence(a, today).localeCompare(nextOccurrence(b, today)))
}
