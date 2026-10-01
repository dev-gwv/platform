import { useMemo, useState } from 'react'
import { Building2, Users, FolderKanban, Download, Copy, Search, Upload, History } from 'lucide-react'
import { toast } from 'sonner'
import type { LegacyStudio, PlanGate, PlatformStudio } from '@ipc/contracts'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { Card, CardContent } from '@/shared/ui/card'
import { useConfirm } from '@/shared/ui/confirm'
import { humanize } from '@/shared/ui/format'
import { StudioFeatures } from '@/features/platform/StudioFeatures'
import { usePlatformStudios, usePlatformPlanAction, usePlatformPlans, useAssignPlan, useCreatePlatformStudio, useLegacyStudios, useImportLegacyStudios, useSetAccessUntil } from '@/features/platform/api'
import { DateField, toIso } from '@/shared/ui/date-field'
import { inviteMessage, legacyDaysLeft, legacyState, parseLegacyCsv, type LegacyParse } from '@/features/platform/legacy'

const GATE_TONE: Record<PlanGate, 'success' | 'info' | 'warning' | 'danger'> = {
  active: 'success',
  grandfathered: 'info',
  grace: 'warning',
  expired: 'danger',
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtIso = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')
/** When the studio's access ends: paid plan, else trial, else grace (0210). */
const endsOf = (s: PlatformStudio) => s.access_until ?? s.plan_expiry
const daysLeftOf = (s: PlatformStudio) => {
  const end = endsOf(s)
  return end ? Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000)) : (s.days_remaining ?? null)
}
/** A studio on open access that ends within two months is on its trial (7 days, or 30 for an IPC Diamond member). */
const gateLabel = (s: PlatformStudio) =>
  s.plan_gate === 'grandfathered' && (daysLeftOf(s) ?? 999) <= 60 ? 'Free trial' : humanize(s.plan_gate)
const ago = (iso: string | null | undefined) => {
  if (!iso) return 'Never'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`
}

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** 11-column vendor export (Lovable parity). */
function downloadStudiosCsv(rows: PlatformStudio[]) {
  if (rows.length === 0) {
    toast.info('Nothing to export.')
    return
  }
  const header = ['Studio Name', 'Owner Name', 'Email', 'Phone', 'Created Date', 'Status', 'Expiry Date', 'Days Left', 'Plan', 'Users', 'Projects']
  const lines = [header.join(',')]
  for (const s of rows) {
    lines.push(
      [s.name, s.owner_name ?? '', s.owner_email ?? '', s.owner_phone ?? '', fmtIso(s.created_at), s.plan_gate, fmtIso(endsOf(s)), daysLeftOf(s) ?? '', s.plan_key ?? '', s.user_count, s.project_count]
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

type SortKey = 'name' | 'expiry' | 'joined' | 'days' | 'users'

function Studios() {
  const { data, isLoading, isError, refetch } = usePlatformStudios()
  const planAction = usePlatformPlanAction()
  const confirm = useConfirm()
  const [search, setSearch] = useState('')
  const [gate, setGate] = useState('')
  const [plan, setPlan] = useState('all')
  const [expiry, setExpiry] = useState('all')
  const [created, setCreated] = useState('all')
  const [sort, setSort] = useState<SortKey>('joined')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<PlatformStudio | null>(null)
  const [extendPreview, setExtendPreview] = useState<PlatformStudio | null>(null)
  // All / New app / Old app, not joined -- the old app's subscribers live beside the new ones (0218).
  const [where, setWhere] = useState<'all' | 'new' | 'old'>('all')
  const legacy = useLegacyStudios()

  const onExpire = async (s: PlatformStudio) => {
    const okToExpire = await confirm({
      title: `Expire ${s.name}?`,
      description: 'The studio loses access immediately until a new plan or trial is granted.',
      confirmLabel: 'Expire now',
      destructive: true,
    })
    if (okToExpire) planAction.mutate({ studioId: s.id, action: 'expire' })
  }

  const planOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of data ?? []) if (s.plan_key) set.add(s.plan_key)
    return [...set].sort()
  }, [data])

  if (isLoading) return <SkeletonList rows={5} columns={6} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />
  const all = data ?? []
  const now = Date.now()
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
  // As the old board counted it: everyone who can still get in -- paid, on a trial or in grace.
  const activeCount = all.filter((s) => s.plan_gate !== 'expired').length
  const oldOnly = (legacy.data ?? []).filter((l) => !l.joined_company_id)
  const soonNew = all.filter((s) => {
    const d = daysLeftOf(s)
    return s.plan_gate !== 'expired' && d != null && d <= 7
  }).length
  const soonCount = soonNew + oldOnly.filter((l) => legacyState(l.expires_at) === 'soon').length
  const oldActive = oldOnly.filter((l) => legacyState(l.expires_at) === 'active' || legacyState(l.expires_at) === 'soon').length
  const expiredCount = all.filter((s) => s.plan_gate === 'expired').length + oldOnly.filter((l) => legacyState(l.expires_at) === 'expired').length
  const newMonth = all.filter((s) => new Date(s.created_at).getTime() >= monthStart).length
  if (all.length === 0 && oldOnly.length === 0)
    return (
      <>
        <PageHeader title="Studios" description="Every tenant on the platform." actions={<div className="flex gap-2"><ImportOldAppButton /><CreateStudioDialog /></div>} />
        <EmptyState title="No studios yet" description="Studios appear here as they register." />
      </>
    )

  const q = search.trim().toLowerCase()
  let rows = all.filter((s) => {
    if (q && !`${s.name} ${s.owner_email ?? ''} ${s.owner_name ?? ''} ${s.owner_phone ?? ''}`.toLowerCase().includes(q)) return false
    if (gate && s.plan_gate !== gate) return false
    if (plan !== 'all' && (s.plan_key ?? '') !== plan) return false
    if (expiry !== 'all') {
      const t = s.plan_expiry ? new Date(s.plan_expiry).getTime() : null
      if (expiry === 'expired' && s.plan_gate !== 'expired') return false
      if (expiry === '7' && !(t != null && t >= now && t <= now + 7 * 86_400_000)) return false
      if (expiry === '15' && !(t != null && t >= now && t <= now + 15 * 86_400_000)) return false
      if (expiry === '30' && !(t != null && t >= now && t <= now + 30 * 86_400_000)) return false
    }
    if (created !== 'all') {
      const t = new Date(s.created_at).getTime()
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
      case 'expiry': return String(a.plan_expiry ?? '').localeCompare(String(b.plan_expiry ?? '')) * mul
      case 'days': return ((daysLeftOf(a) ?? -1) - (daysLeftOf(b) ?? -1)) * mul
      case 'users': return (a.user_count - b.user_count) * mul
      default: return String(a.created_at).localeCompare(String(b.created_at)) * mul
    }
  })
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paged = rows.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function copyMessage(s: PlatformStudio) {
    const msg = `Hi ${s.owner_name ?? 'there'}, your ${s.name} plan (${s.plan_gate}) ${s.plan_expiry ? `runs until ${fmtDate(s.plan_expiry)}` : 'needs renewal'}. Renew here to keep everything running.`
    try {
      await navigator.clipboard.writeText(msg)
      toast.success('Renewal message copied.')
    } catch {
      toast.error('Could not copy.')
    }
  }

  function toggleSort(k: SortKey) {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(k)
      setDir(k === 'name' ? 'asc' : 'desc')
    }
  }

  return (
    <>
      <PageHeader
        title="Studios"
        description={`${all.length + oldOnly.length} studios · ${activeCount + oldActive} active · ${expiredCount} expired${oldOnly.length ? ` · ${oldOnly.length} still on the old app` : ''}`}
        actions={
          <div className="flex gap-2">
            <ImportOldAppButton />
            <CreateStudioDialog />
            <Button size="sm" variant="outline" onClick={() => downloadStudiosCsv(rows)}>
              <Download className="mr-1 size-4" /> CSV
            </Button>
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Studios" value={all.length + oldOnly.length} hint={oldOnly.length ? `${oldOnly.length} on the old app` : 'All studios'} />
        <StatCard label="Active" value={activeCount + oldActive} hint="Currently accessible" tone="text-success" />
        <StatCard label="Expiring Soon" value={soonCount} hint="Next 7 days" tone="text-warning" />
        <StatCard label="Expired" value={expiredCount} hint="Access ended" tone="text-destructive" />
        <StatCard label="New This Month" value={newMonth} hint="Joined this month" />
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search studio, owner, email, phone…" className="pl-8" />
        </div>
        {oldOnly.length > 0 && (
          <Select value={where} onChange={(e) => { setWhere(e.target.value as 'all' | 'new' | 'old'); setPage(1) }} aria-label="Where">
            <option value="all">New and old app</option>
            <option value="new">New app</option>
            <option value="old">Old app, not joined</option>
          </Select>
        )}
        <Select value={gate} onChange={(e) => { setGate(e.target.value); setPage(1) }} aria-label="Plan status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="grace">Grace</option>
          <option value="grandfathered">Grandfathered</option>
          <option value="expired">Expired</option>
        </Select>
        <Select value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1) }} aria-label="Plan">
          <option value="all">All plans</option>
          {planOptions.map((p) => (<option key={p} value={p}>{p}</option>))}
        </Select>
        <Select value={expiry} onChange={(e) => { setExpiry(e.target.value); setPage(1) }} aria-label="Expiry window">
          <option value="all">Any expiry</option>
          <option value="7">Expiring in 7 days</option>
          <option value="15">Expiring in 15 days</option>
          <option value="30">Expiring in 30 days</option>
          <option value="expired">Expired</option>
        </Select>
        <Select value={created} onChange={(e) => { setCreated(e.target.value); setPage(1) }} aria-label="Created">
          <option value="all">Joined anytime</option>
          <option value="today">Today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="month">This month</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
          <option value="joined">Newest</option>
          <option value="name">Name</option>
          <option value="expiry">Expiry</option>
          <option value="days">Days left</option>
          <option value="users">Users</option>
        </Select>
        <Button size="sm" variant="ghost" onClick={() => toggleSort(sort)}>↕ {dir}</Button>
        <Select value={String(pageSize)} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} aria-label="Page size">
          <option value="10">10 / page</option>
          <option value="25">25 / page</option>
          <option value="50">50 / page</option>
          <option value="100">100 / page</option>
        </Select>
      </div>
      {where !== 'old' && (<>
      <div className="table-wrap rounded-lg border border-border">
        <table className="table-sticky w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Studio</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">Phone</th>
              <th className="px-4 py-2 font-medium">Plan</th>
              <th className="px-4 py-2 font-medium">Days left</th>
              <th className="px-4 py-2 text-right font-medium"><Users className="inline h-4 w-4" aria-label="Users" /></th>
              <th className="px-4 py-2 text-right font-medium"><FolderKanban className="inline h-4 w-4" aria-label="Projects" /></th>
              <th className="px-4 py-2 font-medium">Ends on</th>
              <th className="px-4 py-2 font-medium">Last active</th>
              <th className="px-4 py-2 font-medium">Joined</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((s) => (
              <tr key={s.id} className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={() => setSelected(s)}>
                <td className="px-4 py-2 font-medium"><Building2 className="mr-1.5 inline h-4 w-4 text-muted-foreground" />{s.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{s.owner_name ?? s.owner_email ?? '—'}</td>
                <td className="px-4 py-2 text-muted-foreground">{s.owner_phone ?? '—'}</td>
                <td className="px-4 py-2"><StatusBadge tone={GATE_TONE[s.plan_gate]}>{gateLabel(s)}</StatusBadge>{s.plan_key && <span className="ml-1 text-xs text-muted-foreground">{s.plan_key}</span>}{s.member_tier === 'diamond' && <span className="ml-1 text-xs font-medium text-tone-violet">IPC Diamond</span>}</td>
                <td className="px-4 py-2 text-muted-foreground">{daysLeftOf(s) ?? '—'}</td>
                <td className="px-4 py-2 text-right">{s.user_count}</td>
                <td className="px-4 py-2 text-right">{s.project_count}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtDate(endsOf(s))}</td>
                <td className="px-4 py-2 text-muted-foreground">{ago(s.last_seen)}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtDate(s.created_at)}</td>
                <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" onClick={() => setExtendPreview(s)}>Give access</Button>
                    <Button size="sm" variant="outline" disabled={planAction.isPending} onClick={() => planAction.mutate({ studioId: s.id, action: 'trial' })}>Trial</Button>
                    <Button size="sm" variant="ghost" disabled={planAction.isPending} onClick={() => void copyMessage(s)}><Copy className="size-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={planAction.isPending} onClick={() => void onExpire(s)}>Expire</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <p>Page {safePage} of {totalPages} · {rows.length} studios</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
      </>)}
      {where !== 'new' && oldOnly.length > 0 && <OldAppStudios rows={oldOnly} search={q} expiry={expiry} />}
      {selected && (<StudioDetailsDialog studio={selected} onClose={() => setSelected(null)} onExpire={() => void onExpire(selected)} />)}
      {extendPreview && <GiveAccessDialog studio={extendPreview} onClose={() => setExtendPreview(null)} />}
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
      <DialogTrigger asChild><Button size="sm">New studio</Button></DialogTrigger>
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
          <div><dt className="text-muted-foreground">Expiry</dt><dd>{fmtDate(studio.plan_expiry)}</dd></div>
          <div><dt className="text-muted-foreground">Joined</dt><dd>{fmtDate(studio.created_at)}</dd></div>
          <div><dt className="text-muted-foreground">Users</dt><dd>{studio.user_count}</dd></div>
          <div><dt className="text-muted-foreground">Projects</dt><dd>{studio.project_count}</dd></div>
        </dl>
        <StudioFeatures studioId={studio.id} />
        <div className="mt-4 flex flex-col gap-2">
          <AssignPlanForm studio={studio} />
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onExpire}>Expire plan</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The old app's subscribers who have not signed up here yet (0218). Their
 * access and days left come from the old app's export; "Copy invite" gives
 * the message to send so they move over with their time.
 */
function OldAppStudios({ rows, search, expiry }: { rows: LegacyStudio[]; search: string; expiry: string }) {
  const today = new Date().toISOString().slice(0, 10)
  const shown = rows.filter((l) => {
    if (search && !`${l.studio_name} ${l.owner_name ?? ''} ${l.email ?? ''} ${l.phone ?? ''}`.toLowerCase().includes(search)) return false
    const st = legacyState(l.expires_at, today)
    const d = legacyDaysLeft(l.expires_at, today)
    if (expiry === 'expired' && st !== 'expired') return false
    if (['7', '15', '30'].includes(expiry) && !(st !== 'expired' && d != null && d <= Number(expiry))) return false
    return true
  })
  const [limit, setLimit] = useState(50)
  async function copyInvite(l: LegacyStudio) {
    try {
      await navigator.clipboard.writeText(inviteMessage(l))
      toast.success('Invite copied. Paste it on WhatsApp.')
    } catch {
      toast.error('Could not copy.')
    }
  }
  return (
    <section className="mt-6" aria-labelledby="old-app">
      <h2 id="old-app" className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <History className="size-4 text-muted-foreground" aria-hidden /> On the old app, not joined yet
        <span className="font-normal text-muted-foreground">· {shown.length}</span>
      </h2>
      <div className="table-wrap rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Studio</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">Phone</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Expires</th>
              <th className="px-4 py-2 font-medium">Days left</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((l) => {
              const st = legacyState(l.expires_at, today)
              return (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <p className="font-medium">{l.studio_name}</p>
                    {l.plan && <p className="text-xs text-muted-foreground">{l.plan}</p>}
                  </td>
                  <td className="px-4 py-2">
                    <p>{l.owner_name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">{l.email ?? '—'}</p>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{l.phone ?? '—'}</td>
                  <td className="px-4 py-2">
                    <StatusBadge tone={st === 'expired' ? 'danger' : st === 'soon' ? 'warning' : st === 'active' ? 'success' : 'neutral'}>
                      {st === 'expired' ? 'Expired' : st === 'soon' ? 'Expiring soon' : st === 'active' ? 'Active' : 'Unknown'}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-2">{l.expires_at ? fmtDate(`${l.expires_at}T00:00:00`) : '—'}</td>
                  <td className="px-4 py-2 tabular-nums">{st === 'expired' ? '—' : (legacyDaysLeft(l.expires_at, today) ?? '—')}</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => void copyInvite(l)}>
                      <Copy className="size-4" /> Copy invite
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <div className="mt-2 text-center">
          <Button size="sm" variant="outline" onClick={() => setLimit((n) => n + 100)}>Show more ({shown.length - limit} left)</Button>
        </div>
      )}
    </section>
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
