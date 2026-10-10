import { describe, expect, it } from 'vitest'
import { buildIcs, icsDate, icsText, buildIcsFeed } from './ics'

describe('ics', () => {
  it('formats dates in compact UTC', () => {
    expect(icsDate(new Date('2026-09-05T10:30:00+05:30'))).toBe('20260905T050000Z')
  })

  it('escapes the characters the format reserves', () => {
    expect(icsText('Sharma, Priya; venue\nMumbai')).toBe('Sharma\\, Priya\\; venue\\nMumbai')
  })

  it('builds one VEVENT with organizer and attendees, CRLF-terminated', () => {
    const ics = buildIcs({
      uid: 'meeting-1@ipc',
      title: 'Wedding recce',
      start: new Date('2026-09-10T04:30:00Z'),
      end: new Date('2026-09-10T05:30:00Z'),
      description: 'Walk the venue',
      location: 'Taj Lands End',
      organizer: { name: 'IPC Studios', email: 'hello@ipc.in' },
      attendees: [{ name: 'Priya', email: 'priya@x.in' }],
      stamp: new Date('2026-09-05T00:00:00Z'),
    })
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('UID:meeting-1@ipc')
    expect(ics).toContain('DTSTART:20260910T043000Z')
    expect(ics).toContain('DTEND:20260910T053000Z')
    expect(ics).toContain('SUMMARY:Wedding recce')
    expect(ics).toContain('ORGANIZER;CN=IPC Studios:mailto:hello@ipc.in')
    expect(ics).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CN=Priya:mailto:priya@x.in')
    expect(ics).toContain('DTSTAMP:20260905T000000Z')
  })

  it('folds long lines at 75 octets', () => {
    const ics = buildIcs({
      uid: 'x',
      title: 'A'.repeat(120),
      start: new Date('2026-09-10T04:30:00Z'),
      end: new Date('2026-09-10T05:30:00Z'),
    })
    const summary = ics.split('\r\n').filter((l) => l.startsWith('SUMMARY:') || l.startsWith(' '))
    expect(summary[0]!.length).toBe(75)
    expect(summary[1]!.startsWith(' ')).toBe(true)
  })
})

describe('a calendar to subscribe to', () => {
  const at = (iso: string) => new Date(iso)
  const feed = buildIcsFeed({
    name: 'Mehta Studios · My shoots',
    stamp: at('2026-10-10T04:00:00Z'),
    events: [
      { uid: 'slot-1@studioautopilot', title: 'Haldi · Mehta Wedding', start: at('2026-10-31T04:30:00Z'), end: at('2026-10-31T09:30:00Z'), location: 'Leela, Udaipur' },
      { uid: 'shoot-2@studioautopilot', title: 'Wedding, no time yet', start: at('2026-11-01T00:00:00Z'), end: at('2026-11-01T00:00:00Z'), allDay: '2026-11-30' },
    ],
  })

  it('publishes, names itself and asks to be read hourly', () => {
    expect(feed).toContain('METHOD:PUBLISH')
    expect(feed).toContain('X-WR-CALNAME:Mehta Studios · My shoots')
    expect(feed).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H')
    expect(feed).not.toContain('ATTENDEE')
  })

  it('carries every event with its own uid, in UTC', () => {
    expect(feed.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(feed).toContain('UID:slot-1@studioautopilot')
    expect(feed).toContain('DTSTART:20261031T043000Z')
    expect(feed).toContain('LOCATION:Leela\\, Udaipur')
  })

  it('draws a shoot with no hours as the whole day, across a month end', () => {
    expect(feed).toContain('DTSTART;VALUE=DATE:20261130')
    expect(feed).toContain('DTEND;VALUE=DATE:20261201')
  })

  it('is lines of CRLF, ending in one', () => {
    expect(feed.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(feed.split('\r\n').every((l) => l.length <= 75)).toBe(true)
  })
})
