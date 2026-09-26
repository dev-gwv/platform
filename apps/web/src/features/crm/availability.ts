import type { CrmLead } from '@ipc/contracts'

/**
 * Whether the studio is free on a lead's event date.
 *
 * The first question of every wedding enquiry, and until 0193 the app had no
 * answer: the lead carried a date, the shoots carried dates, and nothing
 * compared them. The server derives the state; this turns it into the words
 * and the tone a row shows.
 */
export type DateState = CrmLead['date_status']

export interface DateVerdict {
  /** Null only when there is no date to judge. */
  label: string | null
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  /** The longer sentence, for the lead sheet rather than the row. */
  detail: string
}

const NOTHING: DateVerdict = { label: null, tone: 'neutral', detail: '' }

export function dateVerdict(lead: Pick<CrmLead, 'date_status' | 'date_wanted_by' | 'event_date'>): DateVerdict {
  if (!lead.event_date || lead.date_status === 'unknown') {
    return { ...NOTHING, detail: 'No event date yet — ask for it before anything else.' }
  }
  switch (lead.date_status) {
    case 'booked':
      return {
        label: 'Date taken',
        tone: 'neutral',
        detail: 'You are already shooting that day. Worth referring this one on rather than letting it go quiet.',
      }
    case 'contested': {
      // wanted_by counts this lead too, so the number of rivals is one fewer.
      const others = Math.max(1, lead.date_wanted_by - 1)
      return {
        label: `${lead.date_wanted_by} asking`,
        tone: 'danger',
        detail:
          others === 1
            ? 'One other family wants this date. Only one of them can have it.'
            : `${others} other families want this date. Only one of them can have it.`,
      }
    }
    default:
      return { label: 'Free', tone: 'success', detail: 'The studio has nothing booked that day.' }
  }
}

/**
 * Worth putting on a row?
 *
 * "Free" is the answer for most leads, and a green chip on four rows in five
 * crowds out the red one that needs a decision. The row stays quiet and the
 * lead sheet, which has room and is where you decide, says it in full.
 */
export const worthFlagging = (v: DateVerdict): boolean => v.tone === 'danger' || v.tone === 'neutral'

/** Leads whose date collides with something — the ones worth deciding today. */
export function contested(leads: readonly CrmLead[]): CrmLead[] {
  return leads.filter((l) => l.date_status === 'contested')
}
