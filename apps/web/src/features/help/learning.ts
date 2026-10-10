import type { LearnNote, LearnSignals } from '@ipc/contracts'

/**
 * When a how-to card shows, and when it steps back for good.
 *
 * A card is for someone still learning that job. It goes away by itself once
 * the studio has done the job twice, once the person watched its video to
 * the end, or when they close it; and every "get started" card goes once the
 * studio has three projects or the person has had their login two weeks.
 * After that only the small "Watch how" beside the page title is left.
 */
type LearnArea = 'team' | 'client' | 'project'

/** Which job each video teaches. A video not listed here never retires by count. */
const LEARN_AREA: Record<string, LearnArea> = {
  team: 'team',
  'team-bulk': 'team',
  client: 'client',
  project: 'project',
  'project-client': 'project',
  'project-shoots': 'project',
  'project-deliverables': 'project',
  'project-billing': 'project',
}

/** Done twice: they know the way. */
const DONE_ENOUGH = 2
/** Every get-started card goes after this many projects... */
const PROJECTS_TO_GRADUATE = 3
/** ...or this many days on the app. */
const DAYS_TO_GRADUATE = 14

const DAY = 86_400_000

function doneCount(area: LearnArea, s: LearnSignals): number {
  return area === 'team' ? s.teammates : area === 'client' ? s.clients : s.projects
}

/** Whether this person has outgrown the card for `key`. */
export function isRetired(key: string, signals: LearnSignals, note: LearnNote | undefined, now = Date.now()): boolean {
  if (note?.closed.includes(key) || note?.watched.includes(key)) return true
  if (signals.projects >= PROJECTS_TO_GRADUATE) return true
  const since = Date.parse(signals.since)
  if (Number.isFinite(since) && now - since >= DAYS_TO_GRADUATE * DAY) return true
  const area = LEARN_AREA[key]
  return !!area && doneCount(area, signals) >= DONE_ENOUGH
}

/** A video counts as watched once 90% of it has played. */
const WATCHED_SHARE = 0.9

export function watchedEnough(played: number, duration: number): boolean {
  return duration > 0 && played / duration >= WATCHED_SHARE
}

/** The note with `key` added to `list` (once, newest last, the list kept short). */
export function remember(note: LearnNote | undefined, list: 'watched' | 'closed', key: string): LearnNote {
  const base: LearnNote = { watched: note?.watched ?? [], closed: note?.closed ?? [] }
  if (base[list].includes(key)) return base
  return { ...base, [list]: [...base[list], key].slice(-60) }
}
