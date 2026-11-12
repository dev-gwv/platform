import { crmLead, type CrmLead, type CrmLeadCard, type LeadOutcome } from '@ipc/contracts'

export interface LeadsOptions {
  /** open = still being worked; won / lost / all. Absent = every live lead, as before. */
  outcome?: LeadOutcome
  /** Archived ones too ("Show archived"). */
  includeArchived?: boolean
  /** false = do not fetch yet (a tab nobody opened). */
  enabled?: boolean
  /** At most this many, newest first (the server's default is 2,000). */
  limit?: number
}

/** The address of a lead list: the full lead, or the slim card (`shape=card`). */
export function leadsPath(shape: 'card' | 'full', o: LeadsOptions): string {
  const qs = new URLSearchParams()
  if (o.outcome) qs.set('outcome', o.outcome)
  if (shape === 'card') qs.set('shape', 'card')
  if (o.includeArchived) qs.set('include_archived', '1')
  if (o.limit) qs.set('limit', String(o.limit))
  const s = qs.toString()
  return `/crm/leads${s ? `?${s}` : ''}`
}

/** A card shown as a lead until the whole one lands; undefined when it will not parse. */
export function placeholderLead(card: CrmLeadCard | CrmLead): CrmLead | undefined {
  if ('notes' in card) return card
  const rest: Record<string, unknown> = { ...card }
  delete rest.notes_preview
  const parsed = crmLead.safeParse({ ...rest, notes: null })
  return parsed.success ? parsed.data : undefined
}

