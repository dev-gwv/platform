import { useState } from 'react'
import { MapPin } from 'lucide-react'
import type { FeatureRequest, FeatureRequestStatus } from '@ipc/contracts'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Card, CardContent } from '@/shared/ui/card'
import { Select, Textarea } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Avatar } from '@/shared/ui/avatar'
import { useFileBlobUrl } from '@/shared/hooks/use-file-blob-url'
import { VoiceNotePlayer } from '@/features/projects/VoiceNotePlayer'
import { usePlatformFeedback, useUpdateFeedback } from '@/features/feedback/api'

export function PlatformFeedbackPage() {
  return (
    <PlatformPage>
      <Inbox />
    </PlatformPage>
  )
}

const STATUS_LABEL: Record<FeatureRequestStatus, string> = { new: 'New', planned: 'Planned', done: 'Done', declined: 'Not now' }
const STATUS_TONE = { new: 'warning', planned: 'info', done: 'success', declined: 'neutral' } as const

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Every studio's "Suggest a feature", newest first: who, where they were in
 * the app, what they said -- in words, a voice note or a screenshot -- and
 * what we decided.
 */
function Inbox() {
  const [status, setStatus] = useState<FeatureRequestStatus | 'all'>('new')
  const q = usePlatformFeedback(status === 'all' ? null : status)
  const all = usePlatformFeedback(null)
  const count = (s: FeatureRequestStatus) => (all.data ?? []).filter((r) => r.status === s).length

  return (
    <>
      <PageHeader title="Feature suggestions" description="From the “Suggest a feature · सुझाव दें” button, in every studio." />
      <FilterTabs
        value={status}
        onChange={(v) => setStatus(v)}
        tabs={[
          { value: 'new', label: 'New', count: count('new') },
          { value: 'planned', label: 'Planned', count: count('planned') },
          { value: 'done', label: 'Done', count: count('done') },
          { value: 'declined', label: 'Not now', count: count('declined') },
          { value: 'all', label: 'All', count: all.data?.length ?? 0 },
        ]}
      />
      <div className="mt-4">
        {q.isLoading ? (
          <SkeletonList rows={4} />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title="Nothing here" description="Suggestions from studios show up here as they arrive." />
        ) : (
          <div className="flex flex-col gap-3">
            {q.data.map((r) => (
              <Suggestion key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function Suggestion({ r }: { r: FeatureRequest }) {
  const update = useUpdateFeedback()
  const [note, setNote] = useState(r.admin_note ?? '')
  const [big, setBig] = useState(false)
  const shot = useFileBlobUrl(r.screenshot_file_id, !!r.screenshot_file_id, r.screenshot_file_id ? `/platform/feedback/${r.id}/files/${r.screenshot_file_id}` : undefined)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <Avatar name={r.user_name ?? '?'} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {r.user_name ?? 'Someone'} <span className="font-normal text-muted-foreground">at</span> {r.company_name ?? 'a studio'}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {when(r.created_at)}
              {r.user_email && <span>· {r.user_email}</span>}
              {r.page_url && (
                <span className="inline-flex items-center gap-1">
                  · <MapPin className="size-3" aria-hidden /> {r.page_url}
                </span>
              )}
            </p>
          </div>
          <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
        </div>

        {r.body && <p className="whitespace-pre-wrap text-sm">{r.body}</p>}
        {r.voice_file_id && (
          <div className="max-w-sm">
            <VoiceNotePlayer fileId={r.voice_file_id} path={`/platform/feedback/${r.id}/files/${r.voice_file_id}`} seconds={r.voice_seconds} />
          </div>
        )}
        {r.screenshot_file_id &&
          (shot.url ? (
            <button type="button" onClick={() => setBig((b) => !b)} className="overflow-hidden rounded-lg border border-border bg-muted text-left">
              <img src={shot.url} alt="Screenshot sent with the suggestion" className={big ? 'w-full' : 'max-h-56 w-full object-contain'} />
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">{shot.error ? 'The screenshot could not be loaded.' : 'Loading the screenshot…'}</p>
          ))}

        <div className="flex flex-wrap items-start gap-2 border-t border-border pt-3">
          <Select
            aria-label="Status"
            value={r.status}
            onChange={(e) => update.mutate({ id: r.id, status: e.target.value as FeatureRequestStatus })}
            className="w-40"
          >
            {(Object.keys(STATUS_LABEL) as FeatureRequestStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Textarea
            rows={1}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (r.admin_note ?? '') && update.mutate({ id: r.id, admin_note: note })}
            placeholder="Our note (only we see it)"
            aria-label="Our note"
            className="min-h-9 flex-1 text-sm"
          />
        </div>
      </CardContent>
    </Card>
  )
}
