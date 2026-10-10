/**
 * An iCalendar (RFC 5545) event, built by hand. One VEVENT is all a meeting
 * invite needs, and a dependency for it would be larger than this file.
 */
export interface IcsEvent {
  /** Stable id, so re-sending the same meeting updates it in the calendar. */
  uid: string
  title: string
  start: Date
  end: Date
  description?: string | undefined
  location?: string | undefined
  organizer?: { name: string; email: string } | undefined
  attendees?: ReadonlyArray<{ name?: string | undefined; email: string }> | undefined
  /** When the file was produced; defaults to now. */
  stamp?: Date | undefined
  /**
   * A whole day (YYYY-MM-DD) instead of start and end: a shoot whose hours
   * are not set yet. Only a feed (buildIcsFeed) reads it.
   */
  allDay?: string | undefined
}

const pad = (n: number) => String(n).padStart(2, '0')

/** UTC timestamp in the compact form the format wants: 20260905T103000Z. */
export function icsDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Escape a text value: backslashes, semicolons, commas and newlines. */
export function icsText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Lines longer than 75 octets are folded with CRLF + one space. */
function fold(line: string): string {
  const out: string[] = []
  let rest = line
  while (rest.length > 75) {
    out.push(rest.slice(0, 75))
    rest = ' ' + rest.slice(75)
  }
  out.push(rest)
  return out.join('\r\n')
}

export function buildIcs(ev: IcsEvent): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Studio AutoPilot//CRM//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${icsDate(ev.stamp ?? new Date())}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(ev.end)}`,
    `SUMMARY:${icsText(ev.title)}`,
  ]
  if (ev.description) lines.push(`DESCRIPTION:${icsText(ev.description)}`)
  if (ev.location) lines.push(`LOCATION:${icsText(ev.location)}`)
  if (ev.organizer) lines.push(`ORGANIZER;CN=${icsText(ev.organizer.name)}:mailto:${ev.organizer.email}`)
  for (const a of ev.attendees ?? []) {
    lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE${a.name ? `;CN=${icsText(a.name)}` : ''}:mailto:${a.email}`)
  }
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** The day after an ISO date, compact: 2026-10-31 → 20261101. */
function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

/**
 * A calendar to subscribe to (Google Calendar's "From URL"): many events, no
 * invitations, a name and a hint to come back every hour. Each event keeps
 * its uid from one read to the next, so a moved shoot moves in the calendar
 * instead of appearing twice; an event no longer in the feed disappears.
 */
export function buildIcsFeed(feed: { name: string; events: readonly IcsEvent[]; stamp?: Date }): string {
  const stamp = icsDate(feed.stamp ?? new Date())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Studio AutoPilot//Shoots//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(feed.name)}`,
    'X-WR-TIMEZONE:Asia/Kolkata',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]
  for (const ev of feed.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      ...(ev.allDay
        ? [`DTSTART;VALUE=DATE:${ev.allDay.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${nextDay(ev.allDay)}`]
        : [`DTSTART:${icsDate(ev.start)}`, `DTEND:${icsDate(ev.end)}`]),
      `SUMMARY:${icsText(ev.title)}`,
    )
    if (ev.description) lines.push(`DESCRIPTION:${icsText(ev.description)}`)
    if (ev.location) lines.push(`LOCATION:${icsText(ev.location)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
