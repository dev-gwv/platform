import { describe, expect, it } from 'vitest'
import { payState } from './pay'
import { payoutRequest, startPayout } from './PayoutLine'
import { payoutsSentence } from '@/features/projects/tabs/PayoutsTab'

const status = { slot_id: '00000000-0000-4000-8000-000000000001', user_name: 'Rahul', amount: 6000, cost_status: 'tentative', paid: 0 }
const today = '2026-10-02'

describe('payouts', () => {
  it('says where a payout stands', () => {
    expect(payState(0, 0)).toBe('no_amount')
    expect(payState(6000, 0)).toBe('due')
    expect(payState(6000, 2000)).toBe('part')
    expect(payState(6000, 6000)).toBe('paid')
    expect(payState(0, 500)).toBe('paid')
  })

  it('pays nothing and changes nothing when left at "Pay later"', () => {
    expect(payoutRequest(startPayout(status), status, today)).toBeNull()
  })

  it('"Paid in full" pays what is still owed, at a changed amount if one was typed', () => {
    expect(payoutRequest({ amount: '6000', choice: 'full', part: '' }, status, today)).toEqual({ paid_now: 6000, paid_date: today })
    expect(payoutRequest({ amount: '7500', choice: 'full', part: '' }, { ...status, paid: 1000 }, today)).toEqual({ amount: 7500, paid_now: 6500, paid_date: today })
  })

  it('"Part paid" pays what was typed, never past what is owed; a new amount alone is saved too', () => {
    expect(payoutRequest({ amount: '6000', choice: 'part', part: '2000' }, status, today)).toEqual({ paid_now: 2000, paid_date: today })
    expect(payoutRequest({ amount: '6000', choice: 'part', part: '9000' }, status, today)?.paid_now).toBe(6000)
    expect(payoutRequest({ amount: '5000', choice: 'later', part: '' }, status, today)).toEqual({ amount: 5000, paid_now: 0 })
  })

  it('says what a project owes in a sentence', () => {
    expect(payoutsSentence([])).toBe('Nobody is booked on this project yet.')
    expect(
      payoutsSentence([
        { user_id: 'a', amount: 6000, paid: 0 },
        { user_id: 'b', amount: 4000, paid: 4000 },
        { user_id: 'c', amount: 0, paid: 0 },
      ]),
    ).toBe('₹6,000 still to pay 1 person · ₹4,000 paid · 1 booking has no payout set.')
  })
})
