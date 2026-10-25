import type { MyLead } from '@ipc/contracts'
import { followUpBucket } from '@/features/crm/follow-ups'

/**
 * A team member's leads, sorted into what to do (0282): late follow-ups
 * first, then today's, then the rest; booked and lost leads apart.
 */

export type MyLeadsTab = 'todo' | 'all' | 'closed'

export const isClosed = (l: Pick<MyLead, 'status'>) => l.status === 'lost' || l.status === 'converted'

export type MyLeadState = 'late' | 'today' | 'soon' | 'none' | 'closed'

export function leadState(l: Pick<MyLead, 'status' | 'follow_up_at'>, now: Date = new Date()): MyLeadState {
  if (isClosed(l)) return 'closed'
  if (!l.follow_up_at) return 'none'
  const b = followUpBucket(l.follow_up_at, now)
  return b === 'overdue' ? 'late' : b === 'today' ? 'today' : 'soon'
}

/** "8 leads given to you · 2 late · 3 today", in one sentence. */
export function myLeadsSentence(leads: readonly MyLead[], now: Date = new Date()): string {
  const open = leads.filter((l) => !isClosed(l))
  if (!leads.length) return 'No leads given to you yet.'
  const late = open.filter((l) => leadState(l, now) === 'late').length
  const today = open.filter((l) => leadState(l, now) === 'today').length
  const none = open.filter((l) => leadState(l, now) === 'none').length
  return [
    `${open.length} open ${open.length === 1 ? 'lead' : 'leads'} given to you`,
    late ? `${late} late` : null,
    today ? `${today} to follow up today` : null,
    none ? `${none} with no follow-up set` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The leads a tab shows, in the order to work them. */
export function myLeadsFor(tab: MyLeadsTab, leads: readonly MyLead[], search: string, now: Date = new Date()): MyLead[] {
  const w = search.trim().toLowerCase()
  const digits = w.replace(/\D/g, '')
  const rank: Record<MyLeadState, number> = { late: 0, today: 1, none: 2, soon: 3, closed: 4 }
  return leads
    .filter((l) => (tab === 'closed' ? isClosed(l) : tab === 'todo' ? !isClosed(l) && leadState(l, now) !== 'soon' : !isClosed(l)))
    .filter((l) => {
      if (!w) return true
      if (digits.length >= 4 && (l.phone ?? '').replace(/\D/g, '').includes(digits)) return true
      return [l.name, l.city, l.event_type, l.partner_name, l.enquiry_occasion].some((x) => (x ?? '').toLowerCase().includes(w))
    })
    .sort((a, b) => {
      const r = rank[leadState(a, now)] - rank[leadState(b, now)]
      if (r) return r
      return (a.follow_up_at ?? '9').localeCompare(b.follow_up_at ?? '9') || b.created_at.localeCompare(a.created_at)
    })
}
