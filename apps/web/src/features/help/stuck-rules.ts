/**
 * Noticing that someone is stuck on a screen, so the how-to video can offer
 * itself. Pure: the hook feeds it what happened and asks whether to offer.
 *
 * Stuck is any of:
 *  - 45 seconds on the same screen with nothing moving forward (typing keeps
 *    the clock from running out -- a person filling a form is not stuck);
 *  - Save or Next refused twice;
 *  - the same dialog opened and closed twice without saving.
 *
 * The offer is made once per screen per visit.
 */
export const IDLE_MS = 45_000
const REFUSALS = 2
const DISMISSALS = 2

export interface StuckState {
  /** When something last moved: arrived, typed, picked. */
  lastActivity: number
  refusals: number
  dismissals: number
  offered: boolean
}

export type StuckEvent =
  | { type: 'activity'; at: number }
  /** A step forward (saved, next step): the clock and the counts start again. */
  | { type: 'progress'; at: number }
  | { type: 'refused'; at: number }
  | { type: 'dismissed'; at: number }
  | { type: 'offered' }

export const startStuck = (at: number): StuckState => ({ lastActivity: at, refusals: 0, dismissals: 0, offered: false })

export function stuckStep(s: StuckState, e: StuckEvent): StuckState {
  switch (e.type) {
    case 'activity':
      return { ...s, lastActivity: e.at }
    case 'progress':
      return { ...s, lastActivity: e.at, refusals: 0, dismissals: 0 }
    case 'refused':
      return { ...s, lastActivity: e.at, refusals: s.refusals + 1 }
    case 'dismissed':
      return { ...s, lastActivity: e.at, dismissals: s.dismissals + 1 }
    case 'offered':
      return { ...s, offered: true }
  }
}

/** Why to offer the video now, or null. */
export function stuckReason(s: StuckState, now: number): 'idle' | 'refused' | 'dismissed' | null {
  if (s.offered) return null
  if (s.refusals >= REFUSALS) return 'refused'
  if (s.dismissals >= DISMISSALS) return 'dismissed'
  if (now - s.lastActivity >= IDLE_MS) return 'idle'
  return null
}
