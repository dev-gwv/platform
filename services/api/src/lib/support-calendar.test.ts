import { describe, expect, it } from 'vitest'
import { supportCallNotice } from '@ipc/contracts'
import { diffCalendar, looksLikeIcal, maskIcal, noticeFor, parseIcs, personOf, refOf, zonedToUtc } from './support-calendar'

// The shape Google writes for a booked appointment (folded line included).
const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Kolkata:20261030T150000',
  'DTEND;TZID=Asia/Kolkata:20261030T152000',
  'UID:abc123@google.com',
  'SUMMARY:Support call (Asha Rao)',
  'ORGANIZER;CN=Harsh:mailto:harsh@studioautopilot.in',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN="Asha Rao";X-NUM-GUESTS=0:mailto:Asha@Mehta.in',
  'ATTENDEE;CN=Harsh;PARTSTAT=ACCEPTED:mailto:harsh@studioautopilot.in',
  'DESCRIPTION:Booked by Asha Rao\\nPhone: 98765 43210\\nCannot add my team\\, p',
  ' lease help\\nJoin with Google Meet: https://meet.google.com/abc-defg-hij',
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261031',
  'UID:allday@google.com',
  'SUMMARY:Holiday',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261101T040000Z',
  'DTEND:20261101T043000Z',
  'RRULE:FREQ=WEEKLY',
  'UID:block@google.com',
  'SUMMARY:Office hours',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261102T093000Z',
  'UID:gone@google.com',
  'SUMMARY:Support call (Rohit)',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const now = Date.parse('2026-10-26T06:00:00Z')

describe('parseIcs', () => {
  it('reads a booked appointment the way Google writes it', () => {
    const events = parseIcs(FEED)!
    expect(events.map((e) => e.uid)).toEqual(['abc123@google.com', 'gone@google.com'])
    const e = events[0]!
    expect(e.startsAt).toBe('2026-10-30T09:30:00.000Z')
    expect(e.endsAt).toBe('2026-10-30T09:50:00.000Z')
    expect(e.meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
    expect(e.description).toContain('Cannot add my team, please help')
    expect(e.attendees).toEqual([
      { email: 'asha@mehta.in', name: 'Asha Rao' },
      { email: 'harsh@studioautopilot.in', name: 'Harsh' },
    ])
    expect(events[1]!.status).toBe('CANCELLED')
  })

  it('says when the address gave something other than a calendar', () => {
    expect(parseIcs('<html>Sign in</html>')).toBeNull()
  })

  it('turns a wall time in a time zone into the right instant', () => {
    expect(zonedToUtc(2026, 10, 30, 15, 0, 0, 'Asia/Kolkata').toISOString()).toBe('2026-10-30T09:30:00.000Z')
    expect(zonedToUtc(2026, 7, 1, 12, 0, 0, 'Europe/London').toISOString()).toBe('2026-07-01T11:00:00.000Z')
  })
})

describe('personOf', () => {
  it('is the guest who is not the calendar owner', () => {
    expect(personOf(parseIcs(FEED)![0]!)).toEqual({ name: 'Asha Rao', email: 'asha@mehta.in' })
  })
  it('falls back on the name in the title', () => {
    const e = { ...parseIcs(FEED)![1]!, attendees: [] }
    expect(personOf(e)).toEqual({ name: 'Rohit', email: null })
  })
})

describe('diffCalendar', () => {
  const events = parseIcs(FEED)!
  it('a new entry is a booking; a cancelled one we never knew is nothing', () => {
    expect(diffCalendar(events, [], now).map((c) => c.kind)).toEqual(['booking.created'])
  })
  it('a moved time is "moved", the same time is nothing', () => {
    expect(diffCalendar(events, [{ ref: refOf('abc123@google.com'), startsAt: '2026-10-30T09:30:00.000Z' }], now)).toEqual([])
    expect(diffCalendar(events, [{ ref: refOf('abc123@google.com'), startsAt: '2026-10-29T09:30:00.000Z' }], now).map((c) => c.kind)).toEqual([
      'booking.rescheduled',
    ])
  })
  it('a cancelled or removed entry we knew is "cancelled"', () => {
    const known = [
      { ref: refOf('gone@google.com'), startsAt: '2026-11-02T09:30:00.000Z' },
      { ref: refOf('deleted@google.com'), startsAt: '2026-11-05T09:30:00.000Z' },
    ]
    const kinds = diffCalendar(events, known, now).map((c) => [c.kind, 'event' in c ? c.event.uid : c.ref])
    expect(kinds).toEqual([
      ['booking.created', 'abc123@google.com'],
      ['booking.cancelled', 'gone@google.com'],
      ['booking.cancelled', 'gcal:deleted@google.com'],
    ])
  })
  it('an empty answer never cancels everything', () => {
    expect(diffCalendar([], [{ ref: refOf('x'), startsAt: '2026-11-05T09:30:00.000Z' }], now)).toEqual([])
  })
  it('only looks two months ahead', () => {
    const far = { ...events[0]!, uid: 'far', startsAt: '2027-03-01T09:30:00.000Z' }
    expect(diffCalendar([far], [], now)).toEqual([])
  })
})

describe('noticeFor', () => {
  it('makes a booking that names the studio and messages nobody personally', () => {
    const [change] = diffCalendar(parseIcs(FEED)!, [], now)
    const n = supportCallNotice.parse(noticeFor(change!, { id: '6f1c2d3e-4b5a-4c6d-8e7f-001122334455', name: 'Mehta Studio' }))
    expect(n.booking.id).toBe('gcal:abc123@google.com')
    expect(n.booking.invitee).toMatchObject({ name: 'Asha Rao', email: 'asha@mehta.in', whatsapp_ok: false })
    expect(n.booking.utm?.content).toBe('Mehta Studio')
    expect(n.id).toBe('gcal:abc123@google.com:booking.created:2026-10-30T09:30:00.000Z')
  })
})

describe('the address', () => {
  it('takes a Google private address and refuses other things', () => {
    expect(looksLikeIcal('https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-123/basic.ics')).toBe(true)
    expect(looksLikeIcal('http://calendar.google.com/x.ics')).toBe(false)
    expect(looksLikeIcal('https://calendar.google.com/calendar/u/0/r')).toBe(false)
  })
  it('is shown masked', () => {
    expect(maskIcal('https://calendar.google.com/calendar/ical/a/private-123/basic.ics')).toBe('calendar.google.com/…/basic.ics')
  })
})
