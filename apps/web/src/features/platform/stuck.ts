import type { FlowStop } from '@ipc/contracts'

/** The screens a new studio learns, in the order they meet them. */
export const FLOWS: { key: string; label: string; hint: string }[] = [
  { key: 'team', label: 'Add one person', hint: 'Check the form asks for nothing past a name, a phone and a job role.' },
  { key: 'team-bulk', label: 'Add your team (list)', hint: 'Check a pasted list with an empty or odd row still goes through.' },
  { key: 'client', label: 'New client', hint: 'A name and a phone should be enough; anything else waits under More details.' },
  { key: 'project-client', label: 'Create project: who it is for', hint: 'Picking or adding the client is the step people find hardest to start.' },
  { key: 'project-shoots', label: 'Create project: event days', hint: 'Dates, start time and duration for every day is a lot at once; letting the time wait would help.' },
  { key: 'project-deliverables', label: 'Create project: deliverables', hint: 'A ready list to tick from (the studio’s own packages) saves typing here.' },
  { key: 'project-billing', label: 'Create project: price', hint: 'A price and an advance are all this step needs; anything more can come later.' },
]

export const flowLabel = (key: string) => FLOWS.find((f) => f.key === key)?.label ?? key

/** Share of visits that finished, 0–100, or null with too few to say. */
export function finishRate(r: Pick<FlowStop, 'opened' | 'done'>): number | null {
  if (r.opened < 3) return null
  return Math.round((Math.min(r.done, r.opened) / r.opened) * 100)
}

/**
 * What to do about a screen, in a sentence, or null when it is fine or there
 * are too few visits to say. Worst first: people leaving, then refusals,
 * then the video having to offer itself.
 */
export function stuckAdvice(r: FlowStop): string | null {
  const rate = finishRate(r)
  if (rate == null) return null
  const label = flowLabel(r.flow)
  const hint = FLOWS.find((f) => f.key === r.flow)?.hint ?? ''
  if (rate < 50) return `${100 - rate}% of visits to ${label} leave without finishing. ${hint}`.trim()
  if (r.refused >= Math.max(3, r.opened / 2)) {
    return `Save or Next is refused often on ${label} (${r.refused} times): a field people miss. Point to it, or ask for less.`
  }
  if (r.stuck >= 3) return `The video offered itself ${r.stuck} times on ${label}: people sat there unsure. Check the screen says what to do first.`
  return null
}

/** The screens in the order to look at them: most visits lost first. */
export function rankStops(rows: readonly FlowStop[]): FlowStop[] {
  return [...rows].sort((a, b) => b.left - a.left || b.refused - a.refused)
}
