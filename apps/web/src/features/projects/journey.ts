/**
 * The four steps every booked project goes through, and which one is next.
 *
 * The owner's words: once the project is made, the studio should be taken
 * from the quotation to the invoice to booking the team -- "that guiding is
 * missing, and that journey is missing". This is that journey, as one line
 * on the project: Quotation · Invoice · Team · Deliver, the next step named
 * with one button. Pure, so the order is tested.
 */

export type JourneyKey = 'quotation' | 'invoice' | 'team' | 'deliver'

export interface JourneyInput {
  /** A quotation link was made, or the client accepted one. */
  quotationSent: boolean
  /** Null when this person cannot see billing: the step is left out, not shown as undone. */
  invoiced: boolean | null
  shoots: number
  /** Seats the shoots need, and seats filled (never counting an over-filled role twice). */
  seatsNeeded: number
  seatsFilled: number
  deliverables: number
  delivered: number
}

export interface JourneyStep {
  key: JourneyKey
  label: string
  done: boolean
}

export interface JourneyNext {
  key: JourneyKey
  /** The button. */
  action: string
  /** One short line of what it means. */
  hint: string
}

const LABEL: Record<JourneyKey, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  team: 'Team',
  deliver: 'Deliver',
}

export function journey(input: JourneyInput): { steps: JourneyStep[]; next: JourneyNext | null } {
  const teamDone = input.shoots > 0 && input.seatsNeeded > 0 && input.seatsFilled >= input.seatsNeeded
  const deliverDone = input.deliverables > 0 && input.delivered >= input.deliverables
  const done: Record<JourneyKey, boolean> = {
    quotation: input.quotationSent,
    invoice: input.invoiced === true,
    team: teamDone,
    deliver: deliverDone,
  }
  const keys: JourneyKey[] = ['quotation', 'invoice', 'team', 'deliver'].filter(
    (k) => k !== 'invoice' || input.invoiced !== null,
  ) as JourneyKey[]
  const steps = keys.map((key) => ({ key, label: LABEL[key], done: done[key] }))
  const first = steps.find((s) => !s.done)
  if (!first) return { steps, next: null }
  return { steps, next: nextFor(first.key, input) }
}

function nextFor(key: JourneyKey, i: JourneyInput): JourneyNext {
  switch (key) {
    case 'quotation':
      return { key, action: 'Send the quotation', hint: 'Check the prices and share the link with the client.' }
    case 'invoice':
      return { key, action: 'Create the invoice', hint: 'Bill the booking amount from the payment plan.' }
    case 'team':
      if (i.shoots === 0) return { key, action: 'Add a shoot', hint: 'Add the days you will shoot, then book the team.' }
      if (i.seatsNeeded === 0) return { key, action: 'Book the team', hint: 'Say who each day needs, then pick the people.' }
      return { key, action: 'Book the team', hint: `${i.seatsFilled} of ${i.seatsNeeded} places filled.` }
    case 'deliver':
      if (i.deliverables === 0) return { key, action: 'Add the work to deliver', hint: 'The films, albums and photos this project owes.' }
      return { key, action: 'Deliver the work', hint: `${i.delivered} of ${i.deliverables} delivered.` }
  }
}
