import type { QuotationReading } from '@ipc/contracts'
import { deliverableTimings, type StudioDeliverableType } from '@ipc/domain'
import { EMPTY_DRAFT, newDeliverable, newShoot, type ProjectDraft } from './wizard'

/**
 * An uploaded quotation (0311) as a Create project draft, so the project it
 * makes is the same as one typed in by hand: the same client, days,
 * requirements and deliverables, dated the same way.
 *
 * A deliverable keeps the time the quotation promises ("Reels 2 weeks" = 14
 * days after the last event); one the quotation does not time takes the
 * studio's own type of that name, else the usual days. Editing days are
 * always the studio's (or the usual), since a quotation never says them.
 */
export function readingToDraft(reading: QuotationReading, types: readonly StudioDeliverableType[] = []): ProjectDraft {
  const client = reading.client_name?.trim() || ''
  const name = reading.project_name?.trim() || (client ? `${client} Wedding` : 'Wedding from quotation')
  return {
    ...EMPTY_DRAFT,
    name,
    new_client_name: client || name,
    new_client_phone: reading.client_phone?.replace(/[^\d+]/g, '').slice(0, 20) ?? '',
    new_client_email: reading.client_email?.trim() ?? '',
    new_client_notes: reading.notes?.trim() ?? '',
    package_cost: reading.total ? String(Math.round(reading.total)) : '',
    shoots: reading.events.map((e) => ({
      ...newShoot(),
      name: e.name,
      shoot_date: e.date ?? '',
      start_time: e.start_time ?? '',
      hours: e.hours ? String(e.hours) : '',
      location: e.city ?? '',
      guests: e.guests ? String(e.guests) : '',
      requirements: e.team.map((t) => ({ name: t.role, quantity: String(t.quantity) })),
    })),
    deliverables: reading.deliverables.map((d) => {
      const timing = deliverableTimings(d.title, types)
      const priced = d.is_add_on && (d.price ?? 0) > 0
      return {
        ...newDeliverable(),
        title: d.title,
        due_days: String(d.due_days ?? timing.due_days),
        due_basis: d.due_days !== null ? 'after_last_shoot' : timing.due_basis,
        lead_days: String(timing.work_days),
        is_additional_charge: priced,
        additional_charge_amount: priced ? String(d.price) : '',
      }
    }),
  }
}

/** "5 days · 9 deliverables · ₹2,00,000" -- what was read, before it is made. */
export function readingSummary(reading: QuotationReading): string {
  const parts = [
    `${reading.events.length} ${reading.events.length === 1 ? 'event' : 'events'}`,
    `${reading.deliverables.length} ${reading.deliverables.length === 1 ? 'deliverable' : 'deliverables'}`,
  ]
  return parts.join(' · ')
}
