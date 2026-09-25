import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReminderRequest } from '@ipc/contracts'
import {
  clockLabel,
  dayLabel,
  fromIstInputValue,
  istInstant,
  istParts,
  quickAt,
  quickChoices,
  reminderTitle,
  toIstInputValue,
  whenPhrase,
} from './remind-times'

/** An instant given as Kolkata wall time, so each case reads the way a studio would say it. */
const ist = (s: string) => new Date(`${s}+05:30`)
const iso = (d: Date) => d.toISOString()
const keys = (now: Date) => quickChoices(now).map((c) => c.key)
const choice = (now: Date, key: string) => quickChoices(now).find((c) => c.key === key)

// 25 Sep 2026 is a Friday.
const FRIDAY_MORNING = ist('2026-09-25T10:37')

describe('India time', () => {
  it('reads the Kolkata wall clock off an instant', () => {
    expect(istParts(new Date('2026-09-25T05:07:00Z'))).toEqual({
      year: 2026,
      month: 8,
      day: 25,
      hour: 10,
      minute: 37,
      weekday: 5,
    })
  })

  it('turns a Kolkata wall-clock time back into an instant', () => {
    expect(iso(istInstant(2026, 8, 26, 9))).toBe('2026-09-26T03:30:00.000Z')
  })

  it('never asks the device for its own zone', () => {
    // Every local-time reader on Date. If any of these were used, a phone set
    // to another zone would put "9 am" somewhere else.
    const local = ['getHours', 'getMinutes', 'getDate', 'getDay', 'getMonth', 'getFullYear', 'getTimezoneOffset'] as const
    const spies = local.map((m) => vi.spyOn(Date.prototype, m))
    quickChoices(FRIDAY_MORNING)
    whenPhrase(quickAt('monday', FRIDAY_MORNING), FRIDAY_MORNING)
    fromIstInputValue(toIstInputValue(FRIDAY_MORNING))
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })

  afterEach(() => vi.restoreAllMocks())
})

describe('quick choices on a Friday morning', () => {
  it('offers all four', () => {
    expect(keys(FRIDAY_MORNING)).toEqual(['hour', 'evening', 'tomorrow', 'monday'])
  })

  it('in 1 hour is an hour from now, and says when', () => {
    const c = choice(FRIDAY_MORNING, 'hour')!
    expect(iso(c.at)).toBe(iso(ist('2026-09-25T11:37')))
    expect(c.hint).toBe('11:37 am')
  })

  it('this evening is 6 pm today', () => {
    expect(iso(choice(FRIDAY_MORNING, 'evening')!.at)).toBe('2026-09-25T12:30:00.000Z')
  })

  it('tomorrow is 9 am on Saturday', () => {
    const c = choice(FRIDAY_MORNING, 'tomorrow')!
    expect(iso(c.at)).toBe('2026-09-26T03:30:00.000Z')
    expect(c.hint).toBe('Sat 26 Sep')
  })

  it('Monday is 9 am on the coming Monday', () => {
    const c = choice(FRIDAY_MORNING, 'monday')!
    expect(iso(c.at)).toBe('2026-09-28T03:30:00.000Z')
    expect(c.hint).toBe('Mon 28 Sep')
  })
})

describe('this evening', () => {
  it('is offered up to 4:59 pm', () => {
    expect(keys(ist('2026-09-25T16:59'))).toContain('evening')
  })

  it('is gone from 5 pm, when 6 pm is an hour or less away', () => {
    expect(keys(ist('2026-09-25T17:00'))).not.toContain('evening')
    expect(keys(ist('2026-09-25T21:15'))).not.toContain('evening')
  })
})

describe('the weekend and Monday', () => {
  it('on a Saturday, Monday is two days on and tomorrow is Sunday', () => {
    const sat = ist('2026-09-26T10:00')
    expect(iso(choice(sat, 'tomorrow')!.at)).toBe('2026-09-27T03:30:00.000Z')
    expect(iso(choice(sat, 'monday')!.at)).toBe('2026-09-28T03:30:00.000Z')
  })

  it('on a Sunday, tomorrow already is Monday 9 am, so it is offered once', () => {
    const sun = ist('2026-09-27T10:00')
    expect(keys(sun)).toEqual(['hour', 'evening', 'tomorrow'])
    expect(iso(choice(sun, 'tomorrow')!.at)).toBe('2026-09-28T03:30:00.000Z')
  })

  it('on a Monday, Monday means the one a week on', () => {
    expect(iso(quickAt('monday', ist('2026-09-28T08:00')))).toBe('2026-10-05T03:30:00.000Z')
  })
})

describe('crossing midnight', () => {
  it('in 1 hour at 11:30 pm lands at 12:30 am', () => {
    const late = ist('2026-09-25T23:30')
    const c = choice(late, 'hour')!
    expect(iso(c.at)).toBe('2026-09-25T19:00:00.000Z')
    expect(c.hint).toBe('12:30 am')
    expect(whenPhrase(c.at, late)).toBe('tomorrow at 12:30 am')
  })

  it('tomorrow at 11:30 pm Friday is Saturday, not Sunday', () => {
    expect(iso(quickAt('tomorrow', ist('2026-09-25T23:30')))).toBe('2026-09-26T03:30:00.000Z')
  })

  it('counts days in India, not in UTC', () => {
    // 18:45 UTC on Friday is already 00:15 on Saturday in Kolkata.
    const now = new Date('2026-09-25T18:45:00Z')
    expect(iso(quickAt('tomorrow', now))).toBe('2026-09-27T03:30:00.000Z')
    expect(iso(quickAt('evening', now))).toBe('2026-09-26T12:30:00.000Z')
    expect(iso(quickAt('monday', now))).toBe('2026-09-28T03:30:00.000Z')
  })

  it('rolls over the end of the year', () => {
    const newYearsEve = ist('2026-12-31T20:00')
    const at = quickAt('tomorrow', newYearsEve)
    expect(iso(at)).toBe('2027-01-01T03:30:00.000Z')
    expect(whenPhrase(at, newYearsEve)).toBe('tomorrow at 9 am')
  })
})

describe('whenPhrase', () => {
  it('says today, tomorrow, a weekday, then a date', () => {
    expect(whenPhrase(quickAt('evening', FRIDAY_MORNING), FRIDAY_MORNING)).toBe('today at 6 pm')
    expect(whenPhrase(quickAt('tomorrow', FRIDAY_MORNING), FRIDAY_MORNING)).toBe('tomorrow at 9 am')
    expect(whenPhrase(quickAt('monday', FRIDAY_MORNING), FRIDAY_MORNING)).toBe('on Monday at 9 am')
    expect(whenPhrase(ist('2026-10-05T09:00'), FRIDAY_MORNING)).toBe('on 5 Oct at 9 am')
  })

  it('adds the year only when it is not this one', () => {
    expect(whenPhrase(ist('2027-01-05T09:30'), ist('2026-12-20T10:00'))).toBe('on 5 Jan 2027 at 9:30 am')
  })
})

describe('clockLabel and dayLabel', () => {
  it('say a time the way people do', () => {
    expect(clockLabel(ist('2026-09-26T09:00'))).toBe('9 am')
    expect(clockLabel(ist('2026-09-26T18:00'))).toBe('6 pm')
    expect(clockLabel(ist('2026-09-26T12:00'))).toBe('12 pm')
    expect(clockLabel(ist('2026-09-26T00:00'))).toBe('12 am')
    expect(clockLabel(ist('2026-09-26T00:05'))).toBe('12:05 am')
    expect(clockLabel(ist('2026-09-26T11:37'))).toBe('11:37 am')
  })

  it('names the day in India', () => {
    expect(dayLabel(new Date('2026-09-25T19:00:00Z'))).toBe('Sat 26 Sep')
  })
})

describe('the date & time picker', () => {
  it('shows an instant as India wall time', () => {
    expect(toIstInputValue(new Date('2026-09-26T03:30:00Z'))).toBe('2026-09-26T09:00')
    expect(toIstInputValue(new Date('2026-09-25T19:00:00Z'))).toBe('2026-09-26T00:30')
  })

  it('reads what was picked as India time', () => {
    expect(iso(fromIstInputValue('2026-09-26T09:00')!)).toBe('2026-09-26T03:30:00.000Z')
    expect(iso(fromIstInputValue('2026-09-26T09:00:00')!)).toBe('2026-09-26T03:30:00.000Z')
  })

  it('round-trips', () => {
    const at = ist('2026-11-03T16:45')
    expect(iso(fromIstInputValue(toIstInputValue(at))!)).toBe(iso(at))
  })

  it('refuses anything that is not a real date and time', () => {
    expect(fromIstInputValue('')).toBeNull()
    expect(fromIstInputValue('tomorrow')).toBeNull()
    expect(fromIstInputValue('2026-02-31T09:00')).toBeNull()
    expect(fromIstInputValue('2026-13-01T09:00')).toBeNull()
    expect(fromIstInputValue('2026-09-26T24:00')).toBeNull()
  })
})

describe('reminderTitle', () => {
  it('says what to follow up, and where', () => {
    expect(reminderTitle('Photo Album', 'Sharma Wedding')).toBe('Follow up: Photo Album · Sharma Wedding')
    expect(reminderTitle('  Call   the florist ')).toBe('Follow up: Call the florist')
  })

  it('does not repeat itself when the context is the thing', () => {
    expect(reminderTitle('Sharma Wedding', 'Sharma Wedding')).toBe('Follow up: Sharma Wedding')
  })

  it('still makes a title from a blank name', () => {
    expect(reminderTitle('   ', null)).toBe('Follow up')
  })

  it('always fits the reminder contract', () => {
    const long = reminderTitle('x'.repeat(300), 'Sharma Wedding')
    expect(long.length).toBe(200)
    expect(long.endsWith('…')).toBe(true)
    for (const title of [long, reminderTitle('A'), reminderTitle('', '')]) {
      expect(createReminderRequest.safeParse({ title }).success).toBe(true)
    }
  })
})
