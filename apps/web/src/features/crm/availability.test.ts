import { describe, expect, it } from 'vitest'
import type { CrmLead } from '@ipc/contracts'
import { contested, dateVerdict, worthFlagging } from './availability'

type Input = Pick<CrmLead, 'date_status' | 'date_wanted_by' | 'event_date'>
const on = (over: Partial<Input> = {}): Input => ({
  event_date: '2027-12-14',
  date_status: 'free',
  date_wanted_by: 1,
  ...over,
})

describe('dateVerdict', () => {
  it('names a free date, but does not think it worth a badge', () => {
    const v = dateVerdict(on())
    expect(v.label).toBe('Free')
    expect(v.tone).toBe('success')
    // A green chip on four rows in five crowds out the red one that needs a
    // decision, so the row stays quiet and the lead sheet says it in full.
    expect(worthFlagging(v)).toBe(false)
  })

  it('flags the two states that need a decision', () => {
    expect(worthFlagging(dateVerdict(on({ date_status: 'contested', date_wanted_by: 2 })))).toBe(true)
    expect(worthFlagging(dateVerdict(on({ date_status: 'booked' })))).toBe(true)
  })

  it('says nothing when no date has been asked for yet', () => {
    expect(dateVerdict(on({ event_date: null, date_status: 'unknown', date_wanted_by: 0 })).label).toBeNull()
    expect(dateVerdict(on({ event_date: null, date_status: 'unknown' })).detail).toContain('No event date yet')
  })

  it('calls a booked day taken, and points at referring it on', () => {
    const v = dateVerdict(on({ date_status: 'booked', date_wanted_by: 1 }))
    expect(v.label).toBe('Date taken')
    expect(v.tone).toBe('neutral')
    expect(v.detail).toContain('referring')
  })

  // wanted_by counts this lead too, so two wanting it is one rival, not two.
  it('counts rivals as everyone else, not everyone', () => {
    const two = dateVerdict(on({ date_status: 'contested', date_wanted_by: 2 }))
    expect(two.label).toBe('2 asking')
    expect(two.tone).toBe('danger')
    expect(two.detail).toContain('One other family')

    const three = dateVerdict(on({ date_status: 'contested', date_wanted_by: 3 }))
    expect(three.label).toBe('3 asking')
    expect(three.detail).toContain('2 other families')
  })

  it('never claims zero rivals, whatever the count says', () => {
    const odd = dateVerdict(on({ date_status: 'contested', date_wanted_by: 1 }))
    expect(odd.detail).toContain('One other family')
  })

  it('trusts the date over a stale status', () => {
    // A lead whose date was cleared must not keep yesterday's verdict.
    expect(dateVerdict(on({ event_date: null, date_status: 'contested', date_wanted_by: 4 })).label).toBeNull()
  })
})

describe('contested', () => {
  const lead = (id: string, status: CrmLead['date_status']) => ({ id, date_status: status }) as CrmLead

  it('picks out only the dates two people want', () => {
    const rows = [lead('a', 'free'), lead('b', 'contested'), lead('c', 'booked'), lead('d', 'contested')]
    expect(contested(rows).map((l) => l.id)).toEqual(['b', 'd'])
  })

  it('is empty when the calendar is clear', () => {
    expect(contested([lead('a', 'free'), lead('b', 'unknown')])).toEqual([])
  })
})
