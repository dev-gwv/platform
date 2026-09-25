import { ExternalLink, FileCheck, Folder, HardDrive, Package } from 'lucide-react'
import { WORK_STATUS_LABEL, type WorkSubmission } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useProjectWorkSubmissions } from '@/features/work/api'
import { ReviewButtons } from '@/features/work/ReviewButtons'

const TONE: Record<WorkSubmission['status'], 'warning' | 'success' | 'danger'> = {
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
  sent: 'success',
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/**
 * Work the team handed in for this project. What is waiting for a decision
 * comes first, each with Approve or Send back for changes (which needs a line
 * saying what to change); everything already decided sits underneath as the
 * record.
 */
export function CompletedWorkTab({ projectId, canReview }: { projectId: string; canReview: boolean }) {
  const { data, isLoading, isError, refetch } = useProjectWorkSubmissions(projectId)

  if (isLoading) return <SkeletonList rows={3} columns={3} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  const all = data ?? []
  const waiting = all.filter((s) => s.status === 'submitted')
  const rest = all.filter((s) => s.status !== 'submitted')

  if (all.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
          <FileCheck className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Nothing handed in yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            When someone on the team finishes their part, they submit it from My Work. It lands here for you to check.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">
          {waiting.length > 0 ? `Waiting for your review (${waiting.length})` : 'Nothing waiting for review'}
        </h2>
        {waiting.map((s) => (
          <Submission key={s.id} s={s} canReview={canReview} />
        ))}
      </section>

      {rest.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Already reviewed ({rest.length})</h2>
          {rest.map((s) => (
            <Submission key={s.id} s={s} canReview={false} />
          ))}
        </section>
      )}
    </div>
  )
}

function Submission({ s, canReview }: { s: WorkSubmission; canReview: boolean }) {
  const where = s.disk_name ?? s.hard_disk_label

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {s.title ?? s.deliverable_title ?? 'Untitled work'}
              {s.version > 1 && <span className="ml-1 text-xs text-muted-foreground">· version {s.version}</span>}
            </p>
            {s.deliverable_id && s.project_id && (
              // Approving or sending back moves that deliverable too.
              <a
                href={`/projects/${s.project_id}?tab=deliverables&d=${s.deliverable_id}`}
                className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-tone-violet-soft px-2 py-0.5 text-[11px] font-semibold text-tone-violet hover:underline"
              >
                <Package className="size-3" aria-hidden /> {s.title ? `For ${s.deliverable_title ?? 'a deliverable'}` : 'Open the deliverable'}
              </a>
            )}
            <p className="text-xs text-muted-foreground">
              {[s.submitted_by_name && `From ${s.submitted_by_name}`, day(s.created_at), s.work_type].filter(Boolean).join(' · ')}
            </p>
          </div>
          <StatusBadge tone={TONE[s.status]}>{WORK_STATUS_LABEL[s.status]}</StatusBadge>
        </div>

        {/* Where the work is: a link, or the drive and folder it sits on. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {s.submission_link && /^https?:\/\//i.test(s.submission_link) && (
            <a href={s.submission_link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <ExternalLink className="size-3.5" aria-hidden /> Open the work
            </a>
          )}
          {where && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <HardDrive className="size-3.5" aria-hidden />
              {where}
              {s.disk_location ? ` · ${s.disk_location}` : ''}
            </span>
          )}
          {s.folder_path && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Folder className="size-3.5" aria-hidden />
              {s.folder_path}
            </span>
          )}
        </div>

        {s.notes && <p className="text-sm text-muted-foreground">“{s.notes}”</p>}
        {s.review_notes && s.status === 'rejected' && <p className="text-sm text-destructive">What to change: {s.review_notes}</p>}

        {canReview && <ReviewButtons submissionId={s.id} editorName={s.submitted_by_name} />}
      </CardContent>
    </Card>
  )
}
