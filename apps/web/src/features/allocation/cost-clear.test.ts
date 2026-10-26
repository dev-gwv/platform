import { describe, expect, it } from 'vitest'
import { NO_PAYOUT, costClears } from './cost-clear'

const slot = { estimated_cost: 12000, final_cost: 12000, cost_notes: 'Agreed on call' }

describe('which payout fields an edit empties', () => {
  it('names only a field that held something and is now empty', () => {
    expect(costClears(slot, { estimated_cost: 12000, final_cost: null, cost_notes: null })).toEqual(['final_cost', 'cost_notes'])
  })

  it('leaves a field the edit does not mention', () => {
    expect(costClears(slot, { estimated_cost: 15000 })).toEqual([])
  })

  it('has nothing to empty on a booking with no payout yet', () => {
    expect(costClears({ estimated_cost: null, final_cost: null, cost_notes: null }, { estimated_cost: null, final_cost: null, cost_notes: null })).toEqual([])
  })

  it('"No payout" empties every amount and the note', () => {
    expect(NO_PAYOUT.clear).toEqual(['estimated_cost', 'final_cost', 'cost_notes'])
    expect(NO_PAYOUT.cost_status).toBe('not_decided')
  })
})
