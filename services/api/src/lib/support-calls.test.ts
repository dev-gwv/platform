import { describe, expect, it } from 'vitest'
import type { SupportCallNotice } from '@ipc/contracts'
import {
  BOOKER_CAP,
  botBookedText,
  botCheckinText,
  bookingFromNotice,
  cleanParam,
  groupHasRoom,
  groupText,
  istWhen,
  maskNumber,
  MISSED_NUDGE_AFTER_MS,
  missedByHandText,
  planMissedMessages,
  planBotMessages,
  planMessages,
  summaryText,
} from './support-calls'

const notice = (over: Partial<SupportCallNotice['booking']> = {}, event: SupportCallNotice['event'] = 'booking.created'): SupportCallNotice => ({
  id: 'evt_1',
  event,
  booking: {
    id: 'bk_1',
    // Fri 23 Oct 2026, 3:00-3:20 pm IST
    start: '2026-10-23T09:30:00Z',
    end: '2026-10-23T09:50:00Z',
    timezone: 'Asia/Kolkata',
    meeting_url: 'https://meet.google.com/abc-defg-hij',
    notes: 'Cannot add my team\nhelp',
    invitee: { name: 'Asha Rao', email: 'asha@mehta.in', phone: '+91 98765 43210', whatsapp_ok: true },
    utm: { source: 'studioautopilot', content: 'Mehta Studio', term: '6f1c2d3e-4b5a-4c6d-8e7f-001122334455' },
    parent: 'https://studioautopilot.in/projects/9',
    ...over,
  },
})

const settings = {
  official_on: true,
  bot_on: true,
  group_jid: '120363000000000000@g.us',
  team_numbers: ['919000000001', '919000000002'],
  tpl_booked: 'support_call_booked',
  tpl_reminder: 'support_call_reminder',
  tpl_cancelled: 'support_call_cancelled',
  tpl_team: 'support_call_team',
}
// Two days before the call.
const now = Date.parse('2026-10-21T09:30:00Z')

describe('bookingFromNotice', () => {
  it('reads who, when, the studio and the page', () => {
    const b = bookingFromNotice(notice())
    expect(b).toMatchObject({
      ref: 'bk_1',
      status: 'booked',
      phone: '919876543210',
      whatsappOk: true,
      studioName: 'Mehta Studio',
      companyId: '6f1c2d3e-4b5a-4c6d-8e7f-001122334455',
      page: '/projects/9',
    })
  })
  it('drops a studio id that is not one, and a number that is not one', () => {
    const b = bookingFromNotice(notice({ utm: { term: '/projects/9' }, invitee: { name: 'X', phone: '12', whatsapp_ok: true } }))
    expect(b.companyId).toBeNull()
    expect(b.phone).toBeNull()
  })
})

describe('words', () => {
  it('says the time in India', () => {
    expect(istWhen('2026-10-23T09:30:00Z', '2026-10-23T09:50:00Z')).toBe('Fri 23 Oct, 3:00–3:20 pm')
    expect(istWhen('2026-10-23T06:00:00Z', '2026-10-23T06:40:00Z')).toBe('Fri 23 Oct, 11:30 am–12:10 pm')
    expect(istWhen('2026-10-23T09:30:00Z')).toBe('Fri 23 Oct, 3:00 pm')
  })
  it('keeps template values Meta accepts', () => {
    expect(cleanParam('a\nb\tc')).toBe('a b c')
    expect(cleanParam('   ')).toBe('-')
    expect(cleanParam(null)).toBe('-')
  })
  it('writes the group line plainly', () => {
    expect(groupText('booking.created', bookingFromNotice(notice()), 'Pro')).toBe(
      ['🎧 New support call', 'Asha Rao · Mehta Studio (Pro)', 'Fri 23 Oct, 3:00–3:20 pm', 'Join: https://meet.google.com/abc-defg-hij', 'WhatsApp: +919876543210', 'Notes: Cannot add my team help'].join('\n'),
    )
    expect(groupText('booking.cancelled', bookingFromNotice(notice()))).toBe(['❌ Support call cancelled', 'Asha Rao · Mehta Studio', 'Fri 23 Oct, 3:00–3:20 pm'].join('\n'))
    expect(summaryText([{ startsAt: '2026-10-23T09:30:00Z', name: 'Asha', studioName: 'Mehta Studio' }])).toBe("📅 Today's support calls (1)\n3:00 pm · Asha (Mehta Studio)")
  })
  it('masks a number to its last four digits', () => {
    expect(maskNumber('919876543210')).toBe('••••3210')
  })
})

describe('planMessages', () => {
  const opts = { now, bookerSoFar: 0, groupWorks: true }

  it('a booking: a confirmation and a reminder to them, and one post in the group', () => {
    const p = planMessages('booking.created', bookingFromNotice(notice()), settings, opts)
    expect(p.map((m) => [m.audience, m.template ?? 'text', m.skipped])).toEqual([
      ['booker', 'support_call_booked', null],
      ['booker', 'support_call_reminder', null],
      ['group', 'text', null],
    ])
    expect(p[0]!.params).toEqual(['Asha Rao', 'Fri 23 Oct, 3:00–3:20 pm', 'https://meet.google.com/abc-defg-hij'])
    expect(p[1]!.sendAfter).toBe('2026-10-23T08:30:00.000Z')
  })

  it('nothing to their phone unless they asked for WhatsApp', () => {
    const p = planMessages('booking.created', bookingFromNotice(notice({ invitee: { name: 'A', phone: '9876543210', whatsapp_ok: false } })), settings, opts)
    expect(p.filter((m) => m.audience === 'booker').every((m) => m.skipped === 'They did not ask for WhatsApp.')).toBe(true)
  })

  it('no reminder for a call inside the hour', () => {
    const soon = planMessages('booking.created', bookingFromNotice(notice()), settings, { ...opts, now: Date.parse('2026-10-23T09:00:00Z') })
    expect(soon.filter((m) => m.template === 'support_call_reminder')).toHaveLength(0)
  })

  it(`never more than ${BOOKER_CAP} messages to one person for one booking`, () => {
    const p = planMessages('booking.rescheduled', bookingFromNotice(notice()), settings, { ...opts, bookerSoFar: BOOKER_CAP - 1 })
    expect(p.filter((m) => m.audience === 'booker').map((m) => m.skipped)).toEqual([null, `Already ${BOOKER_CAP} messages for this booking.`])
  })

  it('a moved call is a new message, a repeat of the same notice is the same key', () => {
    const a = planMessages('booking.rescheduled', bookingFromNotice(notice()), settings, opts)
    const b = planMessages('booking.rescheduled', bookingFromNotice(notice({ start: '2026-10-24T09:30:00Z' })), settings, opts)
    expect(a[0]!.dedupeKey).not.toBe(b[0]!.dedupeKey)
    expect(planMessages('booking.rescheduled', bookingFromNotice(notice()), settings, opts)[0]!.dedupeKey).toBe(a[0]!.dedupeKey)
  })

  it('a cancellation tells them once and the group', () => {
    const p = planMessages('booking.cancelled', bookingFromNotice(notice()), settings, opts)
    expect(p.map((m) => m.template ?? m.audience)).toEqual(['support_call_cancelled', 'group'])
  })

  it('the team hears on their own numbers when the group cannot be used', () => {
    const p = planMessages('booking.created', bookingFromNotice(notice()), settings, { ...opts, groupWorks: false })
    const team = p.filter((m) => m.audience === 'team')
    expect(team.map((m) => m.to)).toEqual(['919000000001', '919000000002'])
    expect(team[0]!.params).toEqual(['booked', 'Asha Rao', 'Mehta Studio', 'Fri 23 Oct, 3:00–3:20 pm', 'https://meet.google.com/abc-defg-hij'])
  })

  it('says why when everything is off', () => {
    const off = { ...settings, official_on: false, bot_on: false }
    const p = planMessages('booking.created', bookingFromNotice(notice()), off, opts)
    expect(p.every((m) => m.skipped)).toBe(true)
    expect(p.at(-1)!.skipped).toBe('The group bot and the team numbers are both off.')
  })
})

describe('groupHasRoom', () => {
  it('stops at the hourly and the daily cap', () => {
    const caps = { hourly_cap: 20, daily_cap: 100 }
    expect(groupHasRoom(19, 50, caps)).toBe(true)
    expect(groupHasRoom(20, 50, caps)).toBe(false)
    expect(groupHasRoom(5, 100, caps)).toBe(false)
  })
})

describe('sampleNotice', () => {
  it('is a real notice two hours ahead that never asks to message anyone personally', async () => {
    const { supportCallNotice } = await import('@ipc/contracts')
    const { sampleNotice } = await import('./support-calls')
    const n = supportCallNotice.parse(sampleNotice(Date.parse('2026-10-24T10:10:00Z')))
    expect(n.booking.start).toBe('2026-10-24T12:30:00.000Z')
    expect(n.booking.invitee.whatsapp_ok).toBe(false)
    const p = planMessages(n.event, bookingFromNotice(n), settings, { now: Date.parse('2026-10-24T10:10:00Z'), bookerSoFar: 0, groupWorks: true })
    expect(p.filter((m) => !m.skipped).map((m) => m.audience)).toEqual(['group'])
  })
})

describe('the bot writing to whoever booked (0310)', () => {
  const b = bookingFromNotice(notice())
  const on = { bot_dm_on: true }
  const before = Date.parse('2026-10-22T09:30:00Z')

  it('sends nothing while the switch is off, or for a cancelled call', () => {
    expect(planBotMessages('booking.created', b, { bot_dm_on: false }, { now: before })).toEqual([])
    expect(planBotMessages('booking.cancelled', b, on, { now: before })).toEqual([])
  })

  it('confirms at once and checks in ten minutes after the start', () => {
    const [booked, checkin] = planBotMessages('booking.created', b, on, { now: before })
    expect(booked).toMatchObject({ channel: 'bot', audience: 'booker', to: '919876543210', dedupeKey: 'bot:booked:bk_1', skipped: null })
    expect(booked!.sendAfter).toBe(new Date(before).toISOString())
    expect(checkin).toMatchObject({ dedupeKey: 'bot:checkin:bk_1:2026-10-23T09:30:00.000Z', sendAfter: '2026-10-23T09:40:00.000Z', skipped: null })
  })

  it('a move keeps the one confirmation and checks in at the new time', () => {
    const moved = { ...b, startsAt: '2026-10-24T09:30:00.000Z' }
    const [booked, checkin] = planBotMessages('booking.rescheduled', moved, on, { now: before })
    expect(booked!.dedupeKey).toBe('bot:booked:bk_1')
    expect(checkin!.dedupeKey).toBe('bot:checkin:bk_1:2026-10-24T09:30:00.000Z')
  })

  it('a call already ten minutes in gets no check-in', () => {
    expect(planBotMessages('booking.created', b, on, { now: Date.parse('2026-10-23T09:45:00Z') })).toHaveLength(1)
  })

  it('without a number, says so and sends nothing', () => {
    const rows = planBotMessages('booking.created', { ...b, phone: null }, on, { now: before })
    expect(rows.every((m) => m.skipped === 'No phone number on the booking.')).toBe(true)
  })

  it('fixed words, first name only, no links, asking for a reply', () => {
    expect(botBookedText(b)).toBe(
      "Hi Asha, this is the Studio AutoPilot support team. Your support call is booked for Fri 23 Oct, 3:00 pm. If anything changes, or you'd like help before then, just reply here.",
    )
    expect(botCheckinText(b)).toBe(
      "Hi Asha, it's Studio AutoPilot support about your 3:00 pm support call. If we couldn't connect, just reply here and we'll help you on WhatsApp.",
    )
    for (const t of [botBookedText(b), botCheckinText(b)]) expect(t).not.toMatch(/https?:|www\./)
    expect(botBookedText({ ...b, name: 'Someone' })).toMatch(/^Hi, this is/)
  })

  it('the group post carries the number', () => {
    expect(groupText('booking.created', b)).toContain('WhatsApp: +919876543210')
  })
})

describe('a missed call (0312)', () => {
  const b = bookingFromNotice(notice())
  const on = { official_on: true, missed_on: true, tpl_missed: 'support_call_missed' }
  const now = Date.parse('2026-10-23T10:30:00Z')
  const page = 'https://calendar.app.google/abc'

  it('sends the booking page now and once more a day later', () => {
    const p = planMissedMessages(b, on, { now, bookerSoFar: 2, bookingUrl: page })
    expect(p.map((m) => m.skipped)).toEqual([null, null])
    expect(p[0]).toMatchObject({ channel: 'official', audience: 'booker', to: '919876543210', template: 'support_call_missed' })
    expect(p[0]!.params).toEqual(['Asha', 'Fri 23 Oct, 3:00–3:20 pm', page])
    expect(Date.parse(p[1]!.sendAfter) - now).toBe(MISSED_NUDGE_AFTER_MS)
    expect(p[0]!.dedupeKey).not.toBe(p[1]!.dedupeKey)
  })

  it('the same call marked twice is the same two messages', () => {
    const a = planMissedMessages(b, on, { now, bookerSoFar: 0, bookingUrl: page })
    const c = planMissedMessages(b, on, { now: now + 60_000, bookerSoFar: 0, bookingUrl: page })
    expect(a.map((m) => m.dedupeKey)).toEqual(c.map((m) => m.dedupeKey))
  })

  it('says why when it cannot go', () => {
    const why = (s: Partial<typeof on>, over: Partial<typeof b> = {}, url: string | null = page) =>
      planMissedMessages({ ...b, ...over }, { ...on, ...s }, { now, bookerSoFar: 0, bookingUrl: url })[0]!.skipped
    expect(why({ missed_on: false })).toBe('Missed-call messages are off.')
    expect(why({ official_on: false })).toBe('Official messages are off.')
    expect(why({}, { whatsappOk: false })).toBe('They did not ask for WhatsApp.')
    expect(why({}, { phone: null })).toBe('No WhatsApp number on the booking.')
    expect(why({}, {}, null)).toBe('No booking page is set.')
  })

  it(`keeps to ${BOOKER_CAP} messages a booking`, () => {
    const p = planMissedMessages(b, on, { now, bookerSoFar: BOOKER_CAP - 1, bookingUrl: page })
    expect(p.map((m) => m.skipped)).toEqual([null, `Already ${BOOKER_CAP} messages for this booking.`])
  })

  it("the words for the owner's own WhatsApp carry the page, or ask for a reply", () => {
    expect(missedByHandText(b, page)).toBe(`Hi Asha, we missed you on your Studio AutoPilot support call (Fri 23 Oct, 3:00 pm). Pick a new time here: ${page}`)
    expect(missedByHandText(b, null)).toContain('Reply here')
  })
})
