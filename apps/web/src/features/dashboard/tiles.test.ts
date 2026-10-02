import { describe, expect, it } from 'vitest'
import { attentionLine, collectLine, shootsWeekLine } from './tiles'

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
