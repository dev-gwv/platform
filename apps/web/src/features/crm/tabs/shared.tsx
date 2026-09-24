import type { ReactNode } from 'react'
import { Archive, Flame } from 'lucide-react'
import type { CrmLead, InboxColumn, LeadStatus, StageKind } from '@ipc/contracts'
import { stageLabel } from '@ipc/domain'
import { Card, CardContent } from '@/shared/ui/card'
import { formatINR } from '@/shared/ui/format'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState } from '@/shared/ui/states'
import { Avatar } from '@/shared/ui/avatar'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { dueBucket, isUncontacted } from '../leads'
import { downloadCsv, toCsv } from '@/shared/ui/csv'

export const SOURCE_TONE: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  facebook: 'info',
  webform: 'neutral',
  referral: 'success',
  manual: 'neutral',
  enquiry: 'warning',
}

export const STAGE_TONE: Record<LeadStatus, 'info' | 'success' | 'warning' | 'neutral' | 'danger'> = {
  new: 'info',
  contacted: 'neutral',
  qualified: 'warning',
  proposal_sent: 'warning',
  converted: 'success',
  lost: 'danger',
}

/** The badge tone for a stage by what it means, so a custom stage reads like the legacy one. */
export const stageTone = (kind: StageKind): 'info' | 'success' | 'danger' => (kind === 'won' ? 'success' : kind === 'lost' ? 'danger' : 'info')

/** The stage a deal shows: its own stage name when the pipeline has one, else the status. */
export const leadStageLabel = (l: CrmLead): string => stageLabel(l.status, l.stage_name)

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
export const prettyDate = (iso: string) => dayFormat.format(new Date(iso))

/** Today's date as the API wants it. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Never called, and it shows.
 *
 * Merging the enquiries list into this one (0168) only works if an unworked
 * lead is visible at a glance -- that was the whole argument for keeping them
 * apart. Privyr answers it with a label and a dot on the row, which is what
 * this is; `isUncontacted` has computed the state all along.
 */
export function UncontactedBadge({ lead }: { lead: CrmLead }) {
  if (!isUncontacted(lead)) return null
  return (
    <StatusBadge tone="info" className="gap-1.5">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      Uncontacted
    </StatusBadge>
  )
}

/** "Spoke 3 days ago", or that nobody has. */
export function lastTouch(lead: CrmLead): string {
  if (!lead.last_contacted_at) return 'Not contacted yet'
  const at = new Date(lead.last_contacted_at)
  if (Number.isNaN(at.getTime())) return 'Not contacted yet'
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000)
  if (days <= 0) return 'Spoke today'
  if (days === 1) return 'Spoke yesterday'
  if (days < 30) return `Spoke ${days} days ago`
  const months = Math.floor(days / 30)
  return `Spoke ${months} month${months === 1 ? '' : 's'} ago`
}

export function DueBadge({ lead, now }: { lead: CrmLead; now: Date }) {
  const bucket = dueBucket(lead, now)
  if (bucket === 'none') {
    return <span className="text-xs text-muted-foreground">No follow-up</span>
  }
  const tone = bucket === 'overdue' ? 'danger' : bucket === 'today' ? 'warning' : 'neutral'
  const label =
    bucket === 'overdue'
      ? `Overdue · ${prettyDate(lead.follow_up_at!)}`
      : bucket === 'today'
        ? 'Due today'
        : bucket === 'tomorrow'
          ? 'Tomorrow'
          : prettyDate(lead.follow_up_at!)
  return <StatusBadge tone={tone}>{label}</StatusBadge>
}

/** The score as a small badge; a flame once it reaches the studio's hot score. */
export function ScoreBadge({ score, hotScore = 60 }: { score: number; hotScore?: number }) {
  const hot = score >= hotScore
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[0.7rem] tabular-nums ${hot ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border text-muted-foreground'}`} title={`Score ${score}${hot ? ' · hot' : ''}`}>
      {hot && <Flame className="size-3" />}
      {score}
    </span>
  )
}

/** Every column the inbox can show. `lead` is always on — it carries the checkbox anchor. */
export const INBOX_COLUMNS: ReadonlyArray<{ key: InboxColumn; label: string }> = [
  { key: 'lead', label: 'Lead' },
  { key: 'stage', label: 'Stage' },
  { key: 'score', label: 'Score' },
  { key: 'source', label: 'Source' },
  { key: 'owner', label: 'Owner' },
  { key: 'value', label: 'Value' },
  { key: 'close', label: 'Close' },
  { key: 'company', label: 'Company' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'created', label: 'Created' },
]

export const DEFAULT_INBOX_COLUMNS: readonly InboxColumn[] = ['lead', 'stage', 'score', 'source', 'owner', 'value', 'follow_up']

export function LeadTable({
  leads,
  now,
  total,
  onOpen,
  selected,
  onToggleSelect,
  onToggleAll,
  hotScore = 60,
  columns = DEFAULT_INBOX_COLUMNS,
  density = 'comfortable',
}: {
  leads: readonly CrmLead[]
  now: Date
  total: number
  onOpen: (id: string) => void
  selected?: Set<string>
  onToggleSelect?: (id: string, on: boolean) => void
  onToggleAll?: (on: boolean) => void
  hotScore?: number
  columns?: readonly InboxColumn[]
  density?: 'comfortable' | 'compact'
}) {
  const isMobile = useIsMobile()

  if (leads.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState
            title={total === 0 ? 'No leads yet.' : 'No leads match these filters.'}
            description={
              total === 0
                ? 'Add one by hand, or connect a web form so they arrive on their own.'
                : 'Clear a filter or two to widen the list.'
            }
          />
        </CardContent>
      </Card>
    )
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {leads.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => onOpen(l.id)}
            className="rounded-lg border border-border bg-card p-4 text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="truncate font-medium">{l.name ?? l.phone ?? 'Unnamed lead'}</p>
              <StatusBadge tone={STAGE_TONE[l.status]}>{leadStageLabel(l)}</StatusBadge>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {l.phone ?? '—'}
              {l.deal_value !== null ? ` · ${formatINR(l.deal_value)}` : ''}
            </p>
            {l.notes && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{l.notes}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <UncontactedBadge lead={l} />
              {l.is_hot && (
                <StatusBadge tone="danger">
                  <Flame className="mr-1 size-3" /> Hot
                </StatusBadge>
              )}
              {l.is_archived && (
                <StatusBadge tone="neutral">
                  <Archive className="mr-1 size-3" /> Archived
                </StatusBadge>
              )}
              <DueBadge lead={l} now={now} />
            </div>
          </button>
        ))}
      </div>
    )
  }

  const allChecked = selected ? leads.length > 0 && leads.every((l) => selected.has(l.id)) : false
  // The lead column anchors the row (name + checkbox side), so it is always
  // first even when someone's saved order says otherwise.
  const cols = columns.includes('lead') ? columns : (['lead', ...columns] as readonly InboxColumn[])
  const pad = density === 'compact' ? 'px-3 py-1' : 'px-4 py-2'

  function header(key: InboxColumn) {
    const label = INBOX_COLUMNS.find((c) => c.key === key)?.label ?? key
    return (
      <th key={key} className={`${pad} font-medium ${key === 'lead' ? 'min-w-48' : ''} ${key === 'value' ? 'text-right' : ''}`}>
        {label}
      </th>
    )
  }

  function cell(key: InboxColumn, l: CrmLead) {
    switch (key) {
      case 'lead':
        return (
          <td key={key} className={pad}>
            <span className="flex items-center gap-2 font-medium">
              {l.is_hot && <Flame className="size-3.5 shrink-0 text-destructive" aria-label="Hot" />}
              {l.is_archived && <Archive className="size-3.5 shrink-0 text-muted-foreground" aria-label="Archived" />}
              {l.name ?? 'Unnamed lead'}
            </span>
            <span className="block text-xs text-muted-foreground">
              {l.phone ?? '—'}
              {l.crm_company_name ? ` · ${l.crm_company_name}` : ''}
            </span>
            {/*
              * What Privyr's row carries and ours did not: a line of the notes.
              * A list of names answers "who"; the question a studio actually
              * has open is "where are we with this one", and the note is the
              * answer far more often than the stage is.
              */}
            {l.notes && (
              <span className="mt-0.5 block max-w-xs truncate text-xs text-muted-foreground/80">{l.notes}</span>
            )}
            {/* When you last spoke to them. A list of names answers "who";
                this is half of "where are we", and it was on the record all
                along without ever reaching the screen. */}
            <span className="mt-0.5 block text-xs text-muted-foreground/70">{lastTouch(l)}</span>
          </td>
        )
      case 'stage':
        return (
          <td key={key} className={pad}>
            {isUncontacted(l) ? (
              <UncontactedBadge lead={l} />
            ) : (
              <StatusBadge tone={STAGE_TONE[l.status]}>{leadStageLabel(l)}</StatusBadge>
            )}
          </td>
        )
      case 'score':
        return (
          <td key={key} className={pad}>
            <ScoreBadge score={l.score} hotScore={hotScore} />
          </td>
        )
      case 'source':
        return (
          <td key={key} className={pad}>
            <StatusBadge tone={SOURCE_TONE[l.source] ?? 'neutral'}>{l.source}</StatusBadge>
          </td>
        )
      case 'owner':
        return (
          <td key={key} className={`${pad} text-muted-foreground`}>
            {l.assignee_name ? (
              <span className="flex items-center gap-2">
                <Avatar name={l.assignee_name} size="sm" />
                <span className="truncate">{l.assignee_name}</span>
              </span>
            ) : (
              <span className="text-warning">Unassigned</span>
            )}
          </td>
        )
      case 'value':
        return (
          <td key={key} className={`${pad} text-right tabular-nums text-muted-foreground`}>
            {l.deal_value !== null ? formatINR(l.deal_value) : '—'}
          </td>
        )
      case 'close':
        return <td key={key} className={`${pad} tabular-nums text-muted-foreground`}>{l.close_date ? prettyDate(l.close_date) : '—'}</td>
      case 'company':
        return <td key={key} className={`${pad} text-muted-foreground`}>{l.crm_company_name ?? '—'}</td>
      case 'follow_up':
        return (
          <td key={key} className={pad}>
            <DueBadge lead={l} now={now} />
          </td>
        )
      case 'created':
        return <td key={key} className={`${pad} tabular-nums text-muted-foreground`}>{prettyDate(l.created_at.slice(0, 10))}</td>
    }
  }

  return (
    <div className="table-wrap rounded-lg border border-border">
      <table className="table-sticky w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {selected && onToggleAll && (
              <th className="px-2 py-2">
                <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll(e.target.checked)} aria-label="Select all" />
              </th>
            )}
            {cols.map(header)}
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr
              key={l.id}
              onClick={() => onOpen(l.id)}
              className={`cursor-pointer border-t border-border hover:bg-muted/30 ${l.is_archived ? 'opacity-60' : ''}`}
            >
              {selected && onToggleSelect && (
                <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={(e) => onToggleSelect(l.id, e.target.checked)}
                    aria-label={`Select ${l.name ?? l.phone ?? 'lead'}`}
                  />
                </td>
              )}
              {cols.map((key) => cell(key, l))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LeadCard({ lead, onOpen }: { lead: CrmLead; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(lead.id)}
      className="rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent"
    >
      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
        {lead.is_hot && <Flame className="size-3 shrink-0 text-destructive" />}
        {lead.name ?? 'Unnamed lead'}
      </p>
      <p className="truncate text-xs text-muted-foreground">{lead.phone ?? '—'}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{lead.assignee_name ?? 'Unassigned'}</p>
    </button>
  )
}

export function BoardColumn({
  title,
  hint,
  count,
  tone,
  children,
}: {
  title: string
  hint?: string
  count: number
  tone: 'danger' | 'warning' | 'neutral' | 'info' | 'success'
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        <StatusBadge tone={tone}>{count}</StatusBadge>
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3 flex flex-col gap-2">
        {count === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Empty</p> : children}
      </div>
    </div>
  )
}

/**
 * Downloads the given leads as a spreadsheet-friendly CSV.
 *
 * Through the shared helper: this quoted correctly but wrote no BOM, so a
 * lead called Sharma with a rupee deal value opened in Excel as mojibake.
 */
export function exportLeadsCsv(leads: readonly CrmLead[], filename = 'leads.csv') {
  downloadCsv(
    filename,
    toCsv(
      ['Name', 'Phone', 'Email', 'Stage', 'Status', 'Source', 'Owner', 'Company', 'Title', 'Deal value', 'Probability', 'Close date', 'Lost reason', 'Follow up at', 'Created at'],
      leads.map((l) => [
        l.name ?? '', l.phone ?? '', l.email ?? '', leadStageLabel(l), l.status, l.source,
        l.assignee_name ?? '', l.crm_company_name ?? '', l.title ?? '', l.deal_value ?? '',
        l.probability ?? '', l.close_date ?? '', l.lost_reason ?? '', l.follow_up_at ?? '', l.created_at,
      ]),
    ),
  )
}
