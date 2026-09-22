import { useState } from 'react'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/input'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { SkeletonList } from '@/shared/ui/skeleton'
import { useActivityLog } from '@/features/activity/api'
import { humanize } from '@/shared/ui/format'

// The value on the right must match entityType exactly as audit() logs it
// server-side (services/api/src/modules/**/*.ts) — a mismatch here (as
// 'employee' once was, for what is actually logged as 'user') makes a filter
// silently return nothing instead of erroring.
const ENTITY_FILTERS = [
  ['', 'Everything'],
  ['crm_lead', 'Deals'],
  ['crm_contact', 'Contacts'],
  ['crm_company', 'Companies'],
  ['crm_quote', 'Quotes'],
  ['client', 'Clients'],
  ['project', 'Projects'],
  ['shoot', 'Shoots'],
  ['task', 'Tasks'],
  ['invoice', 'Invoices'],
  ['expense', 'Company expenses'],
  ['personal_expense', 'Personal expenses'],
  ['party', 'Vendors / parties'],
  ['shoot_data_record', 'Data records'],
  ['work_submission', 'Work submissions'],
  ['user', 'Team members'],
  ['user_invitation', 'Invitations'],
  ['team_payout', 'Payouts'],
  ['reminder', 'Reminders'],
  ['company', 'Company'],
] as const

const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function ActionBadge({ action }: { action: string }) {
  const tone = action.includes('create') ? 'success' : action.includes('delete') ? 'danger' : 'neutral'
  return <StatusBadge tone={tone}>{humanize(action.replace('.', ' '))}</StatusBadge>
}

export function ActivityPage() {
  return (
    <AuthedPage module="dashboard">
      <ActivityContent />
    </AuthedPage>
  )
}

function ActivityContent() {
  const [entityFilter, setEntityFilter] = useState('')
  const q = useActivityLog(entityFilter ? { entity_type: entityFilter } : undefined)
  const items = q.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity Log"
        description="See who did what, when — a lightweight trail of actions across the studio."
      />

      <Card>
        <CardContent className="p-4 sm:p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold tracking-tight">Recent Activity</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Newest actions first. Filter by area to narrow the trail.
              </p>
            </div>
            <Select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="w-44">
              {ENTITY_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>

          <div className="mt-4">
            {q.isLoading ? (
              <SkeletonList rows={6} columns={4} />
            ) : q.isError ? (
              <ErrorState error={q.error} onRetry={() => void q.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState title="No activity yet" description="Actions performed across the studio will appear here." />
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <span className="w-40 shrink-0 text-muted-foreground">
                      {when.format(new Date(item.created_at))}
                    </span>
                    <span className="font-medium">{item.user_name ?? 'System'}</span>
                    <ActionBadge action={item.action} />
                    <span className="text-muted-foreground">{humanize(item.entity_type)}</span>
                    {item.entity_id && (
                      <span className="font-mono text-xs text-muted-foreground">#{item.entity_id.slice(0, 8)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {q.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage ? 'Loading...' : 'Show older'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
