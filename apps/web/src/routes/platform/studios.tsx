import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Building2, CalendarClock, CalendarPlus, Copy, Download, Eye, Gem, Gift, History, RefreshCw, Search, ShieldOff, X } from 'lucide-react'
import { toast } from 'sonner'
import type { PlatformStudio, StudioActivity } from '@ipc/contracts'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { Card, CardContent } from '@/shared/ui/card'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { humanize } from '@/shared/ui/format'
import { StudioFeatures } from '@/features/platform/StudioFeatures'
import { planLabel } from '@/features/platform/plan-rows'
import { useStudioActivity, usePlatformStudios, usePlatformPlanAction, usePlatformPlans, useAssignPlan, useLegacyStudios, useSetAccessUntil } from '@/features/platform/api'
import { inviteMessage } from '@/features/platform/legacy'
import { CreateStudioDialog, GiveAccessDialog, ImportOldAppButton } from '@/features/platform/access-dialogs'
import { STATUS_LABEL, accessMessage, endsOf, extendFrom, toRows, type AccessRow, type AccessStatus } from '@/features/platform/access-rows'
import { ACTIVITY, activityLevel, lastActiveWords, madeLine, type ActivityLevel } from '@/features/platform/activity'
import { OfferDialog } from '@/features/platform/OfferDialog'
import { OffersList } from '@/features/platform/OffersList'
import { FindLoginDialog } from '@/features/platform/FindLoginDialog'
import { Segmented } from '@/shared/ui/segmented'
import { TONE_CHIP } from '@/shared/ui/tones'
import { useUrlParam } from '@/shared/hooks/use-url-param'

const STATUS_TONE: Record<AccessStatus, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  trial: 'info',
  soon: 'warning',
  expired: 'danger',
  unknown: 'neutral',
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const fmtIso = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** The old board's export: one line per studio, new app and old app alike. */
function downloadAccessCsv(rows: AccessRow[], act: Map<string, StudioActivity>, name = 'studio-access-report') {
  if (rows.length === 0) {
    toast.info('Nothing to export.')
    return
  }
  const header = ['Studio Name', 'Owner Name', 'Email', 'Phone', 'Created Date', 'Status', 'Expiry Date', 'Days Left', 'Plan', 'App', 'Activity', 'Made', 'Last in', 'Bought before']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [r.name, r.owner ?? '', r.email ?? '', r.phone ?? '', fmtIso(r.created), STATUS_LABEL[r.status], fmtIso(r.expires), r.daysLeft ?? '', r.plan ?? '', r.kind === 'new' ? 'New' : 'Old, not joined',
        ...activityCells(r.studio ? act.get(r.studio.id) : undefined, r.kind === 'old')]
        .map(csvEscape)
        .join(','),
    )
  }
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toast.success(`Exported ${rows.length} studio${rows.length === 1 ? '' : 's'}.`)
}

function activityCells(a: StudioActivity | undefined, old: boolean): string[] {
  if (old) return ['', '', '', '']
  return [ACTIVITY[activityLevel(a)].label, madeLine(a), lastActiveWords(a?.last_active), a?.bought ? 'Yes' : 'No']
}

export function PlatformStudiosPage() {
  return (
    <PlatformPage>
      <Studios />
    </PlatformPage>
  )
}

type SortKey = 'name' | 'created' | 'expires' | 'days' | 'activity' | 'last'
type Dialogs =
  | { kind: 'details'; studio: PlatformStudio }
  | { kind: 'plan'; studio: PlatformStudio }
  | { kind: 'custom'; studio: PlatformStudio }
  | null

function SortHead({ k, sort, dir, onSort, children, className }: { k: SortKey; sort: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void; children: React.ReactNode; className?: string }) {
  const on = sort === k
  return (
    <th className={cn('px-4 py-3 font-medium', className)} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className={cn('inline-flex items-center gap-1 hover:text-foreground', on && 'text-foreground')} onClick={() => onSort(k)}>
        {children}
        {on && (dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />)}
      </button>
    </th>
  )
}

/**
 * Studio Access Manager (owner, 4 Oct: as the old app had it). Every studio
 * on one list -- the new app's, and the old app's subscribers who have not
 * joined yet -- with who owns it, when it joined, where its access stands,
 * and one Actions menu: details, the access message, a plan, +30/90/180
 * days, a custom date, or revoke.
 */
function Studios() {
  const [view, setView] = useUrlParam('view', 'studios')
  return (
    <>
      <PageHeader
        title="Studio Access Manager"
        actions={
          <Segmented
            label="Studios or offers"
            value={view === 'offers' ? 'offers' : 'studios'}
            onChange={setView}
            options={[{ value: 'studios', label: 'Studios' }, { value: 'offers', label: 'Offers', icon: Gift }]}
          />
        }
      />
      {view === 'offers' ? <OffersList /> : <StudioList />}
    </>
  )
}

/**
 * The list itself. Beside each studio, what it has made and how often it is
 * in (0268), so the platform owner can sort out who to call; tick studios to
 * make them a personal offer or take a call list.
 */
function StudioList() {
  const studios = usePlatformStudios()
  const activity = useStudioActivity()
  const legacy = useLegacyStudios()
  const planAction = usePlatformPlanAction()
  const setUntil = useSetAccessUntil()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | AccessStatus>('')
  const [plan, setPlan] = useState('all')
  const [expiry, setExpiry] = useState('all')
  const [created, setCreated] = useState('all')
  const [sort, setSort] = useState<SortKey>('created')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [dialog, setDialog] = useState<Dialogs>(null)
  const [busy, setBusy] = useState<'' | ActivityLevel | 'not_bought'>('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [offering, setOffering] = useState(false)

  const act = useMemo(() => new Map((activity.data ?? []).map((a) => [a.company_id, a])), [activity.data])
  const all = useMemo(() => toRows(studios.data ?? [], legacy.data ?? []), [studios.data, legacy.data])
  const planOptions = useMemo(() => [...new Set(all.map((r) => r.plan).filter((p): p is string => !!p))].sort(), [all])

  if (studios.isLoading) return <SkeletonList rows={5} columns={6} />
  if (studios.isError) return <ErrorState onRetry={() => void studios.refetch()} />

  const now = Date.now()
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  const count = (st: AccessStatus[]) => all.filter((r) => st.includes(r.status)).length
  const newMonth = all.filter((r) => r.created && new Date(r.created).getTime() >= monthStart).length

  const q = search.trim().toLowerCase()
  let rows = all.filter((r) => {
    if (q && !`${r.name} ${r.owner ?? ''} ${r.email ?? ''} ${r.phone ?? ''}`.toLowerCase().includes(q)) return false
    if (busy) {
      if (!r.studio) return false
      const a = act.get(r.studio.id)
      if (busy === 'not_bought' ? a?.bought : activityLevel(a) !== busy) return false
    }
    if (status && r.status !== status) return false
    if (plan === 'old' && r.kind !== 'old') return false
    if (plan !== 'all' && plan !== 'old' && r.plan !== plan) return false
    if (expiry === 'expired' && r.status !== 'expired') return false
    if (['7', '15', '30'].includes(expiry) && !(r.status !== 'expired' && r.daysLeft != null && r.daysLeft <= Number(expiry))) return false
    if (created !== 'all') {
      const t = r.created ? new Date(r.created).getTime() : 0
      if (created === 'today' && !(t >= new Date(new Date().setHours(0, 0, 0, 0)).getTime())) return false
      if (created === '7' && !(t >= now - 7 * 86_400_000)) return false
      if (created === '30' && !(t >= now - 30 * 86_400_000)) return false
      if (created === 'month' && !(t >= monthStart)) return false
    }
    return true
  })
  const mul = dir === 'asc' ? 1 : -1
  const actOf = (r: AccessRow) => (r.studio ? act.get(r.studio.id) : undefined)
  const rankOf = (r: AccessRow) => (r.studio ? ACTIVITY[activityLevel(actOf(r))].rank * 100 + (actOf(r)?.active_days_30 ?? 0) : -1)
  const lastOf = (r: AccessRow) => actOf(r)?.last_active ?? null
  rows = [...rows].sort((a, b) => {
    switch (sort) {
      case 'name': return a.name.localeCompare(b.name) * mul
      case 'expires': return String(a.expires ?? '').localeCompare(String(b.expires ?? '')) * mul
      case 'days': return ((a.daysLeft ?? -1) - (b.daysLeft ?? -1)) * mul
      case 'activity': return (rankOf(a) - rankOf(b)) * mul
      case 'last': return String(lastOf(a) ?? '').localeCompare(String(lastOf(b) ?? '')) * mul
      default: return String(a.created ?? '').localeCompare(String(b.created ?? '')) * mul
    }
  })
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = rows.slice((safePage - 1) * pageSize, safePage * pageSize)
  const pickable = rows.filter((r) => r.studio).map((r) => r.studio!.id)
  const allPicked = pickable.length > 0 && pickable.every((id) => picked.has(id))
  const togglePick = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const pickedRows = all.filter((r) => r.studio && picked.has(r.studio.id))

  const copy = (text: string, done: string) =>
    void navigator.clipboard?.writeText(text).then(() => toast.success(done), () => toast.error('Could not copy.'))

  async function revoke(s: PlatformStudio) {
    const yes = await confirm({
      title: `Revoke ${s.name}'s access?`,
      description: 'The studio is locked out straight away, until you extend it or give a plan. Nothing in it is deleted.',
      confirmLabel: 'Revoke access',
      destructive: true,
    })
    if (yes) planAction.mutate({ studioId: s.id, action: 'expire' })
  }

  function menu(r: AccessRow): RowMenuItem[] {
    if (r.kind === 'old' && r.legacy) {
      const l = r.legacy
      return [{ label: 'Copy invite to the new app', icon: <Copy />, onSelect: () => copy(inviteMessage(l), 'Invite copied. Paste it on WhatsApp.') }]
    }
    const s = r.studio!
    const extend = (days: number) => setUntil.mutate({ studioId: s.id, until: extendFrom(endsOf(s), days) })
    return [
      { label: 'View details', icon: <Eye />, onSelect: () => setDialog({ kind: 'details', studio: s }) },
      { label: 'Copy access message', icon: <Copy />, onSelect: () => copy(accessMessage(r, window.location.origin), 'Access message copied.') },
      { label: 'Assign / change plan…', icon: <Gem />, onSelect: () => setDialog({ kind: 'plan', studio: s }), divider: true },
      { label: 'Extend 30 days', icon: <CalendarPlus />, onSelect: () => extend(30), disabled: setUntil.isPending, divider: true },
      { label: 'Extend 90 days', icon: <CalendarPlus />, onSelect: () => extend(90), disabled: setUntil.isPending },
      { label: 'Extend 180 days', icon: <CalendarPlus />, onSelect: () => extend(180), disabled: setUntil.isPending },
      { label: 'Custom expiry…', icon: <CalendarClock />, onSelect: () => setDialog({ kind: 'custom', studio: s }) },
      ...(r.status === 'expired'
        ? []
        : [{ label: 'Revoke access', icon: <ShieldOff />, onSelect: () => void revoke(s), danger: true, divider: true, disabled: planAction.isPending }]),
    ]
  }

  const filter = (id: string, label: string, el: React.ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      {el}
    </div>
  )
  const reset = () => setPage(1)
  const onSort = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(k)
      setDir(k === 'name' ? 'asc' : 'desc')
    }
  }
  const sortProps = { sort, dir, onSort }

  return (
    <>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => { void studios.refetch(); void legacy.refetch(); void activity.refetch() }} disabled={studios.isFetching}>
          <RefreshCw className={cn('size-4', studios.isFetching && 'animate-spin')} /> Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadAccessCsv(rows, act)}>
          <Download className="size-4" /> Export CSV
        </Button>
        <FindLoginDialog />
        <ImportOldAppButton />
        <CreateStudioDialog />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total studios" value={all.length} hint="All studios" />
        <StatCard label="Active" value={count(['active', 'trial', 'soon'])} hint="Currently accessible" tone="text-success" />
        <StatCard label="Expiring soon" value={count(['soon'])} hint="Next 7 days" tone="text-warning" />
        <StatCard label="Expired" value={count(['expired'])} hint="Access ended" tone="text-destructive" />
        <StatCard label="New this month" value={newMonth} hint="Joined this month" />
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(e) => { setSearch(e.target.value); reset() }} placeholder="Search studio, owner, email, phone…" aria-label="Search studios" className="pl-9" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {filter('sa-status', 'Status', (
              <Select id="sa-status" value={status} onChange={(e) => { setStatus(e.target.value as '' | AccessStatus); reset() }}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="trial">Free trial</option>
                <option value="soon">Expiring soon</option>
                <option value="expired">Expired</option>
              </Select>
            ))}
            {filter('sa-expiry', 'Expiry window', (
              <Select id="sa-expiry" value={expiry} onChange={(e) => { setExpiry(e.target.value); reset() }}>
                <option value="all">All</option>
                <option value="7">In 7 days</option>
                <option value="15">In 15 days</option>
                <option value="30">In 30 days</option>
                <option value="expired">Already expired</option>
              </Select>
            ))}
            {filter('sa-created', 'Created', (
              <Select id="sa-created" value={created} onChange={(e) => { setCreated(e.target.value); reset() }}>
                <option value="all">Any time</option>
                <option value="today">Today</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="month">This month</option>
              </Select>
            ))}
            {filter('sa-activity', 'Activity', (
              <Select id="sa-activity" value={busy} onChange={(e) => { setBusy(e.target.value as typeof busy); reset() }}>
                <option value="">Any activity</option>
                {(Object.keys(ACTIVITY) as ActivityLevel[]).map((k) => (<option key={k} value={k}>{ACTIVITY[k].label}</option>))}
                <option value="not_bought">Never bought a plan</option>
              </Select>
            ))}
            {filter('sa-plan', 'Plan', (
              <Select id="sa-plan" value={plan} onChange={(e) => { setPlan(e.target.value); reset() }}>
                <option value="all">All plans</option>
                {planOptions.map((p) => (<option key={p} value={p}>{p}</option>))}
                {all.some((r) => r.kind === 'old') && <option value="old">Old app, not joined yet</option>}
              </Select>
            ))}
          </div>
        </CardContent>
      </Card>

      {picked.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-card p-2 shadow-md">
          <span className="px-2 text-sm font-medium">{picked.size} studio{picked.size === 1 ? '' : 's'} ticked</span>
          <Button size="sm" onClick={() => setOffering(true)}>
            <Gift className="size-4" /> Make an offer
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadAccessCsv(pickedRows, act, 'call-list')}>
            <Download className="size-4" /> Call list
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
            <X className="size-4" /> Clear
          </Button>
        </div>
      )}
      {all.length === 0 ? (
        <EmptyState title="No studios yet" description="Studios appear here as they sign up, or bring the old app's list in with Import from old app." />
      ) : (
        <>
          <div className="table-wrap rounded-lg border border-border bg-card">
            <table className="table-sticky w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      aria-label="Tick every studio in this list"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(pickable))}
                    />
                  </th>
                  <SortHead k="name" {...sortProps}>Studio</SortHead>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <SortHead k="activity" {...sortProps}>Activity</SortHead>
                  <SortHead k="last" {...sortProps}>Last in</SortHead>
                  <SortHead k="created" {...sortProps}>Created</SortHead>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <SortHead k="expires" {...sortProps}>Expires</SortHead>
                  <SortHead k="days" {...sortProps}>Days left</SortHead>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr
                    key={r.key}
                    className={cn('border-t border-border', r.studio && 'cursor-pointer hover:bg-muted/30')}
                    onClick={() => r.studio && setDialog({ kind: 'details', studio: r.studio })}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {r.studio && (
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={`Tick ${r.name}`}
                          checked={picked.has(r.studio.id)}
                          onChange={() => togglePick(r.studio!.id)}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="flex items-center gap-1.5 font-medium">
                        {r.kind === 'old' ? <History className="size-4 text-muted-foreground" aria-label="On the old app" /> : <Building2 className="size-4 text-muted-foreground" aria-hidden />}
                        {r.name}
                      </p>
                      {(r.diamond || r.kind === 'old') && (
                        <p className="text-xs text-muted-foreground">
                          {r.diamond && <span className="font-medium text-tone-violet">IPC Diamond</span>}
                          {r.kind === 'old' && 'Old app, not joined yet'}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p>{r.owner ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{[r.email, r.phone].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      {r.studio && <ActivityCell a={act.get(r.studio.id)} />}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{r.studio ? lastActiveWords(act.get(r.studio.id)?.last_active) : '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(r.created)}</td>
                    <td className="px-4 py-3"><StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge></td>
                    <td className="px-4 py-3 text-muted-foreground">{fmtDate(r.expires)}</td>
                    <td className={cn('px-4 py-3 tabular-nums', r.status === 'soon' && 'font-medium text-warning', r.status === 'expired' && 'text-destructive')}>
                      {r.status === 'expired' ? 'Ended' : r.daysLeft != null ? `${r.daysLeft}d` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowMenu label={`Actions for ${r.name}`} items={menu(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <p>Page {safePage} of {totalPages} · {rows.length} studios</p>
            <div className="flex items-center gap-2">
              <Select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); reset() }} aria-label="Studios per page">
                <option value="25">25 a page</option>
                <option value="50">50 a page</option>
                <option value="100">100 a page</option>
              </Select>
              <Button size="sm" variant="outline" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
      {dialog?.kind === 'details' && (
        <StudioDetailsDialog studio={dialog.studio} activity={act.get(dialog.studio.id)} onClose={() => setDialog(null)} onExpire={() => void revoke(dialog.studio)} />
      )}
      {dialog?.kind === 'plan' && (
        <Dialog open onOpenChange={(o) => { if (!o) setDialog(null) }}>
          <DialogContent title={`Plan for ${dialog.studio.name}`} description={`Now: ${dialog.studio.plan_key ?? humanize(dialog.studio.plan_gate)}`}>
            <AssignPlanForm studio={dialog.studio} />
          </DialogContent>
        </Dialog>
      )}
      {dialog?.kind === 'custom' && <GiveAccessDialog studio={dialog.studio} onClose={() => setDialog(null)} />}
      {offering && <OfferDialog ids={[...picked]} onClose={() => setOffering(false)} onDone={() => setPicked(new Set())} />}
    </>
  )
}

function StatCard({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-bold tabular-nums ${tone ?? ''}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function AssignPlanForm({ studio }: { studio: PlatformStudio }) {
  const plans = usePlatformPlans()
  const assign = useAssignPlan()
  const [planKey, setPlanKey] = useState('')
  const chosen = (plans.data ?? []).find((p) => p.key === planKey)
  const length = (p: NonNullable<typeof chosen>) => (p.duration_days ? `${p.duration_days} days` : p.billing_interval === 'yearly' ? '1 year' : '1 month')
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Select value={planKey} onChange={(e) => setPlanKey(e.target.value)} aria-label="Plan to give" className={planKey ? undefined : 'border-warning/60'}>
          <option value="">Pick a plan…</option>
          {(plans.data ?? [])
            .filter((p) => p.is_active)
            .map((p) => (
              <option key={p.id} value={p.key}>
                {planLabel(p)} · ₹{p.price.toLocaleString('en-IN')} + GST · {length(p)}
              </option>
            ))}
        </Select>
        <Button size="sm" disabled={assign.isPending || !planKey} onClick={() => assign.mutate({ studioId: studio.id, planKey })}>
          Give plan
        </Button>
      </div>
      {chosen && <p className="text-xs text-muted-foreground">Adds {length(chosen)} from {studio.plan_expiry && new Date(studio.plan_expiry) > new Date() ? 'their current end date' : 'today'}. No payment is taken.</p>}
    </div>
  )
}

/** One studio's activity: the word in its colour, and what it has made. */
function ActivityCell({ a }: { a: StudioActivity | undefined }) {
  const level = ACTIVITY[activityLevel(a)]
  return (
    <div className="min-w-0">
      <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', TONE_CHIP[level.tone])}>{level.label}</span>
      <p className="mt-0.5 text-xs text-muted-foreground">{madeLine(a)}</p>
    </div>
  )
}

function StudioDetailsDialog({ studio, activity, onClose, onExpire }: { studio: PlatformStudio; activity: StudioActivity | undefined; onClose: () => void; onExpire: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={studio.name} description="Studio access details">
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-muted-foreground">Owner</dt><dd>{studio.owner_name ?? '—'}</dd></div>
          <div><dt className="text-muted-foreground">Email</dt><dd>{studio.owner_email ?? '—'}</dd></div>
          <div><dt className="text-muted-foreground">Phone</dt><dd>{studio.owner_phone ?? '—'}</dd></div>
          <div><dt className="text-muted-foreground">Plan</dt><dd>{studio.plan_key ?? humanize(studio.plan_gate)}</dd></div>
          <div><dt className="text-muted-foreground">Access until</dt><dd>{fmtDate(endsOf(studio))}</dd></div>
          <div><dt className="text-muted-foreground">Joined</dt><dd>{fmtDate(studio.created_at)}</dd></div>
          <div><dt className="text-muted-foreground">Users</dt><dd>{studio.user_count}</dd></div>
          <div><dt className="text-muted-foreground">Projects</dt><dd>{studio.project_count}</dd></div>
        </dl>
        <div className="mt-3 rounded-lg border border-border p-3 text-sm">
          <ActivityCell a={activity} />
          <p className="mt-1 text-muted-foreground">
            In on {activity?.active_days_7 ?? 0} of the last 7 days and {activity?.active_days_30 ?? 0} of the last 30 ·{' '}
            {activity?.last_active ? `last in ${lastActiveWords(activity.last_active).toLowerCase()}` : 'not in for 30 days'}
            {activity?.bought ? ' · has bought a plan' : ' · has never bought a plan'}
          </p>
        </div>
        <StudioFeatures studioId={studio.id} />
        <div className="mt-4 flex flex-col gap-2">
          <AssignPlanForm studio={studio} />
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onExpire}>Revoke access</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
