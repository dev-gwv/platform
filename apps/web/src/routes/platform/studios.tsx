import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Building2, CalendarClock, CalendarPlus, Copy, Download, Eye, Gem, History, Plus, RefreshCw, Search, ShieldOff, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { PlatformStudio } from '@ipc/contracts'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { Input, Label, Select } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Card, CardContent } from '@/shared/ui/card'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { humanize } from '@/shared/ui/format'
import { StudioFeatures } from '@/features/platform/StudioFeatures'
import { usePlatformStudios, usePlatformPlanAction, usePlatformPlans, useAssignPlan, useCreatePlatformStudio, useLegacyStudios, useImportLegacyStudios, useSetAccessUntil } from '@/features/platform/api'
import { DateField, toIso } from '@/shared/ui/date-field'
import { inviteMessage, legacyState, parseLegacyCsv, type LegacyParse } from '@/features/platform/legacy'
import { STATUS_LABEL, accessMessage, endsOf, extendFrom, toRows, type AccessRow, type AccessStatus } from '@/features/platform/access-rows'

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
function downloadAccessCsv(rows: AccessRow[]) {
  if (rows.length === 0) {
    toast.info('Nothing to export.')
    return
  }
  const header = ['Studio Name', 'Owner Name', 'Email', 'Phone', 'Created Date', 'Status', 'Expiry Date', 'Days Left', 'Plan', 'App']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [r.name, r.owner ?? '', r.email ?? '', r.phone ?? '', fmtIso(r.created), STATUS_LABEL[r.status], fmtIso(r.expires), r.daysLeft ?? '', r.plan ?? '', r.kind === 'new' ? 'New' : 'Old, not joined']
        .map(csvEscape)
        .join(','),
    )
  }
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `studio-access-report-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toast.success(`Exported ${rows.length} studio${rows.length === 1 ? '' : 's'}.`)
}

export function PlatformStudiosPage() {
  return (
    <PlatformPage>
      <Studios />
    </PlatformPage>
  )
}

type SortKey = 'name' | 'created' | 'expires' | 'days'
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
  const studios = usePlatformStudios()
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
  rows = [...rows].sort((a, b) => {
    switch (sort) {
      case 'name': return a.name.localeCompare(b.name) * mul
      case 'expires': return String(a.expires ?? '').localeCompare(String(b.expires ?? '')) * mul
      case 'days': return ((a.daysLeft ?? -1) - (b.daysLeft ?? -1)) * mul
      default: return String(a.created ?? '').localeCompare(String(b.created ?? '')) * mul
    }
  })
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = rows.slice((safePage - 1) * pageSize, safePage * pageSize)

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
      <PageHeader
        title="Studio Access Manager"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { void studios.refetch(); void legacy.refetch() }} disabled={studios.isFetching}>
              <RefreshCw className={cn('size-4', studios.isFetching && 'animate-spin')} /> Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => downloadAccessCsv(rows)}>
              <Download className="size-4" /> Export CSV
            </Button>
            <ImportOldAppButton />
            <CreateStudioDialog />
          </div>
        }
      />
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
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      {all.length === 0 ? (
        <EmptyState title="No studios yet" description="Studios appear here as they sign up, or bring the old app's list in with Import from old app." />
      ) : (
        <>
          <div className="table-wrap rounded-lg border border-border bg-card">
            <table className="table-sticky w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <SortHead k="name" {...sortProps}>Studio</SortHead>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
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
                    <td className="px-4 py-3">{r.owner ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.email ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.phone ?? '—'}</td>
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
        <StudioDetailsDialog studio={dialog.studio} onClose={() => setDialog(null)} onExpire={() => void revoke(dialog.studio)} />
      )}
      {dialog?.kind === 'plan' && (
        <Dialog open onOpenChange={(o) => { if (!o) setDialog(null) }}>
          <DialogContent title={`Plan for ${dialog.studio.name}`} description={`Now: ${dialog.studio.plan_key ?? humanize(dialog.studio.plan_gate)}`}>
            <AssignPlanForm studio={dialog.studio} />
          </DialogContent>
        </Dialog>
      )}
      {dialog?.kind === 'custom' && <GiveAccessDialog studio={dialog.studio} onClose={() => setDialog(null)} />}
    </>
  )
}

/**
 * Give a studio access, as the old Studio Access board did: 30, 90 or 180
 * days or a year on from when its access ends now (or from today, once it
 * has ended), or to a date picked on the calendar. Each line says the date
 * it lands on before anything is saved.
 */
function GiveAccessDialog({ studio, onClose }: { studio: PlatformStudio; onClose: () => void }) {
  const setUntil = useSetAccessUntil()
  const [picked, setPicked] = useState('')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = endsOf(studio)
  const base = end && new Date(end).getTime() > Date.now() ? new Date(end) : today
  const plus = (days: number) => {
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    return toIso(d)
  }
  const give = (until: string) => setUntil.mutate({ studioId: studio.id, until }, { onSuccess: onClose })
  const options = [
    { label: '30 days', until: plus(30) },
    { label: '90 days', until: plus(90) },
    { label: '180 days', until: plus(180) },
    { label: '1 year', until: plus(365) },
  ]
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        title={`Give ${studio.name} access`}
        description={end && new Date(end).getTime() > Date.now() ? `Access now ends on ${fmtDate(end)}.` : 'Access has ended; these count from today.'}
      >
        <div className="flex flex-col gap-2 text-sm">
          {options.map((o) => (
            <div key={o.label} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
              <span><span className="font-medium">+{o.label}</span> <span className="text-muted-foreground">→ until {fmtDate(o.until)}</span></span>
              <Button size="sm" disabled={setUntil.isPending} onClick={() => give(o.until)}>Give</Button>
            </div>
          ))}
          <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-2 ${picked ? 'border-success/50 bg-success/5' : 'border-warning/60 bg-warning/5'}`}>
            <span className="font-medium">Until a date</span>
            <div className="flex items-center gap-2">
              <DateField aria-label="Access until" value={picked} min={toIso(today)} onChange={(e) => setPicked(e.target.value)} />
              <Button size="sm" disabled={!picked || setUntil.isPending} onClick={() => give(picked)}>Set</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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

function CreateStudioDialog() {
  const create = useCreatePlatformStudio()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [planKey, setPlanKey] = useState('')
  const [open, setOpen] = useState(false)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(open ? 'platform-studio:new' : null, { name, email, phone, planKey }, (v) => {
    setName(v.name)
    setEmail(v.email)
    setPhone(v.phone)
    setPlanKey(v.planKey)
  })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="size-4" /> Create Studio Access</Button></DialogTrigger>
      <DialogContent
        title="Create studio"
        description="Creates the tenant and records the owner invite. The studio has no owner until that person registers against it."
      >
        <div className="mt-3 flex flex-col gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Studio name *" />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Owner email *" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Owner phone (optional)" />
          <Input value={planKey} onChange={(e) => setPlanKey(e.target.value)} placeholder="Plan key (optional — grants trial)" />
          <Button disabled={create.isPending || !name.trim() || !email.trim()} onClick={() =>
              create.mutate(
                { name: name.trim(), owner_email: email.trim(), owner_phone: phone.trim() || undefined, plan_key: planKey.trim() || undefined },
                {
                  onSuccess: () => {
                    draft.clear()
                    setName('')
                    setEmail('')
                    setPhone('')
                    setPlanKey('')
                    setOpen(false)
                  },
                },
              )
            }
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
                {p.name} · ₹{p.price.toLocaleString('en-IN')} · {length(p)}{p.audience ? ` · ${p.audience === 'diamond' ? 'Diamond' : 'outsider'}` : ''}
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

function StudioDetailsDialog({ studio, onClose, onExpire }: { studio: PlatformStudio; onClose: () => void; onExpire: () => void }) {
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
        <StudioFeatures studioId={studio.id} />
        <div className="mt-4 flex flex-col gap-2">
          <AssignPlanForm studio={studio} />
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onExpire}>Revoke access</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Bring the old app's Studio Access export in: pick the file, check the counts, import. */
function ImportOldAppButton() {
  const [open, setOpen] = useState(false)
  const [parsed, setParsed] = useState<LegacyParse | null>(null)
  const [bad, setBad] = useState(false)
  const imp = useImportLegacyStudios()
  const today = new Date().toISOString().slice(0, 10)
  const live = parsed?.rows.filter((r) => legacyState(r.expires_at, today) !== 'expired').length ?? 0
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setParsed(null); setBad(false) } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Upload className="mr-1 size-4" /> Import from old app</Button>
      </DialogTrigger>
      <DialogContent title="Import from the old app" description="On the old app open Studio Access, press Export CSV, then pick that file here.">
        <div className="flex flex-col gap-3">
          <Input
            type="file"
            accept=".csv,text/csv"
            aria-label="The old app's Studio Access export"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const r = parseLegacyCsv(await f.text())
              setParsed(r)
              setBad(!r || r.rows.length === 0)
            }}
          />
          {bad && <p className="text-sm text-destructive">That file is not the old app's Studio Access export.</p>}
          {parsed && parsed.rows.length > 0 && (
            <p className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <b>{parsed.rows.length}</b> studios · <b>{live}</b> still have access
              {parsed.skipped > 0 && <span className="text-muted-foreground"> · {parsed.skipped} lines skipped</span>}. Anyone already on the new
              app with the same email gets their remaining time now; the rest get it when they sign up.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!parsed || parsed.rows.length === 0 || imp.isPending}
              onClick={() => parsed && imp.mutate(parsed.rows, { onSuccess: () => { setOpen(false); setParsed(null) } })}
            >
              {imp.isPending ? 'Importing…' : `Import ${parsed?.rows.length ?? ''} studios`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
