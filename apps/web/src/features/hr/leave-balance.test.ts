import { describe, expect, it } from 'vitest'
import { approvalCheck, balanceLine } from './leave-balance'

const id = '00000000-0000-4000-8000-000000000001'
const b = (kind: 'casual' | 'sick', allowance: number, remaining: number) => ({
  user_id: id, user_name: 'Priya', kind, allowance, used: allowance - remaining, pending: 0, remaining,
})

describe('leave balances', () => {
  it('says what is left in one line', () => {
    expect(balanceLine(b('casual', 12, 9))).toBe('9 of 12 casual left')
    expect(balanceLine(b('sick', 6, 5.5))).toBe('5.5 of 6 sick left')
    expect(balanceLine(b('casual', 12, -1))).toBe('0 of 12 casual left')
  })

  it('tells the approver when a request goes past what is left', () => {
    expect(approvalCheck([b('casual', 12, 3)], id, 'casual', 2)).toEqual({ text: 'Has 3 days casual left · this is 2 days', over: 0 })
    expect(approvalCheck([b('casual', 12, 1)], id, 'casual', 3)).toEqual({ text: 'Has 1 day casual left · this is 3 days, 2 over', over: 2 })
    expect(approvalCheck([b('casual', 12, 0)], id, 'casual', 1)?.text).toBe('Has no casual leave left · this is 1 day, 1 over')
    expect(approvalCheck([b('casual', 12, 3)], id, 'unpaid', 2)).toBeNull()
  })
})
