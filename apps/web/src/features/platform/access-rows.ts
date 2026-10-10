import type { LegacyStudio, PlatformStudio } from '@ipc/contracts'
import { legacyDaysLeft, legacyState } from './legacy'

/**
 * The Studio Access Manager's one list (owner, 4 Oct: "as it was on the old
 * app"): every studio on the new app, and the old app's subscribers who have
 * not joined yet, as the same kind of row -- studio, owner, email, phone,
 * created, status, expires, days left.
 */
export type AccessStatus = 'active' | 'trial' | 'soon' | 'expired' | 'unknown'

export interface AccessRow {
  key: string
  kind: 'new' | 'old'
  name: string
  owner: string | null
  email: string | null
  phone: string | null
  created: string | null
  status: AccessStatus
  expires: string | null
  daysLeft: number | null
  plan: string | null
  diamond: boolean
  studio?: PlatformStudio
  legacy?: LegacyStudio
}

export const STATUS_LABEL: Record<AccessStatus, string> = {
  active: 'Active',
  trial: 'Free trial',
  soon: 'Expiring soon',
  expired: 'Expired',
  unknown: 'No date',
}

const DAY = 86_400_000

/** When a new-app studio's access ends: the paid plan, else the trial, else grace (0210). */
export const endsOf = (s: PlatformStudio): string | null => s.access_until ?? s.plan_expiry

function daysLeftOf(s: PlatformStudio, now = Date.now()): number | null {
  const end = endsOf(s)
  return end ? Math.max(0, Math.ceil((new Date(end).getTime() - now) / DAY)) : (s.days_remaining ?? null)
}

export function statusOf(s: PlatformStudio, now = Date.now()): AccessStatus {
  if (s.plan_gate === 'expired') return 'expired'
  const d = daysLeftOf(s, now)
  if (d != null && d <= 7) return 'soon'
  // Open access that ends within two months is a trial (7 days, or 30 for a Diamond member).
  if (s.plan_gate === 'grandfathered' && (d ?? 999) <= 60) return 'trial'
  return 'active'
}

export function toRows(studios: PlatformStudio[], legacy: LegacyStudio[], now = Date.now()): AccessRow[] {
  const today = new Date(now).toISOString().slice(0, 10)
  const fresh: AccessRow[] = studios.map((s) => ({
    key: `new:${s.id}`,
    kind: 'new',
    name: s.name,
    owner: s.owner_name ?? null,
    email: s.owner_email,
    phone: s.owner_phone ?? null,
    created: s.created_at,
    status: statusOf(s, now),
    expires: endsOf(s),
    daysLeft: s.plan_gate === 'expired' ? 0 : daysLeftOf(s, now),
    plan: s.plan_key ?? null,
    diamond: s.member_tier === 'diamond',
    studio: s,
  }))
  const old: AccessRow[] = legacy
    .filter((l) => !l.joined_company_id)
    .map((l) => {
      const st = legacyState(l.expires_at, today)
      return {
        key: `old:${l.id}`,
        kind: 'old' as const,
        name: l.studio_name,
        owner: l.owner_name,
        email: l.email,
        phone: l.phone,
        created: l.old_created_at,
        status: st,
        expires: l.expires_at ? `${l.expires_at}T00:00:00` : null,
        daysLeft: st === 'expired' ? 0 : legacyDaysLeft(l.expires_at, today),
        plan: l.plan,
        diamond: false,
        legacy: l,
      }
    })
  return [...fresh, ...old]
}

/**
 * "Extend 30 days": from when access ends now, or from today once it has
 * ended -- the date it lands on, as yyyy-mm-dd.
 */
export function extendFrom(end: string | null, days: number, now = new Date()): string {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const base = end && new Date(end).getTime() > now.getTime() ? new Date(end) : today
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const nice = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** "Copy access message": where the studio stands, ready for WhatsApp. */
export function accessMessage(r: Pick<AccessRow, 'owner' | 'name' | 'status' | 'expires' | 'daysLeft'>, appUrl = 'https://studioautopilot.in'): string {
  const hi = r.owner?.trim() ? `Hi ${r.owner.trim().split(/\s+/)[0]}` : 'Hi'
  if (r.status === 'expired') {
    return `${hi}, your Studio AutoPilot access for ${r.name} has ended${r.expires ? ` (${nice(r.expires)})` : ''}. Renew to pick up where you left off: ${appUrl}`
  }
  const left = r.daysLeft != null ? ` · ${r.daysLeft} ${r.daysLeft === 1 ? 'day' : 'days'} left` : ''
  return `${hi}, your Studio AutoPilot access for ${r.name} is active${r.expires ? ` until ${nice(r.expires)}` : ''}${left}. Sign in: ${appUrl}`
}
