import { describe, expect, it } from 'vitest'
import { bestQueueFor, dataCopyDay, planQueue, type QueueJob } from './quote-schedule'

const today = '2026-11-18'
// The 28 December wedding's highlight film, uploaded first: due 30 days after, 30 days of work.
const late28: QueueJob = { id: 'dec28', due: '2027-01-27', workDays: 30, earliest: '2026-12-29' }
// The 20 December wedding's, uploaded a week later: due earlier.
const early20: QueueJob = { id: 'dec20', due: '2027-01-19', workDays: 30, earliest: '2026-12-21' }

describe('planQueue', () => {
  it('starts work as late as its promise allows when the editor is free', () => {
    expect(planQueue([late28], today)).toEqual([{ id: 'dec28', start: '2026-12-29', end: '2027-01-27', lateDays: 0 }])
    const solo = planQueue([{ id: 'reel', due: '2027-03-01', workDays: 7, earliest: '2027-02-15' }], today)
    expect(solo[0]).toMatchObject({ start: '2027-02-23', end: '2027-03-01', lateDays: 0 })
  })

  it('puts the earlier promise first, whichever was uploaded first', () => {
    const placed = planQueue([late28, early20], today)
    expect(placed.map((p) => p.id)).toEqual(['dec20', 'dec28'])
    expect(placed[0]).toMatchObject({ start: '2026-12-21', end: '2027-01-19', lateDays: 0 })
    // The 28th's film waits for the editor, and is late by what it waited.
    expect(placed[1]).toMatchObject({ start: '2027-01-20', end: '2027-02-18', lateDays: 22 })
  })

  it('keeps started work first, from today', () => {
    const placed = planQueue([{ ...late28, started: true }, { id: 'r', due: '2026-11-25', workDays: 3, earliest: today }], today)
    expect(placed[0]).toMatchObject({ id: 'dec28', start: today })
  })

  it('moves a later promise back to make room, instead of an earlier one', () => {
    const a: QueueJob = { id: 'a', due: '2027-03-01', workDays: 7, earliest: '2027-01-01' }
    const b: QueueJob = { id: 'b', due: '2027-02-28', workDays: 7, earliest: '2027-01-01' }
    const placed = planQueue([a, b], today)
    expect(placed.find((p) => p.id === 'a')).toMatchObject({ start: '2027-02-23', lateDays: 0 })
    expect(placed.find((p) => p.id === 'b')).toMatchObject({ start: '2027-02-16', end: '2027-02-22', lateDays: 0 })
  })
})

describe('bestQueueFor', () => {
  it('gives the work to whoever can finish it on time', () => {
    const queues = new Map([
      ['usman', [late28]],
      ['aman', [] as QueueJob[]],
    ])
    expect(bestQueueFor(early20, queues, today)).toBe('aman')
  })
})

describe('dataCopyDay', () => {
  it('is the day before, never before the event or today', () => {
    expect(dataCopyDay('2027-02-21', '2027-02-14', today)).toBe('2027-02-20')
    expect(dataCopyDay('2027-02-15', '2027-02-14', today)).toBe('2027-02-14')
  })
})
