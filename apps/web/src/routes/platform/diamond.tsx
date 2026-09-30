import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bot, Gem, UserCheck } from 'lucide-react'
import { platformDiamondClaim, z, type DiamondClaimStatus, type PlatformDiamondClaim } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { useFileBlobUrl } from '@/shared/hooks/use-file-blob-url'

export function PlatformDiamondPage() {
  return (
    <PlatformPage>
      <Claims />
    </PlatformPage>
  )
}

const LABEL: Record<DiamondClaimStatus, string> = { pending: 'Waiting for you', approved: 'Approved', rejected: 'Not approved', revoked: 'Revoked' }
const TONE = { pending: 'warning', approved: 'success', rejected: 'neutral', revoked: 'danger' } as const
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const KEY = ['platform', 'diamond'] as const

/**
 * Every "I am an IPC Diamond member" screenshot, newest first: the studio, the
 * image, the group name Claude read off it, how it was decided, and the owner's
 * word on it. Approvals happen on their own; this is where a doubtful one is
 * revoked, and where a claim nobody could read waits.
 */
function Claims() {
  const { session } = useAuth()
  const [status, setStatus] = useState<DiamondClaimStatus | 'all'>('all')
  const q = useQuery({
    queryKey: [...KEY],
    queryFn: () => callApi('/platform/diamond', { responseSchema: platformDiamondClaim.array() }),
    enabled: !!session?.is_platform_admin,
  })
  const all = q.data ?? []
  const rows = status === 'all' ? all : all.filter((r) => r.status === status)
  const count = (s: DiamondClaimStatus) => all.filter((r) => r.status === s).length

  return (
    <>
      <PageHeader title="IPC Diamond claims" description="Studios that sent a screenshot of the IPC Diamonds - Premium group." />
      <FilterTabs
        value={status}
        onChange={(v) => setStatus(v)}
        tabs={[
          { value: 'all', label: 'All', count: all.length },
          { value: 'pending', label: 'Waiting for you', count: count('pending') },
          { value: 'approved', label: 'Approved', count: count('approved') },
          { value: 'rejected', label: 'Not approved', count: count('rejected') },
          { value: 'revoked', label: 'Revoked', count: count('revoked') },
        ]}
      />
      <div className="mt-4 flex flex-col gap-3">
        {q.isLoading ? (
          <SkeletonList rows={3} />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No claims here" description="When a studio sends a screenshot, it shows up here." />
        ) : (
          rows.map((r) => <ClaimCard key={r.id} claim={r} />)
        )}
      </div>
    </>
  )
}

function ClaimCard({ claim: r }: { claim: PlatformDiamondClaim }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const shot = useFileBlobUrl(r.file_id, true, `/platform/diamond/${r.id}/file`)
  const [big, setBig] = useState(false)
  const done = () => void qc.invalidateQueries({ queryKey: KEY })

  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      callApi(`/platform/diamond/${r.id}/decide`, { method: 'POST', body: { approve }, responseSchema: z.any() }),
    onSuccess: (_, approve) => {
      toast.success(approve ? `${r.company_name} is now an IPC Diamond member` : 'Marked as not approved')
      done()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const revoke = useMutation({
    mutationFn: () =>
      callApi(`/platform/studios/${r.company_id}/diamond/revoke`, { method: 'POST', body: {}, responseSchema: z.any() }),
    onSuccess: () => {
      toast.success(`${r.company_name} is back on the 7-day trial and the public price`)
      done()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function onRevoke() {
    const yes = await confirm({
      title: `Revoke ${r.company_name}?`,
      description: 'They go back to the 7-day trial (from when they signed up) and the ₹1,00,000 price. A plan they have paid for is not touched.',
      confirmLabel: 'Revoke',
      destructive: true,
    })
    if (yes) revoke.mutate()
  }

  const auto = r.decided_by === 'auto'
  const title = r.reading?.group_title ?? null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
        <button
          type="button"
          onClick={() => setBig((b) => !b)}
          className={
            big
              ? 'w-full overflow-hidden rounded-lg border border-border bg-muted sm:w-96'
              : 'h-40 w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted sm:w-40'
          }
          aria-label="Show the screenshot larger"
        >
          {shot.url ? (
            <img src={shot.url} alt={`Screenshot from ${r.company_name}`} className={big ? 'w-full' : 'size-full object-cover object-top'} />
          ) : (
            <span className="text-xs text-muted-foreground">{shot.error ? 'Could not load' : 'Loading…'}</span>
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{r.company_name}</p>
            <StatusBadge tone={TONE[r.status]}>{LABEL[r.status]}</StatusBadge>
            {r.member_tier === 'diamond' && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-tone-violet">
                <Gem className="size-3.5" aria-hidden /> Member now
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {r.owner_email ?? 'No owner email'} · sent {when(r.created_at)}
          </p>
          {r.reading && (
            <p className="text-sm">
              Group name read: <strong>{title ? `“${title}”` : 'nothing readable'}</strong>
            </p>
          )}
          {r.decided_at && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {auto ? <Bot className="size-3.5" aria-hidden /> : <UserCheck className="size-3.5" aria-hidden />}
              {auto ? 'Decided automatically' : 'Decided by you'} · {when(r.decided_at)}
              {r.reason ? ` · ${r.reason}` : ''}
            </p>
          )}
          {!r.decided_at && r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}

          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            {(r.status === 'pending' || r.status === 'rejected') && (
              <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
                Approve
              </Button>
            )}
            {r.status === 'pending' && (
              <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
                Not approved
              </Button>
            )}
            {r.status === 'approved' && r.member_tier === 'diamond' && (
              <Button size="sm" variant="outline" className="text-destructive" disabled={revoke.isPending} onClick={() => void onRevoke()}>
                Revoke
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
