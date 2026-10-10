import { describe, expect, it } from 'vitest'
import { attentionLine, collectLine, leadsTileLine, moneyTile, shootsTile, shootsWeekLine } from './tiles'

const today = '2026-10-02'

describe('shootsWeekLine', () => {
  it('counts today to six days on, not cancelled ones', () => {
    const shoots = [
      { shoot_date: '2026-10-02', status: 'planned' },
      { shoot_date: '2026-10-08', status: 'confirmed' },
      { shoot_date: '2026-10-09', status: 'planned' },
      { shoot_date: '2026-10-04', status: 'cancelled' },
      { shoot_date: '2026-10-01', status: 'completed' },
      { shoot_date: null, status: 'planned' },
    ]
    expect(shootsWeekLine(shoots, today)).toBe('2 shoots this week')
    expect(shootsWeekLine(shoots.slice(0, 1), today)).toBe('1 shoot this week')
    expect(shootsWeekLine([], today)).toBe('No shoots this week')
  })
})

describe('attentionLine', () => {
  it('says all is well, or what is late', () => {
    expect(attentionLine({ attention: 0, overdue: 0 })).toBe('Nothing urgent')
    expect(attentionLine({ attention: 3, overdue: 1 })).toBe('1 project with late work')
    expect(attentionLine({ attention: 2, overdue: 0 })).toBe('Open Project Tracking')
  })
})

describe('collectLine', () => {
  it('counts open invoices and the late ones', () => {
    const inv = [
      { balance_due: 5000, due_date: '2026-09-01', status: 'sent' },
      { balance_due: 8000, due_date: '2026-11-01', status: 'sent' },
      { balance_due: 3000, due_date: null, status: 'partially_paid' },
      { balance_due: 0, due_date: '2026-09-01', status: 'paid' },
      { balance_due: 9000, due_date: '2026-09-01', status: 'draft' },
    ]
    expect(collectLine(inv, today)).toBe('from 3 invoices · 1 overdue')
    expect(collectLine(inv.slice(1, 2), today)).toBe('from 1 invoice')
    expect(collectLine([], today)).toBe('Nothing waiting')
  })
})

describe('the three Home tiles', () => {
  it('Leads: to call today, and those never rung', () => {
    expect(leadsTileLine([])).toBe('Nobody to call today')
    expect(leadsTileLine([{ last_contacted_at: null }, { last_contacted_at: '2026-10-01T10:00:00Z' }])).toBe('2 to call today · 1 not contacted yet')
    expect(leadsTileLine([{ last_contacted_at: '2026-10-01T10:00:00Z' }])).toBe('1 to call today')
  })

  it('Shoots: this week, and the days still short of people', () => {
    const shoots = [
      { id: 'a', shoot_date: '2026-10-02', status: 'planned' },
      { id: 'b', shoot_date: '2026-10-05', status: 'planned' },
      { id: 'c', shoot_date: '2026-10-20', status: 'planned' },
      { id: 'd', shoot_date: '2026-10-03', status: 'cancelled' },
    ]
    expect(shootsTile(shoots, (id) => id === 'b' || id === 'c', today)).toEqual({ count: 2, short: 1, line: '1 still needs people' })
    expect(shootsTile(shoots, () => false, today).line).toBe('Every day has its team')
    expect(shootsTile([], () => true, today).line).toBe('No shoots this week')
  })

  it('Money: due in 30 days with overdue in it, from the Payments received rule', () => {
    const inr = (n: number) => `₹${n}`
    expect(moneyTile({ overdue: { amount: 0 }, soon: { amount: 0 } }, inr)).toEqual({ amount: 0, line: 'Nothing due in 30 days' })
    expect(moneyTile({ overdue: { amount: 400 }, soon: { amount: 1200 } }, inr)).toEqual({ amount: 1600, line: '₹1200 due in 30 days · ₹400 overdue' })
    expect(moneyTile({ overdue: { amount: 0 }, soon: { amount: 1200 } }, inr).line).toBe('due in the next 30 days')
  })
})
