import { Link } from '@tanstack/react-router'
import { Database, Plus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { humanize } from '@/shared/ui/format'
import { useProjectDataRecords, useVerifyData } from '@/features/data/api'
import { TRACK_LABEL, TRACK_TONE } from '@/features/data/stage'


/** This project's own shoot data records — a real tab instead of a link away to the global page. */
export function DataTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { data, isLoading, isError, refetch } = useProjectDataRecords(projectId)
  const verify = useVerifyData()

  /**
   * Where this project's footage has got to, in six numbers. A list of cards
   * answers "what did we shoot"; the question actually being asked here is
   * "is any of it still in one place only".
   */
  const rows = data ?? []
  const stats = {
    total: rows.length,
    pending: rows.filter((r) => r.primary_status === 'pending').length,
    copied: rows.filter((r) => r.primary_status !== 'pending').length,
    backupPending: rows.filter((r) => r.backup_status !== 'verified' && r.backup_status !== 'not_required').length,
    backupDone: rows.filter((r) => r.backup_status === 'verified' || r.backup_status === 'not_required').length,
    issues: rows.filter((r) => r.issue_found).length,
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground">Data for this project</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Where every card and drive from this project&apos;s shoots has got to.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/data-management">
            <Plus /> Add record
          </Link>
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Figure label="Records" value={stats.total} />
          <Figure label="Not copied" value={stats.pending} tone={stats.pending > 0 ? 'warning' : undefined} />
          <Figure label="Copied" value={stats.copied} />
          <Figure
            label="Backup pending"
            value={stats.backupPending}
            tone={stats.backupPending > 0 ? 'warning' : undefined}
          />
          <Figure label="Backup done" value={stats.backupDone} tone={stats.backupDone > 0 ? 'success' : undefined} />
          <Figure label="Issues" value={stats.issues} tone={stats.issues > 0 ? 'danger' : undefined} />
        </div>
      )}

      {isLoading ? (
        <SkeletonList rows={3} columns={4} />
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No data recorded"
          description="Track each card or drive's primary and backup copy status here."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/data-management">
                <Plus /> Add record
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((d) => (
            <li key={d.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <Database className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 font-medium">{d.data_label}</span>
                  <span className="text-xs text-muted-foreground">{d.data_type ?? '—'}</span>
                  <span className="text-xs text-muted-foreground">{d.size_gb} GB</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Primary</span>
                    {canEdit && d.primary_status !== 'verified' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verify.isPending}
                        onClick={() => verify.mutate({ id: d.id, track: 'primary' })}
                      >
                        {humanize(d.primary_status)} — verify
                      </Button>
                    ) : (
                      <StatusBadge tone={TRACK_TONE[d.primary_status]}>{TRACK_LABEL[d.primary_status]}</StatusBadge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Backup</span>
                    {canEdit && d.backup_status !== 'verified' && d.backup_status !== 'not_required' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={verify.isPending}
                        onClick={() => verify.mutate({ id: d.id, track: 'backup' })}
                      >
                        {humanize(d.backup_status)} — verify
                      </Button>
                    ) : (
                      <StatusBadge tone={TRACK_TONE[d.backup_status]}>{TRACK_LABEL[d.backup_status]}</StatusBadge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One figure in the strip: a number over a caption, coloured when it matters. */
function Figure({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'warning' | 'success' | 'danger' | undefined
}) {
  const colour =
    tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-destructive' : tone === 'success' ? 'text-success' : ''
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className={`text-lg font-semibold tabular-nums ${colour}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
