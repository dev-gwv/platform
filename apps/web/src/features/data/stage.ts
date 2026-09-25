import type { CustodyStatus, DataRecord, DataStage, ShootListItem, TeamSlot } from '@ipc/contracts'
import { hoursLabel, isLive } from '@/features/shoots/assign'

/**
 * Where a booking's footage is, in words the shoot card can show.
 *
 * The stage itself is derived by the database from the two copies (0160);
 * deriveStage mirrors that rule so a screen can show what a change will do
 * before it is saved, and the mock preview agrees with the real API.
 */

type StageInput = Pick<DataRecord, 'primary_status' | 'backup_status' | 'date_received' | 'issue_found' | 'is_not_required'> &
  Partial<Pick<DataRecord, 'archived_at'>>

/** Same order as data_record_stage() in 0173 -- keep the two in step. */
export function deriveStage(r: StageInput): DataStage {
  const p = r.primary_status
  const b = r.backup_status
  if (r.is_not_required || (b === 'not_required' && p === 'pending')) return 'not_required'
  if (r.issue_found || p === 'issue' || b === 'issue') return 'issue'
  if (r.archived_at && (p === 'copied' || p === 'verified')) return 'archived'
  if (p === 'verified' && (b === 'verified' || b === 'not_required')) return 'verified'
  if ((p === 'copied' || p === 'verified') && (b === 'copied' || b === 'verified' || b === 'not_required'))
    return 'backed_up'
  if (p === 'copied' || p === 'verified') return 'copied'
  if (r.date_received) return 'received'
  return 'with_shooter'
}

/** A booking's data: a record's stage, or why there is none. */
export type SlotStage = DataStage | 'missing' | 'opted_out'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export const STAGE_LABEL: Record<SlotStage, string> = {
  missing: 'Data not added',
  opted_out: 'No data needed',
  with_shooter: 'With shooter',
  received: 'Received',
  copied: 'Copied · no backup yet',
  backed_up: 'Backed up',
  verified: 'Verified',
  archived: 'Archived',
  issue: 'Issue',
  not_required: 'No data needed',
}

export const STAGE_TONE: Record<SlotStage, Tone> = {
  missing: 'danger',
  opted_out: 'neutral',
  with_shooter: 'warning',
  received: 'warning',
  copied: 'info',
  backed_up: 'success',
  verified: 'success',
  archived: 'neutral',
  issue: 'danger',
  not_required: 'neutral',
}

export const TRACK_LABEL: Record<CustodyStatus, string> = {
  pending: 'Pending',
  copied: 'Copied',
  verified: 'Verified',
  issue: 'Issue',
  not_required: 'Not needed',
}

export const TRACK_TONE: Record<CustodyStatus, Tone> = {
  pending: 'neutral',
  copied: 'warning',
  verified: 'success',
  issue: 'danger',
  not_required: 'neutral',
}

const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/**
 * The record for a booking. The booking link comes first; a record from
 * before bookings were linked is still found by person and role on the same
 * shoot, and gets linked the next time it is saved from the row.
 */
export function recordForSlot(slot: TeamSlot, records: readonly DataRecord[]): DataRecord | undefined {
  const linked = records.find((r) => r.slot_id === slot.id)
  if (linked) return linked
  return records.find(
    (r) =>
      !r.slot_id &&
      r.shoot_id === slot.shoot_id &&
      key(r.team_member_name) === key(slot.user_name) &&
      key(r.requirement_name) === key(slot.service_name),
  )
}

/**
 * A booking has opted out of data only when someone said why -- the column
 * defaults to "not required" (0008), so the flag alone means nothing.
 */
export const optedOut = (slot: Pick<TeamSlot, 'data_required' | 'data_not_required_reason'>) =>
  !slot.data_required && !!slot.data_not_required_reason?.trim()

export function slotStage(slot: TeamSlot, record: DataRecord | undefined): SlotStage {
  if (record) return record.data_status
  return optedOut(slot) ? 'opted_out' : 'missing'
}

/** Data is in hand for a booking once it is copied and backed up. */
const isDone = (s: SlotStage) =>
  s === 'backed_up' || s === 'verified' || s === 'archived' || s === 'not_required' || s === 'opted_out'

/** "Data 2/3" on a shoot or a role: bookings whose data is safe, of those that owe it. */
export function dataCounts(slots: readonly TeamSlot[], records: readonly DataRecord[]) {
  let needed = 0
  let done = 0
  for (const s of slots) {
    if (!isLive(s) || optedOut(s)) continue
    needed++
    if (isDone(slotStage(s, recordForSlot(s, records)))) done++
  }
  return { needed, done }
}

/** "Fri 26 Sep · 12:55 am–4:55 am": the day first, because that is what gets missed. */
export function whenLabel(slot: Pick<TeamSlot, 'start_at' | 'end_at'>, timeZone?: string): string {
  const day = new Date(slot.start_at).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(timeZone ? { timeZone } : {}),
  })
  return `${day} · ${hoursLabel(slot, timeZone)}`
}

/** The booking's own day, as YYYY-MM-DD in local time. */
export function slotDay(slot: Pick<TeamSlot, 'start_at'>, timeZone?: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Date(slot.start_at).toLocaleDateString('en-CA', timeZone ? { timeZone } : {})
}

export const DATA_TYPES = [
  { value: 'photos', label: 'Photos' },
  { value: 'videos', label: 'Videos' },
  { value: 'drone', label: 'Drone' },
  { value: 'audio', label: 'Audio' },
  { value: 'raw_data', label: 'Raw data' },
  { value: 'edited_data', label: 'Edited data' },
  { value: 'project_files', label: 'Project files' },
  { value: 'other', label: 'Other' },
] as const

/** A sensible type for a role, so the common case needs no choosing. */
export function defaultDataType(role: string | null | undefined): string {
  const r = key(role)
  if (r.includes('drone')) return 'drone'
  if (r.includes('video') || r.includes('cinema') || r.includes('film')) return 'videos'
  if (r.includes('audio') || r.includes('sound')) return 'audio'
  if (r.includes('edit')) return 'edited_data'
  if (r.includes('album') || r.includes('design')) return 'project_files'
  return 'photos'
}

/** "Haldi · Candid Photographer · Rahul" -- findable on the Data page later. */
export function defaultLabel(shoot: Pick<ShootListItem, 'name'>, slot: Pick<TeamSlot, 'service_name' | 'user_name'>): string {
  return [shoot.name, slot.service_name, slot.user_name].filter(Boolean).join(' · ').slice(0, 160)
}
