import { describe, expect, it } from 'vitest'
import { crewTotal } from './crew-total'

describe('crewTotal', () => {
  it('adds final amounts first, then estimates, and counts the unset', () => {
    const r = crewTotal([
      { status: 'booked', final_cost: 10000, estimated_cost: 8000, cost_status: 'final' },
      { status: 'booked', final_cost: null, estimated_cost: 6000, cost_status: 'tentative' },
      { status: 'booked', final_cost: null, estimated_cost: null, cost_status: 'not_decided' },
      { status: 'cancelled', final_cost: 9000, estimated_cost: 9000, cost_status: 'final' },
    ])
    expect(r).toEqual({ total: 16000, unset: 1, tentative: true })
  })
  it('is final when every amount is agreed', () => {
    expect(crewTotal([{ status: 'booked', final_cost: 5000, estimated_cost: null, cost_status: 'final' }]).tentative).toBe(false)
  })
})
