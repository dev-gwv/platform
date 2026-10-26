import type { SlotCostField } from '@ipc/contracts'

type Cost = { estimated_cost: number | null; final_cost: number | null; cost_notes: string | null }
type Next = { estimated_cost?: number | null | undefined; final_cost?: number | null | undefined; cost_notes?: string | null | undefined }

const FIELDS: SlotCostField[] = ['estimated_cost', 'final_cost', 'cost_notes']

/**
 * Which of a booking's payout fields an edit empties. `set_slot_cost` keeps
 * what it is not given, so an amount or note taken out of the box has to be
 * named to be cleared (0285); only a field that held something and is now
 * explicitly null counts.
 */
export function costClears(before: Cost, next: Next): SlotCostField[] {
  return FIELDS.filter((f) => next[f] === null && before[f] != null && before[f] !== '')
}

/** "No payout": every amount and the note go, and the payout is not decided. */
export const NO_PAYOUT = {
  estimated_cost: null,
  final_cost: null,
  cost_status: 'not_decided' as const,
  cost_notes: null,
  clear: FIELDS,
}
