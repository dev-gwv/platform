import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MessageCircle } from 'lucide-react'
import { CALL_OUTCOMES } from '@ipc/domain'
import type { CallQueueItem, CallQueueScope, CrmActivity } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useAuth } from '@/shared/auth/AuthProvider'
import { CallButton } from '@/features/crm-calls/CallButton'
import { useCallQueue } from '@/features/crm-calls/api'
import { useSendNow } from '@/features/crm-sequences/api'
import { MyDayStrip } from '@/features/crm-calls/MyDay'
import { EventTile } from '@/shared/ui/icon-tile'
import { ComingUpFollowUps, FollowUpActions, FollowUpTag, useOpenFollowUps } from '@/features/crm/FollowUpOnRow'
import { mergeFollowUps } from '@/features/crm/follow-ups'

export function CallQueuePage() {
  return (
    <AuthedPage module="crm">
      <CallQueue />
    </AuthedPage>
  )
}

const SEES_ALL = new Set(['super_admin', 'admin', 'manager', 'platform_admin'])

/** wa.me wants digits with the country code; a bare Indian number gets 91. */
const waLink = (phone: string) => {
  const d = phone.replace(/\D/g, '')
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}`
}

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Today's calls: the leads that are owed a call, most urgent first, each with
 * the reason in plain words. Call from the row, say how it went, and the list
 * reorders itself -- the day's work without deciding what to do next.
 */
function CallQueue() {
  const { session } = useAuth()
  const canSeeAll = SEES_ALL.has(session?.role ?? '')
  const [scope, setScope] = useState<CallQueueScope>('mine')
  const q = useCallQueue(scope)
  const items = q.data?.items ?? []
  const toSend = useSendNow().data?.items.length ?? 0
  const followUps = useOpenFollowUps(scope)
  // One list: a promised follow-up rides on its lead's call row, and only
  // the ones not owed a call today follow under Coming up.
  const { onRow, after } = useMemo(
    () => mergeFollowUps(items.map((l) => l.id), followUps.data ?? []),
    [items, followUps.data],
  )

  return (
    <>
      <PageHeader
        title="Today's calls"
        description={items.length ? `${items.length} ${items.length === 1 ? 'person' : 'people'} to call, most urgent first.` : undefined}
        actions={
          canSeeAll && (
            <div className="inline-flex rounded-full border border-border bg-muted p-0.5" role="radiogroup" aria-label="Whose calls">
              {(['mine', 'all'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={scope === s}
                  onClick={() => setScope(s)}
                  className={cn('rounded-full px-3 py-1 text-sm', scope === s ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')}
                >
                  {s === 'mine' ? 'Mine' : 'Everyone'}
                </button>
              ))}
            </div>
          )
        }
      />
      <MyDayStrip scope={scope} />
      {toSend > 0 && (
        <Link
          to="/follow-ups/send"
          className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-200"
        >
          <MessageCircle className="size-4" />
          {toSend} message{toSend === 1 ? '' : 's'} ready to send
          <span className="ml-auto">Open →</span>
        </Link>
      )}
      {q.isPending ? (
        <SkeletonList rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="All caught up"
            description="Nobody is owed a call right now. New enquiries and follow-ups will appear here."
            action={
              <Button variant="outline" asChild>
                <Link to="/follow-ups">Open leads</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {items.map((l) => (
              <Row key={l.id} lead={l} task={onRow.get(l.id)} showAssignee={scope === 'all'} />
            ))}
          </ul>
        </Card>
      )}
      {!q.isPending && !q.isError && <ComingUpFollowUps tasks={after} scope={scope} />}
    </>
  )
}

function Row({ lead, task, showAssignee }: { lead: CallQueueItem; task?: CrmActivity | undefined; showAssignee?: boolean | undefined }) {
  const urgent = lead.priority >= 100
  const last = lead.last_call_outcome ? CALL_OUTCOMES.find((o) => o.key === lead.last_call_outcome)?.label : null
  const what = [lead.event_type, lead.event_date ? fmtDate(lead.event_date) : null, lead.city].filter(Boolean).join(' · ')
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4">
      <EventTile name={lead.event_type} className="hidden sm:flex" />
      <div className="min-w-0 flex-1">
        <Link to="/follow-ups" search={{ lead: lead.id } as never} className="block truncate font-medium hover:underline">
          {lead.name || lead.phone || 'No name'}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className={cn('rounded-full px-2 py-0.5 font-medium', urgent ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
            {lead.reason}
          </span>
          {what && <span className="truncate">{what}</span>}
          {last && <span>Last call: {last}</span>}
          {task && <FollowUpTag task={task} showAssignee={showAssignee} />}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <CallButton lead={lead} variant="default" />
        <Button variant="outline" size="sm" disabled={!lead.phone} asChild={!!lead.phone}>
          {lead.phone ? (
            <a href={waLink(lead.phone)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${lead.name ?? ''}`.trim()}>
              <MessageCircle />
              <span className="hidden sm:inline">WhatsApp</span>
            </a>
          ) : (
            <span>
              <MessageCircle />
            </span>
          )}
        </Button>
        {task && <FollowUpActions task={task} />}
      </div>
    </li>
  )
}
