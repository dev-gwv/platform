import { roundINR } from './money'

/**
 * Crew money by when the shoot is. A booking is owed once its shoot day has
 * passed (India's date); before that it is a promise. Money paid before the
 * shoot is "paid in advance", never subtracted from what is owed for shoots
 * already done.
 */
export interface CrewPayoutLine {
  user_id: string
  user_name: string | null
  /** The shoot's day, YYYY-MM-DD in India. */
  shoot_date: string
  /** What the booking pays. */
  amount: number
  /** Signed total paid toward it (reversals already subtracted). */
  paid: number
}

export type CrewBucket = 'past' | 'upcoming'

/** Owed once the day has passed: a shoot today is still upcoming. */
export function crewBucketOf(shootDate: string, today: string): CrewBucket {
  return shootDate < today ? 'past' : 'upcoming'
}

export function lineBalance(l: Pick<CrewPayoutLine, 'amount' | 'paid'>): number {
  return Math.max(0, l.amount - l.paid)
}

export interface CrewOwedPerson {
  user_id: string
  user_name: string | null
  owed: number
  /** Shoots already done that still have money left on them. */
  bookings: number
}

export interface CrewOwedSummary {
  /** Shoots already done, minus what has been paid toward them. */
  owed_now: number
  /** What future shoots will pay, less anything paid ahead. */
  upcoming: number
  /** Everything paid, on any booking. */
  paid: number
  /** Paid toward shoots that have not happened yet. */
  paid_ahead: number
  /** Everyone with something owed now, most owed first. */
  people: CrewOwedPerson[]
}

export function summarizeCrewOwed(lines: readonly CrewPayoutLine[], today: string): CrewOwedSummary {
  let owedNow = 0
  let upcoming = 0
  let paid = 0
  let paidAhead = 0
  const byPerson = new Map<string, CrewOwedPerson>()
  for (const l of lines) {
    paid += l.paid
    const left = lineBalance(l)
    if (crewBucketOf(l.shoot_date, today) === 'past') {
      if (left <= 0.001) continue
      owedNow += left
      const p = byPerson.get(l.user_id) ?? { user_id: l.user_id, user_name: l.user_name, owed: 0, bookings: 0 }
      p.owed += left
      p.bookings += 1
      byPerson.set(l.user_id, p)
    } else {
      upcoming += left
      if (l.paid > 0) paidAhead += l.paid
    }
  }
  const people = [...byPerson.values()]
    .map((p) => ({ ...p, owed: roundINR(p.owed) }))
    .sort((a, b) => b.owed - a.owed || (a.user_name ?? '').localeCompare(b.user_name ?? ''))
  return {
    owed_now: roundINR(owedNow),
    upcoming: roundINR(upcoming),
    paid: roundINR(paid),
    paid_ahead: roundINR(paidAhead),
    people,
  }
}
