import { useMemo, useState } from 'react'
import { Building2, Users, FolderKanban, Download, Copy, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { PlanGate, PlatformStudio } from '@ipc/contracts'
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
import { usePlatformStudios, usePlatformPlanAction, usePlatformCustomPlanAction, useCreatePlatformStudio } from '@/features/platform/api'

const GATE_TONE: Record<PlanGate, 'success' | 'info' | 'warning' | 'danger'> = {
  active: 'success',
  grandfathered: 'info',
  grace: 'warning',
  expired: 'danger',
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtIso = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')
const daysLeftOf = (s: PlatformStudio) =>
  s.days_remaining ?? (s.plan_expiry ? Math.max(0, Math.ceil((new Date(s.plan_expiry).getTime() - Date.now()) / 86_400_000)) : null)

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
      [s.name, s.owner_name ?? '', s.owner_email ?? '', s.owner_phone ?? '', fmtIso(s.created_at), s.plan_gate, fmtIso(s.plan_expiry), daysLeftOf(s) ?? '', s.plan_key ?? '', s.user_count, s.project_count]
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
  const customAction = usePlatformCustomPlanAction()
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
  const activeCount = all.filter((s) => s.plan_gate === 'active').length
  const graceCount = all.filter((s) => s.plan_gate === 'grace').length
  const expiredCount = all.filter((s) => s.plan_gate === 'expired').length
  const grandCount = all.filter((s) => s.plan_gate === 'grandfathered').length
  const newMonth = all.filter((s) => new Date(s.created_at).getTime() >= monthStart).length
  if (all.length === 0)
    return (
      <>
        <PageHeader title="Studios" description="Every tenant on the platform." actions={<CreateStudioDialog />} />
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

  const extendDate = (s: PlatformStudio, months: number) => {
    const base = s.plan_expiry && new Date(s.plan_expiry).getTime() > now ? new Date(s.plan_expiry) : new Date()
    const next = new Date(base)
    next.setMonth(next.getMonth() + months)
    return next
  }

  return (
    <>
      <PageHeader
        title="Studios"
        description={`${all.length} studios · ${activeCount} active · ${expiredCount} expired`}
        actions={
          <div className="flex gap-2">
            <CreateStudioDialog />
            <Button size="sm" variant="outline" onClick={() => downloadStudiosCsv(rows)}>
              <Download className="mr-1 size-4" /> CSV
            </Button>
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Studios" value={all.length} hint="All tenants" />
        <StatCard label="Active" value={activeCount} hint="Currently accessible" tone="text-success" />
        <StatCard label="Grace" value={graceCount} hint="Expiring soon" tone="text-warning" />
        <StatCard label="Expired" value={expiredCount} hint="Access ended" tone="text-destructive" />
        <StatCard label="New This Month" value={newMonth} hint={`Grandfathered ${grandCount}`} />
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search name, owner…" className="pl-8" />
        </div>
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
              <th className="px-4 py-2 font-medium">Expiry</th>
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
                <td className="px-4 py-2"><StatusBadge tone={GATE_TONE[s.plan_gate]}>{humanize(s.plan_gate)}</StatusBadge>{s.plan_key && <span className="ml-1 text-xs text-muted-foreground">{s.plan_key}</span>}</td>
                <td className="px-4 py-2 text-muted-foreground">{daysLeftOf(s) ?? '—'}</td>
                <td className="px-4 py-2 text-right">{s.user_count}</td>
                <td className="px-4 py-2 text-right">{s.project_count}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtDate(s.plan_expiry)}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmtDate(s.created_at)}</td>
                <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="outline" disabled={planAction.isPending} onClick={() => setExtendPreview(s)}>Extend…</Button>
                    <Button size="sm" variant="outline" disabled={customAction.isPending} onClick={() => customAction.mutate({ studioId: s.id, months: 3 })}>+3mo</Button>
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
      {selected && (<StudioDetailsDialog studio={selected} onClose={() => setSelected(null)} onExpire={() => void onExpire(selected)} />)}
      {extendPreview && (
        <Dialog open onOpenChange={(o) => { if (!o) setExtendPreview(null) }}>
          <DialogContent title={`Extend ${extendPreview.name}`} description="Preview the new expiry before confirming.">
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-muted-foreground">Current expiry: {fmtDate(extendPreview.plan_expiry)}</p>
              {[3, 12].map((m) => (
                <div key={m} className="flex items-center justify-between rounded-lg border border-border p-2">
                  <span>+{m} month{m === 1 ? '' : 's'} → {fmtDate(extendDate(extendPreview, m).toISOString())}</span>
                  <Button size="sm" variant="outline" disabled={planAction.isPending || customAction.isPending} onClick={() => { customAction.mutate({ studioId: extendPreview.id, months: m }); setExtendPreview(null) }}>Confirm</Button>
                </div>
              ))}
              <Button size="sm" variant="outline" disabled={planAction.isPending} onClick={() => { planAction.mutate({ studioId: extendPreview.id, action: 'extend', months: 12 }); setExtendPreview(null) }}>Extend 1y (plan action)</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
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
  const custom = usePlatformCustomPlanAction()
  const [planKey, setPlanKey] = useState(studio.plan_key ?? '')
  return (
    <div className="flex gap-2">
      <Input value={planKey} onChange={(e) => setPlanKey(e.target.value)} placeholder="paid plan key (e.g. studio-annual)" />
      <Button size="sm" variant="outline" disabled={custom.isPending || !planKey.trim()} onClick={() => custom.mutate({ studioId: studio.id, planKey: planKey.trim() })}>Assign paid plan</Button>
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
        <div className="mt-4 flex flex-col gap-2">
          <AssignPlanForm studio={studio} />
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onExpire}>Expire plan</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
