import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bot, Gem, UserCheck } from 'lucide-react'
import { diamondLookup, diamondMiss, diamondSheetStatus, platformDiamondClaim, z, type DiamondClaimStatus, type DiamondLookup, type DiamondMiss, type DiamondSheetStatus, type PlatformDiamondClaim } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Card, CardContent } from '@/shared/ui/card'
import { SkeletonList } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useConfirm } from '@/shared/ui/confirm'
import { useFileBlobUrl } from '@/shared/hooks/use-file-blob-url'

export function PlatformDiamondPage() {
  return (
    <PlatformPage>
      <MemberSheet />
      <Misses />
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
      <h2 className="mb-2 mt-8 text-base font-semibold">Older screenshot claims</h2>
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

/**
 * The IPC Diamond member list (0262): the platform owner's Google Sheet. Paste
 * its link once; the app copies the phone numbers in now and every hour, and an
 * owner who types a listed number gets member prices and 30 days. Below, the
 * studios verified that way, newest first.
 */
function MemberSheet() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const key = ['platform', 'diamond', 'sheet'] as const
  const status = useQuery({
    queryKey: key,
    queryFn: () => callApi('/platform/diamond/sheet', { responseSchema: diamondSheetStatus }),
    enabled: !!session?.is_platform_admin,
  })
  const [value, setValue] = useState<string | null>(null)
  const shown = value ?? status.data?.url ?? ''
  const done = (r: DiamondSheetStatus) => {
    qc.setQueryData(key, r)
    setValue(null)
    if (r.error) toast.error(r.error)
    else if (r.url) toast.success(`Member list copied: ${r.rows ?? 0} numbers.`)
  }
  const save = useMutation({
    mutationFn: () => callApi('/platform/diamond/sheet', { method: 'PUT', body: { url: shown.trim() || null }, responseSchema: diamondSheetStatus }),
    onSuccess: done,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save.'),
  })
  const refresh = useMutation({
    mutationFn: () => callApi('/platform/diamond/sheet/refresh', { method: 'POST', responseSchema: diamondSheetStatus }),
    onSuccess: done,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not refresh.'),
  })
  const s = status.data
  return (
    <>
      <PageHeader title="IPC Diamond members" />
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div>
            <p className="text-sm font-semibold">Member list (Google Sheet)</p>
            <p className="text-xs text-muted-foreground">
              Paste the sheet's link (shared as "Anyone with the link can view") or its "Publish to the web" link. Any
              column of mobile numbers is read, again every hour.
            </p>
          </div>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate()
            }}
          >
            <Input
              value={shown}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className={shown ? 'max-w-xl border-success/50' : 'max-w-xl border-tone-amber/60'}
              aria-label="Google Sheet link"
            />
            <Button type="submit" disabled={save.isPending || value === null}>
              {save.isPending ? 'Reading the sheet…' : 'Save and read'}
            </Button>
            {s?.url && (
              <Button type="button" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                {refresh.isPending ? 'Reading…' : 'Refresh now'}
              </Button>
            )}
          </form>
          {s?.url && (
            <p className={s.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {s.error
                ? s.error
                : s.synced_at
                  ? `${s.rows ?? 0} member numbers, last read ${when(s.synced_at)}.`
                  : 'Not read yet.'}
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardContent className="p-4">
          <p className="text-sm font-semibold">Verified by number</p>
          {!s || s.verified.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No studio has checked a number yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {s.verified.map((v) => (
                <li key={v.company_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-medium">{v.studio}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {v.phone ? `•••••${v.phone.slice(-5)}` : ''}
                    {v.verified_at ? ` · ${when(v.verified_at)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}

/**
 * Members said the check refused their number (owner, 20 Oct). Here the
 * platform owner looks any number up against the copied list, sees every
 * number studios typed that did not match in the last 30 days and why, and
 * makes a studio a member by hand when the list was wrong (0277).
 */
function Misses() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const misses = useQuery({
    queryKey: ['platform', 'diamond', 'misses'],
    queryFn: () => callApi('/platform/diamond/misses', { responseSchema: diamondMiss.array() }),
    enabled: !!session?.is_platform_admin,
  })
  const [phone, setPhone] = useState('')
  const [found, setFound] = useState<DiamondLookup | null>(null)
  const lookup = useMutation({
    mutationFn: () =>
      callApi(`/platform/diamond/lookup?phone=${encodeURIComponent(phone)}`, { responseSchema: diamondLookup }),
    onSuccess: setFound,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not look that up.'),
  })
  const grant = useMutation({
    mutationFn: (m: DiamondMiss) =>
      callApi(`/platform/studios/${m.company_id}/diamond/grant`, { method: 'POST', body: { phone: m.phone }, responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: (_r, m) => {
      toast.success(`${m.studio} is an IPC Diamond member now.`)
      void qc.invalidateQueries({ queryKey: ['platform', 'diamond'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not do that.'),
  })
  const onGrant = async (m: DiamondMiss) => {
    const ok = await confirm({
      title: `Make ${m.studio} a Diamond member?`,
      description: 'They get the member prices and 30 days from sign-up, the same as a number that matches.',
      confirmLabel: 'Make member',
    })
    if (ok) grant.mutate(m)
  }
  const digits = phone.replace(/[^0-9]/g, '').length
  const rows = misses.data ?? []

  return (
    <Card className="mt-4">
      <CardContent className="flex flex-col gap-4 p-4">
        <div>
          <p className="text-sm font-semibold">Check a number</p>
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (digits >= 10) lookup.mutate()
            }}
          >
            <Input
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                setFound(null)
              }}
              inputMode="tel"
              placeholder="98765 43210"
              aria-label="Mobile number to check"
              className={digits >= 10 ? 'max-w-xs border-success/50' : 'max-w-xs border-tone-amber/60'}
            />
            <Button type="submit" variant="outline" disabled={digits < 10 || lookup.isPending}>
              {lookup.isPending ? 'Checking…' : 'Check'}
            </Button>
          </form>
          {found && (
            <p className={found.on_list ? 'mt-2 text-sm text-success' : 'mt-2 text-sm text-destructive'}>
              {found.on_list
                ? `On the list${found.name ? ` as ${found.name}` : ''}. ${found.studio ? `It opened ${found.studio}.` : 'No studio has used it yet.'}`
                : 'Not on the copied list. Add it to the sheet, then press Refresh now above.'}
            </p>
          )}
        </div>

        <div>
          <p className="text-sm font-semibold">Numbers that did not match</p>
          {misses.isLoading ? (
            <SkeletonList rows={2} />
          ) : misses.isError ? (
            <ErrorState onRetry={() => void misses.refetch()} />
          ) : rows.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No studio has been refused in the last 30 days.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {rows.map((m) => (
                <li key={`${m.company_id}-${m.phone}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block font-medium">{m.studio}</span>
                    <span className="block text-xs text-muted-foreground">
                      {m.phone ?? 'no number'} · {missWhy(m)} · {m.tries === 1 ? 'once' : `${m.tries} times`}, last {when(m.last_at)}
                      {m.owner_email ? ` · ${m.owner_email}` : ''}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" disabled={grant.isPending} onClick={() => void onGrant(m)}>
                    <Gem aria-hidden /> Make member
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Why a typed number missed, in a few words; the list may have changed since. */
function missWhy(m: DiamondMiss): string {
  if (m.why === 'taken') return m.used_by ? `already opened ${m.used_by}` : 'already used by another studio'
  return m.on_list ? 'on the list now (was not then)' : 'not on the list'
}

