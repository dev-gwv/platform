import { describe, expect, it } from 'vitest'
import type { CrewPayoutRow } from '@ipc/contracts'
import { statementOrder } from './MoneyStatement'

const row = (slot_id: string, shoot_date: string, paid = 0): CrewPayoutRow => ({
  slot_id,
  user_id: 'u',
  user_name: 'Asha',
  role: null,
  shoot_id: null,
  shoot_name: null,
  project_id: null,
  project_name: null,
  shoot_date,
  amount: 1000,
  cost_status: 'final',
  paid,
  last_paid_date: null,
  stands: true,
})

describe('statementOrder', () => {
  it('puts money owed first (oldest first), then upcoming (soonest), then paid (latest)', () => {
    const order = statementOrder(
      [
        row('paid-old', '2026-08-01', 1000),
        row('up-far', '2026-11-01'),
        row('owed-new', '2026-09-30'),
        row('paid-new', '2026-09-20', 1000),
        row('owed-old', '2026-09-01'),
        row('up-soon', '2026-10-03'),
      ],
      '2026-10-02',
    ).map((r) => r.slot_id)
    expect(order).toEqual(['owed-old', 'owed-new', 'up-soon', 'up-far', 'paid-new', 'paid-old'])
  })
})
