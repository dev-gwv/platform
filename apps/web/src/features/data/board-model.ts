import type { BulkDataAction, DataBoardRow, DataBoardStage } from '@ipc/contracts'

/**
 * The data board's arithmetic, kept out of the components so it can be argued
 * with in tests: which lane a booking's data is in, how late it is, who is
 * holding the most cards, and what to do next.
 *
 * "Missing" has one meaning everywhere: a booked person whose shoot day has
 * come, who owes data, with no record yet. The server decides it (GET
 * /data/board); nothing here second-guesses it.
 */

export type LaneKey = 'crew' | 'received' | 'copied' | 'backed_up' | 'verified'

export const LANES: readonly { key: LaneKey; label: string; hint: string }[] = [
  { key: 'crew', label: 'With crew', hint: 'Cards not handed over yet' },
  { key: 'received', label: 'Received', hint: 'In the studio, not copied' },
  { key: 'copied', label: 'Copied', hint: 'Main copy done, no backup' },
  { key: 'backed_up', label: 'Backed up', hint: 'Two copies, not checked' },
  { key: 'verified', label: 'Verified', hint: 'Both copies checked' },
]

/** The lane a row sits in, or null for rows the board does not lay out (issue, archived, not needed). */
export function laneOf(stage: DataBoardStage): LaneKey | null {
  switch (stage) {
    case 'missing':
    case 'with_shooter':
      return 'crew'
    case 'received':
    case 'copied':
    case 'backed_up':
    case 'verified':
      return stage
    default:
      return null
  }
}

/** Data that is not yet in two places: what the studio could still lose. */
export const UNSAFE: ReadonlySet<DataBoardStage> = new Set(['missing', 'with_shooter', 'received', 'copied', 'issue'])

/** Late after three days, critical after a week -- the old platform's thresholds, kept. */
export const LATE_DAYS = 3
export const CRITICAL_DAYS = 7

export type Level = 'ok' | 'late' | 'critical'

export function levelOf(row: Pick<DataBoardRow, 'stage' | 'age_days'>): Level {
  if (!UNSAFE.has(row.stage)) return 'ok'
  if (row.age_days >= CRITICAL_DAYS) return 'critical'
  if (row.age_days >= LATE_DAYS) return 'late'
  return 'ok'
}

export type Focus = 'open' | 'late' | 'issues' | 'archived'

export const FOCI: readonly { key: Focus; label: string }[] = [
  { key: 'open', label: 'Everything' },
  { key: 'late', label: 'Late (3+ days)' },
  { key: 'issues', label: 'Issues' },
  { key: 'archived', label: 'Archived & not needed' },
]

export function inFocus(row: DataBoardRow, focus: Focus): boolean {
  switch (focus) {
    case 'open':
      return row.stage !== 'archived' && row.stage !== 'not_required'
    case 'late':
      return levelOf(row) !== 'ok'
    case 'issues':
      return row.stage === 'issue'
    case 'archived':
      return row.stage === 'archived' || row.stage === 'not_required'
  }
}

/** Shoot, project, client, person, role, label and where it is: all searchable. */
export function matches(row: DataBoardRow, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const r = row.record
  return [
    row.shoot_name,
    row.project_name,
    row.client_name,
    row.user_name,
    row.role,
    r?.data_label,
    r?.primary_location_name,
    r?.backup_location_name,
    r?.folder_path,
    r?.backup_folder_path,
  ].some((v) => (v ?? '').toLowerCase().includes(needle))
}

/** The four figures on top. */
export function figures(rows: readonly DataBoardRow[]) {
  let crew = 0
  let received = 0
  let copied = 0
  let issues = 0
  let late = 0
  let critical = 0
  for (const r of rows) {
    if (r.stage === 'missing' || r.stage === 'with_shooter') crew++
    else if (r.stage === 'received') received++
    else if (r.stage === 'copied') copied++
    else if (r.stage === 'issue') issues++
    const l = levelOf(r)
    if (l === 'late') late++
    if (l === 'critical') critical++
  }
  return { crew, received, copied, issues, late, critical }
}

export interface Holder {
  user_id: string
  name: string
  phone: string | null
  count: number
  oldest: number
}

/** Who is holding the most cards that have not come in, worst first. */
export function mostPending(rows: readonly DataBoardRow[], top = 5): Holder[] {
  const by = new Map<string, Holder>()
  for (const r of rows) {
    if (laneOf(r.stage) !== 'crew' || !r.user_id) continue
    const h = by.get(r.user_id) ?? { user_id: r.user_id, name: r.user_name ?? 'Someone', phone: r.phone, count: 0, oldest: 0 }
    h.count += 1
    h.oldest = Math.max(h.oldest, r.age_days)
    by.set(r.user_id, h)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.oldest - a.oldest || a.name.localeCompare(b.name)).slice(0, top)
}

/** What has to happen next, in a few words. */
export function nextAction(row: DataBoardRow): string {
  const first = (row.user_name ?? '').split(' ')[0] || 'the crew'
  switch (row.stage) {
    case 'missing':
    case 'with_shooter':
      return `Collect cards from ${first}`
    case 'received':
      return 'Copy to the main disk'
    case 'copied':
      return 'Make the backup'
    case 'backed_up':
      return 'Check both copies'
    case 'verified':
      return row.record?.handed_to_editor_at ? 'With the editor' : 'Hand to the editor'
    case 'issue':
      return 'Sort out the issue'
    case 'archived':
      return 'Archived'
    case 'not_required':
      return 'No data needed'
  }
}

/** Oldest first inside a lane: the card most likely to be lost goes on top. */
export const byAge = (a: DataBoardRow, b: DataBoardRow) =>
  b.age_days - a.age_days || (a.shoot_name ?? '').localeCompare(b.shoot_name ?? '') || (a.user_name ?? '').localeCompare(b.user_name ?? '')

export const BULK_ACTIONS: readonly { key: BulkDataAction; label: string; needsLocation: boolean }[] = [
  { key: 'received', label: 'Mark received', needsLocation: false },
  { key: 'copied', label: 'Copied to…', needsLocation: true },
  { key: 'backed_up', label: 'Backed up to…', needsLocation: true },
  { key: 'verified', label: 'Mark verified', needsLocation: false },
  { key: 'handed_to_editor', label: 'Handed to editor', needsLocation: false },
  { key: 'archived', label: 'Archived to…', needsLocation: true },
]

/** The ids a bulk change is sent with: bookings by slot, loose records by record. */
export function bulkIds(rows: readonly DataBoardRow[]) {
  const slot_ids: string[] = []
  const record_ids: string[] = []
  for (const r of rows) {
    if (r.slot_id) slot_ids.push(r.slot_id)
    else if (r.record) record_ids.push(r.record.id)
  }
  return { slot_ids, record_ids }
}

/** The WhatsApp nudge for someone still holding cards. */
export function chaseMessage(h: Pick<Holder, 'name' | 'count' | 'oldest'>): string {
  const first = h.name.split(' ')[0] || 'there'
  const cards = h.count === 1 ? 'the cards from 1 shoot' : `the cards from ${h.count} shoots`
  return `Hi ${first}, please hand over ${cards} to the studio today${h.oldest >= LATE_DAYS ? ` -- the oldest is ${h.oldest} days old` : ''}. Thank you!`
}

/** Digits only, with India's code when a 10-digit number has none. */
export function waNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length === 10) return `91${d}`
  return d.length >= 11 ? d : null
}
