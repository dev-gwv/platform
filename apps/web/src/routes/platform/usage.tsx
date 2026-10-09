import { useMemo, useState } from 'react'
import { Building2, CheckCircle2, Users, IndianRupee, Download, Activity } from 'lucide-react'
import { toast } from 'sonner'
import { PlatformPage } from '@/shared/layout/PlatformPage'
import { PageHeader } from '@/shared/layout/page-header'
import { StatCard } from '@/shared/ui/stat-card'
import { SkeletonTiles } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { Dialog, DialogContent } from '@/shared/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatINR } from '@/shared/ui/format'
import { usePlatformUsage } from '@/features/platform/api'

function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function download(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  if (rows.length === 0) {
    toast.info('Nothing to export.')
    return
  }
  const lines = [header.join(',')]
  for (const r of rows) lines.push(r.map(csvEscape).join(','))
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toast.success(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}.`)
}

/**
 * Lovable parity: funnel/health + avg/inactive + logs pagination + 3 exports
 * + detail drawer content + custom range. Heartbeat console (usage_events).
 */
export function PlatformUsagePage() {
  return (
    <PlatformPage>
      <Usage />
    </PlatformPage>
  )
}

function Usage() {
  const [days, setDays] = useState('30')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [module, setModule] = useState('')
  const [search, setSearch] = useState('')
  const [logPage, setLogPage] = useState(1)
  const [logSize, setLogSize] = useState(25)
  const [drawer, setDrawer] = useState<{ company_id: string; company_name: string | null; events: number } | null>(null)
  const effectiveDays = days === 'custom' && customFrom && customTo
    ? String(Math.max(1, Math.ceil((new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86_400_000)))
    : days
  const { data, isLoading, isError, refetch } = usePlatformUsage(effectiveDays, module || undefined)

  const logs = useMemo(() => {
    const all = data?.recent_events ?? []
    if (days !== 'custom' || !customFrom || !customTo) return all
    const from = new Date(customFrom).getTime()
    const to = new Date(customTo).getTime() + 86_399_000
    return all.filter((e) => {
      const t = new Date(e.occurred_at).getTime()
      return t >= from && t <= to
    })
  }, [data, days, customFrom, customTo])

  const logPages = Math.max(1, Math.ceil(logs.length / logSize))
  const safeLogPage = Math.min(logPage, logPages)
  const pagedLogs = logs.slice((safeLogPage - 1) * logSize, safeLogPage * logSize)

  if (isLoading) return <SkeletonTiles count={4} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const modules = (data.modules ?? []).filter((m) => !module || m.module === module)
  const top = (data.top_studios ?? []).filter((t) =>
    !search || (t.company_name ?? '').toLowerCase().includes(search.toLowerCase()),
  )
  const funnel = data.activation_funnel ?? null
  const funnelEntries = funnel ? Object.entries(funnel) : []
  const health = data.health_by_studio ?? []
  const inactive = top.filter((t) => t.events === 0)
  const avg = data.avg_sessions_per_studio ?? data.avg_session_seconds ?? null

  function exportSummary() {
    download('usage-summary', ['Studio', 'Events'], top.map((t) => [t.company_name ?? t.company_id, t.events]))
  }
  function exportInactive() {
    const rows = inactive.length > 0 ? inactive : top.filter((t) => t.events < 5)
    download('inactive-studios', ['Studio', 'Company ID', 'Events'], rows.map((t) => [t.company_name ?? '', t.company_id, t.events]))
  }
  function exportLogs() {
    download('activity-logs', ['Time', 'Studio', 'Module', 'Route'], logs.map((e) => [e.occurred_at, e.company_id, e.module ?? '', e.route ?? '']))
  }

  return (
    <>
      <PageHeader
        title="Usage"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportSummary}><Download className="mr-1 size-4" /> Summary</Button>
            <Button size="sm" variant="outline" onClick={exportInactive}><Download className="mr-1 size-4" /> Inactive</Button>
            <Button size="sm" variant="outline" onClick={exportLogs}><Download className="mr-1 size-4" /> Logs</Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Window</label>
          <Select value={days} onChange={(e) => { setDays(e.target.value); setLogPage(1) }}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="custom">Custom range</option>
          </Select>
        </div>
        {days === 'custom' && (
          <>
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label className="text-xs text-muted-foreground">Module</label>
          <Select value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">All modules</option>
            {(data.modules ?? []).map((m) => (
              <option key={m.module} value={m.module}>{m.module}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Studio</label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter top studios…" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Studios" value={String(data.studio_count)} icon={Building2} />
        <StatCard label="Active studios" value={String(data.active_studio_count)} icon={CheckCircle2} />
        <StatCard label="Total users" value={String(data.total_users)} icon={Users} />
        <StatCard label="Revenue (30d)" value={formatINR(data.revenue_last_30d)} icon={IndianRupee} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active today" value={String(data.active_today ?? '—')} icon={Activity} />
        <StatCard label="Active (7d)" value={String(data.active_week ?? '—')} icon={Activity} />
        <StatCard label="Sessions" value={String(data.sessions_30d ?? '—')} icon={Activity} />
        <StatCard label="Events" value={String(data.events_30d ?? '—')} icon={Activity} />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
        {avg != null && <span>Avg sessions/studio: {Number(avg).toFixed(1)}</span>}
        {data.inactive_count != null && <span>{data.inactive_count} studios with no heartbeat in this window.</span>}
      </div>

      {funnelEntries.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Activation funnel</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {funnelEntries.map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-xl font-semibold tabular-nums">{v}</p>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.replace(/_/g, ' ')}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {health.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Studio health</CardTitle></CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {health.slice(0, 10).map((h) => (
                <li key={h.company_id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{h.company_id.slice(0, 8)}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge tone={/power|active/i.test(h.health_label) ? 'success' : /risk|inactive/i.test(h.health_label) ? 'danger' : 'warning'}>{h.health_label}</StatusBadge>
                    <span className="text-xs text-muted-foreground">{h.last_active ? new Date(h.last_active).toLocaleDateString('en-IN') : 'Never'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Modules</CardTitle></CardHeader>
          <CardContent>
            {modules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No heartbeat data yet — it appears once studios browse with the tracker running.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {modules.map((m) => (
                  <li key={m.module} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{m.module}</span>
                    <span className="tabular-nums text-muted-foreground">{m.events} events</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top studios</CardTitle></CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <p className="text-sm text-muted-foreground">No per-studio data in this window.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {top.map((t) => (
                  <li key={t.company_id}>
                    <button className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/50" onClick={() => setDrawer(t)}>
                      <span className="font-medium">{t.company_name ?? t.company_id.slice(0, 8)}</span>
                      <span className="tabular-nums text-muted-foreground">{t.events} events</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent heartbeats ({logs.length})</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={String(logSize)} onChange={(e) => { setLogSize(Number(e.target.value)); setLogPage(1) }} aria-label="Logs per page">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {pagedLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No heartbeat data in this window.</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-auto text-sm">
              {pagedLogs.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-muted-foreground">
                  <span className="truncate">{r.route ?? r.module ?? '—'}</span>
                  <span className="shrink-0 text-xs">{new Date(r.occurred_at).toLocaleString('en-IN')}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Page {safeLogPage} of {logPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={safeLogPage <= 1} onClick={() => setLogPage((p) => p - 1)}>Prev</Button>
              <Button size="sm" variant="outline" disabled={safeLogPage >= logPages} onClick={() => setLogPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {drawer && (
        <Dialog open onOpenChange={(o) => { if (!o) setDrawer(null) }}>
          <DialogContent title={drawer.company_name ?? 'Studio'} description={`${drawer.events} events in the last ${effectiveDays} days.`}>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-muted-foreground">Company</dt><dd className="font-mono text-xs">{drawer.company_id}</dd></div>
              <div><dt className="text-muted-foreground">Events</dt><dd className="font-medium tabular-nums">{drawer.events}</dd></div>
              <div><dt className="text-muted-foreground">Window</dt><dd>Last {effectiveDays} days{module ? ` · ${module}` : ''}</dd></div>
              <div><dt className="text-muted-foreground">Health</dt><dd>{drawer.events === 0 ? 'Inactive' : drawer.events < 5 ? 'Needs support' : drawer.events >= 20 ? 'Power user' : 'Active'}</dd></div>
            </dl>
            <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              Recommended: {drawer.events === 0 ? 'Send reactivation message' : drawer.events < 5 ? 'Call and help with setup' : 'Continue nurturing'}.
              Per-studio funnel + session drill-down arrive with the next rollup; the totals above already come from usage_events.
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
