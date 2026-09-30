import { parseCsv } from '@ipc/domain'
import type { LegacyStudio, LegacyStudioInput } from '@ipc/contracts'

/**
 * The old app's subscribers, read from its Studio Access "Export CSV"
 * (Studio Name, Owner Name, Email, Phone, Created Date, Status, Expiry Date,
 * Days Left, Plan, Company ID, Owner UID). Pure, so the reading is tested.
 */
export interface LegacyParse {
  rows: LegacyStudioInput[]
  /** Lines that could not be read (no studio name or no Company ID). */
  skipped: number
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, '')
const isoDay = (v: string | undefined) => {
  const s = (v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

export function parseLegacyCsv(text: string): LegacyParse | null {
  const grid = parseCsv(text)
  if (grid.length < 1) return null
  const head = grid[0]!.map(norm)
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h))
  const at = {
    name: col('studioname', 'studio'),
    owner: col('ownername', 'owner'),
    email: col('email', 'owneremail'),
    phone: col('phone', 'ownerphone'),
    created: col('createddate', 'created'),
    expiry: col('expirydate', 'expires', 'planexpiry'),
    plan: col('plan'),
    id: col('companyid'),
  }
  if (at.name < 0 || at.id < 0) return null
  const rows: LegacyStudioInput[] = []
  let skipped = 0
  for (const r of grid.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
    const name = cell(at.name)
    const id = cell(at.id)
    if (!name || !id) {
      if (r.some((c) => c.trim())) skipped++
      continue
    }
    rows.push({
      old_company_id: id,
      studio_name: name.slice(0, 200),
      owner_name: cell(at.owner) || null,
      email: cell(at.email).toLowerCase() || null,
      phone: cell(at.phone) || null,
      plan: cell(at.plan) || null,
      expires_at: isoDay(cell(at.expiry)),
      old_created_at: isoDay(cell(at.created)),
    })
  }
  return { rows, skipped }
}

export type LegacyState = 'active' | 'soon' | 'expired' | 'unknown'

/** Same words as the old board: expired, expiring within 7 days, active. */
export function legacyState(expires: string | null | undefined, today = new Date().toISOString().slice(0, 10)): LegacyState {
  if (!expires) return 'unknown'
  if (expires < today) return 'expired'
  const days = Math.round((Date.parse(expires) - Date.parse(today)) / 86_400_000)
  return days <= 7 ? 'soon' : 'active'
}

export function legacyDaysLeft(expires: string | null | undefined, today = new Date().toISOString().slice(0, 10)): number | null {
  if (!expires) return null
  return Math.max(0, Math.round((Date.parse(expires) - Date.parse(today)) / 86_400_000))
}

/** What to send an old-app studio so it moves over with its time. */
export function inviteMessage(s: Pick<LegacyStudio, 'owner_name' | 'studio_name' | 'email' | 'expires_at'>, appUrl = 'https://studioautopilot.in'): string {
  const hi = s.owner_name ? `Hi ${s.owner_name.split(' ')[0]}` : 'Hi'
  const until =
    s.expires_at && legacyState(s.expires_at) !== 'expired'
      ? ` Your access until ${new Date(`${s.expires_at}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} carries over.`
      : ''
  const mail = s.email ? ` with ${s.email}` : ''
  return `${hi}, IPC Studios has moved to Studio AutoPilot. Sign up at ${appUrl}${mail} and ${s.studio_name} is ready for you.${until}`
}
