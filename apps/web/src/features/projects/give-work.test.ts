import { describe, expect, it } from 'vitest'
import type { TeamMember } from '@ipc/contracts'
import { defaultWorkDays, orderPeople, placeMe, suggestDue, workloadText } from './give-work'

const person = (user_id: string, name: string, role_names: string[] = []) =>
  ({ user_id, name, role: 'employee', role_names, engagement_type: null, phone: null, email: null, payout_type: null, freelancer_rate: null, login_enabled: true, last_seen_at: null }) as TeamMember

describe('giving work out', () => {
  it('says how loaded someone is', () => {
    expect(workloadText(undefined)).toBe('Free')
    expect(workloadText({ open: 0, late: 0, due_week: 0 })).toBe('Free')
    expect(workloadText({ open: 2, late: 0, due_week: 0 })).toBe('2 in hand')
    expect(workloadText({ open: 3, late: 1, due_week: 2 })).toBe('3 in hand · 1 late')
    expect(workloadText({ open: 2, late: 0, due_week: 1 })).toBe('2 in hand · 1 due this week')
  })

  it('puts editors first, then whoever has least on', () => {
    const load = new Map([
      ['a', { user_id: 'a', open: 4, late: 0, due_week: 0, next_due: null }],
      ['b', { user_id: 'b', open: 1, late: 0, due_week: 0, next_due: null }],
    ])
    const order = orderPeople([person('c', 'Chirag', ['Candid Photographer']), person('a', 'Asha', ['Video Editor']), person('b', 'Bina', ['Photo Editor'])], load)
    expect(order.map((p) => p.name)).toEqual(['Bina', 'Asha', 'Chirag'])
  })

  it('lists editors above "Me" unless I edit too', () => {
    const editors = [person('b', 'Bina', ['Photo Editor']), person('c', 'Chirag', ['Candid Photographer'])]
    expect(placeMe(editors, person('m', 'Asha', ['Owner'])).map((p) => p.name)).toEqual(['Bina', 'Asha', 'Chirag'])
    expect(placeMe(editors, person('m', 'Asha', ['Video Editor'])).map((p) => p.name)).toEqual(['Asha', 'Bina', 'Chirag'])
    expect(placeMe(editors, null).map((p) => p.name)).toEqual(['Bina', 'Chirag'])
  })

  it('suggests a due date from the studio’s own work days, else from what it is', () => {
    expect(suggestDue({ title: 'Teaser', estimated_date: '2026-11-01' }, [], '2026-10-02')).toBe('2026-11-01')
    expect(suggestDue({ title: 'Photo Album' }, [{ title: 'Photo Album', work_days: 25 }], '2026-10-02')).toBe('2026-10-27')
    expect(suggestDue({ title: 'Wedding Teaser' }, [], '2026-10-02')).toBe('2026-10-07')
    expect(defaultWorkDays('Highlight Film')).toBe(12)
  })
})
