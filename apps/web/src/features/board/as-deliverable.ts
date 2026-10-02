import type { BoardDeliverable, Deliverable } from '@ipc/contracts'

/** A board card in the shape the deliverable panel (and Give work) reads. */
export function asDeliverable(d: BoardDeliverable): Deliverable {
  return {
    ...d,
    list_key: 'primary',
    is_additional_charge: false,
    additional_charge_amount: 0,
    show_on_quotation: d.visibility_scope === 'client',
    start_rule: 'whole_project',
  }
}
