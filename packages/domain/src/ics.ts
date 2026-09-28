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
