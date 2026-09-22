import { useEffect, useState } from 'react'
import { Activity, Database, ScrollText, Timer, Settings, Plus, Trash2, Pencil, Plug } from 'lucide-react'
import type { AuditLogEntry, CronRun } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { SettingsTabs } from '@/features/settings/SettingsTabs'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { SkeletonList, SkeletonTiles } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Select } from '@/shared/ui/input'
import { StatCard } from '@/shared/ui/stat-card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { Switch } from '@/shared/ui/switch'
import { RecordCard, RecordCards } from '@/shared/ui/record-card'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { humanize } from '@/shared/ui/format'
import { useAuditLog, useCronRuns, useHealth, useIntegrations, useCustomLookups, useDeleteCustomLookup, useCreateCustomLookup, useUpdateCustomLookup } from '@/features/settings/api'
import { useServices, useCreateService, useUpdateService, useDeleteService } from '@/features/shoots/api'
import { useTaskPriorities, useCreateTaskPriority, useUpdateTaskPriority, useDeleteTaskPriority } from '@/features/tasks/api'
import { useWorkReminderSettings, useUpdateWorkReminderSettings, useRunWorkReminders } from '@/features/work/api'
import type { TaskPriorityTone } from '@ipc/contracts'

const when = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const ENTITY_FILTERS = [
  ['', 'Everything'],
  ['company', 'Company'],
  ['user', 'Team members'],
  ['crm_lead', 'Leads'],
  ['invoice', 'Invoices'],
  ['project', 'Projects'],
  ['payment_order', 'Subscription'],
  ['employee_role', 'Roles'],
] as const

export function SystemPage({ focus }: { focus?: 'services' | 'work-submissions' } = {}) {
  return (
    <AuthedPage module="settings">
      <System focus={focus} />
    </AuthedPage>
  )
}

function System({ focus }: { focus?: 'services' | 'work-submissions' | undefined }) {
  const { session } = useAuth()
  // The old app had /settings/services and /settings/work-submissions as
  // pages of their own. Both now live on this one; a bookmark should still
  // put you in front of the right part of it.
  useEffect(() => {
    if (!focus) return
    const id = window.setTimeout(() => {
      document.getElementById(focus)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 200)
    return () => window.clearTimeout(id)
  }, [focus])
  return (
    <>
      <PageHeader
        title="System"
        description="What changed, who changed it, and whether the machinery behind the studio is running."
      />
      <SettingsTabs />
      <HowToUse
        title="Find out what happened"
        description="Every change to the studio is written here with who made it and a reference you can quote to support."
        steps={['Filter the audit log by area.', 'Check the last scheduled runs.', 'Read the health card before reporting an outage.']}
      />
      <HealthCard />
      {session?.is_owner ? (
        <>
          <Integrations />
          <CustomLookups />
          <div id="services">
            <Services />
          </div>
          <TaskPriorities />
          <div id="work-submissions">
            <WorkReminders />
          </div>
          <AuditLog />
          <CronRuns />
        </>
      ) : (
        <Card className="mt-4">
          <CardContent className="py-4">
            <EmptyState title="Owner only" description="The audit log and job history are visible to the studio owner." />
          </CardContent>
        </Card>
      )}
    </>
  )
}

/**
 * Which outside services are actually switched on.
 *
 * Every one of these degrades quietly instead of failing — no WhatsApp
 * credentials means the app opens wa.me for a person to press send, no Resend
 * key means email is logged and skipped. Sensible fallbacks, and completely
 * invisible: a studio can believe for months that the system is sending its
 * messages. This card is the answer to "is it actually on", and it is the only
 * place that says what happens when it is not.
 *
 * The API returns booleans and never the values.
 */
function Integrations() {
  const { data, isLoading, isError, refetch } = useIntegrations()

  if (isError) {
    return (
      <Card className="mt-4">
        <CardContent className="py-4">
          <ErrorState onRetry={() => void refetch()} />
        </CardContent>
      </Card>
    )
  }
  if (isLoading || !data) {
    return (
      <Card className="mt-4">
        <CardContent className="py-4">
          <SkeletonList rows={4} />
        </CardContent>
      </Card>
    )
  }

  const off = data.items.filter((i) => !i.configured).length

  return (
    <Card className="mt-4">
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium">
            <Plug className="size-4 text-muted-foreground" aria-hidden /> Connected services
          </p>
          <StatusBadge tone={off === 0 ? 'success' : 'warning'}>
            {off === 0 ? 'All connected' : `${off} not connected`}
          </StatusBadge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Each of these keeps working without its credentials — just not the way you might assume.
          What happens today is written beside each one.
        </p>

        <ul className="mt-3 divide-y divide-border">
          {data.items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-start gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{i.label}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{i.detail}</span>
                {!i.configured && (
                  // The variable NAMES, so whoever has access to the server
                  // knows exactly what to set. Never the values.
                  <span className="mt-1 block font-mono text-xs text-muted-foreground">
                    Needs: {i.requires.join(', ')}
                  </span>
                )}
              </span>
              <StatusBadge tone={i.configured ? 'success' : 'neutral'}>
                {i.configured ? 'Connected' : 'Not connected'}
              </StatusBadge>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs text-muted-foreground">
          Set on the server, not here — these are secrets, so they live in the deployment&rsquo;s
          environment rather than in the app. Environment: {data.environment}.
        </p>
      </CardContent>
    </Card>
  )
}

function HealthCard() {
  const { data, isLoading, isError, refetch } = useHealth()
  if (isLoading) return <SkeletonTiles count={4} className="mt-4" />
  if (isError || !data) {
    return (
      <Card className="mt-4">
        <CardContent className="py-2">
          <ErrorState message="The API did not answer its health check." onRetry={() => void refetch()} />
        </CardContent>
      </Card>
    )
  }
  const uptime =
    data.uptime_s >= 86_400
      ? `${Math.floor(data.uptime_s / 86_400)}d ${Math.floor((data.uptime_s % 86_400) / 3600)}h`
      : data.uptime_s >= 3600
        ? `${Math.floor(data.uptime_s / 3600)}h ${Math.floor((data.uptime_s % 3600) / 60)}m`
        : `${Math.floor(data.uptime_s / 60)}m`
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="API" value={data.ok ? 'Up' : 'Degraded'} icon={Activity} />
      <StatCard
        label="Database"
        value={data.db === 'ok' ? 'Connected' : humanize(data.db)}
        icon={Database}
      />
      <StatCard label="DB latency" value={data.db_latency_ms === null ? '—' : `${data.db_latency_ms} ms`} icon={Timer} />
      <StatCard label="Uptime" value={`${uptime} · v${data.version}`} icon={ScrollText} />
    </div>
  )
}

function AuditLog() {
  const [entity, setEntity] = useState('')
  const q = useAuditLog(entity || undefined)
  const isMobile = useIsMobile()
  const items = q.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <Card className="mt-6">
      <CardContent className="p-4 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold tracking-tight">Audit log</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Every change, newest first. The reference is the id the API logged the request under.
            </p>
          </div>
          <Select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-44" aria-label="Filter by area">
            {ENTITY_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-4">
          {q.isLoading ? (
            <SkeletonList rows={6} columns={5} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState title="Nothing recorded yet" description="Changes made from now on will be listed here." />
          ) : isMobile ? (
            <RecordCards>
              {items.map((e) => (
                <RecordCard
                  key={e.id}
                  title={humanize(e.action.replace('.', ' '))}
                  subtitle={`${e.actor_name ?? 'System'} · ${when.format(new Date(e.created_at))}`}
                  badge={<StatusBadge tone="neutral">{humanize(e.entity_type)}</StatusBadge>}
                  fields={[
                    { label: 'Reference', value: e.correlation_id ?? '—' },
                    { label: 'Change', value: summarise(e) },
                  ]}
                />
              ))}
            </RecordCards>
          ) : (
            <div className="table-wrap rounded-lg border border-border">
              <table className="table-sticky w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Who</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Change</th>
                    <th className="px-4 py-2 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} className="border-t border-border align-top hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {when.format(new Date(e.created_at))}
                      </td>
                      <td className="px-4 py-2">{e.actor_name ?? 'System'}</td>
                      <td className="px-4 py-2">
                        <span className="font-medium">{humanize(e.action.replace('.', ' '))}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{humanize(e.entity_type)}</span>
                      </td>
                      <td className="max-w-md px-4 py-2 text-muted-foreground">{summarise(e)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{e.correlation_id ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {q.hasNextPage && (
          <div className="mt-3 flex justify-center">
            <Button variant="outline" size="sm" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? 'Loading…' : 'Show older'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** A one-line reading of the after (or before) payload. */
function summarise(e: AuditLogEntry): string {
  const payload = (e.after ?? e.before) as Record<string, unknown> | null
  if (!payload || typeof payload !== 'object') return e.entity_id ? `#${e.entity_id.slice(0, 8)}` : '—'
  const parts = Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${humanize(k)}: ${String(v)}`)
  return parts.length ? parts.join(' · ') : e.entity_id ? `#${e.entity_id.slice(0, 8)}` : '—'
}

function CronRuns() {
  const { data, isLoading, isError, error, refetch } = useCronRuns()
  return (
    <Card className="mt-6">
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight">Scheduled jobs</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The hourly tick that turns reminders and overdue follow-ups into alerts. A run with no finish time did not complete.
        </p>
        <div className="mt-4">
          {isLoading ? (
            <SkeletonList rows={4} columns={4} />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : !data || data.length === 0 ? (
            <EmptyState title="No runs yet" description="Runs appear here once the scheduler has called the API." />
          ) : (
            <ul className="divide-y divide-border">
              {data.map((r) => (
                <CronRow key={r.id} run={r} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function CronRow({ run }: { run: CronRun }) {
  const finished = !!run.finished_at
  const summary = Object.entries(run.summary)
    .filter(([k]) => k !== 'dry_run')
    .map(([k, v]) => `${humanize(k)} ${String(v)}`)
    .join(' · ')
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
      <span className="w-40 shrink-0 text-muted-foreground">{when.format(new Date(run.started_at))}</span>
      <span className="font-medium">{humanize(run.job_name)}</span>
      <StatusBadge tone={finished ? 'success' : 'danger'}>{finished ? 'Completed' : 'Did not finish'}</StatusBadge>
      {run.dry_run && <StatusBadge tone="neutral">Dry run</StatusBadge>}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary || '—'}</span>
    </li>
  )
}

const LOOKUP_CATEGORIES = [
  { value: 'lead_source', label: 'Lead Sources' },
  { value: 'expense_category', label: 'Expense Categories' },
  { value: 'enquiry_source', label: 'Enquiry Sources' },
  { value: 'enquiry_status', label: 'Enquiry Statuses' },
  { value: 'payment_type', label: 'Payment Types' },
  { value: 'invoice_line_preset', label: 'Invoice Line Presets' },
  { value: 'project_type', label: 'Project Types' },
  { value: 'currency', label: 'Currencies' },
]

function CustomLookups() {
  const [activeCategory, setActiveCategory] = useState('lead_source')
  const [newValue, setNewValue] = useState('')
  const { data: items, isLoading } = useCustomLookups(activeCategory)
  const create = useCreateCustomLookup()
  const update = useUpdateCustomLookup()
  const del = useDeleteCustomLookup()
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)

  function handleAdd() {
    if (!newValue.trim()) return
    create.mutate({ category: activeCategory, value: newValue.trim() }, {
      onSuccess: () => setNewValue(''),
    })
  }

  return (
    <Card className="mt-6">
      <CardContent className="p-4 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold tracking-tight flex items-center gap-2">
              <Settings className="h-4 w-4" /> Custom Lookups
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Manage dropdown values used throughout the app: lead sources, expense categories, and more.
            </p>
          </div>
          <Select value={activeCategory} onChange={(e) => setActiveCategory(e.target.value)} className="w-48">
            {LOOKUP_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </div>

        <div className="mt-4 flex gap-2">
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={`Add a new ${humanize(activeCategory).toLowerCase()}...`}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Button size="sm" onClick={handleAdd} disabled={!newValue.trim() || create.isPending}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <SkeletonList rows={4} columns={3} />
          ) : !items || items.length === 0 ? (
            <EmptyState title="No values yet" description="Add your first lookup value above." />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) =>
                editing?.id === item.id ? (
                  <li key={item.id} className="flex items-center gap-2 py-2">
                    <Input
                      value={editing.value}
                      onChange={(e) => setEditing({ id: item.id, value: e.target.value })}
                      className="h-8"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={() =>
                        update.mutate({ id: item.id, patch: { value: editing.value.trim() } }, { onSuccess: () => setEditing(null) })
                      }
                      disabled={!editing.value.trim() || update.isPending}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </li>
                ) : (
                  <li key={item.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{item.value}</span>
                      <StatusBadge tone={item.is_active ? 'success' : 'neutral'}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditing({ id: item.id, value: item.value })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() => update.mutate({ id: item.id, patch: { is_active: !item.is_active } })}
                      >
                        {item.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => del.mutate(item.id)}
                        disabled={del.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** The service catalog shoots and the project wizard suggest from — a studio's own vocabulary for what it books. */
function Services() {
  const { data: items, isLoading } = useServices()
  const create = useCreateService()
  const update = useUpdateService()
  const del = useDeleteService()
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  function handleAdd() {
    if (!newName.trim()) return
    create.mutate(newName.trim(), { onSuccess: () => setNewName('') })
  }

  return (
    <Card className="mt-6">
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <Settings className="h-4 w-4" /> Services
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Reusable service catalog suggested when scheduling a shoot — Wedding Photography, Pre-wedding, and so on.
        </p>

        <div className="mt-4 flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Wedding Photography"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Button size="sm" onClick={handleAdd} disabled={!newName.trim() || create.isPending}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <SkeletonList rows={4} columns={2} />
          ) : !items || items.length === 0 ? (
            <EmptyState title="No services yet" description="Add your first service above." />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((s) =>
                editing?.id === s.id ? (
                  <li key={s.id} className="flex items-center gap-2 py-2">
                    <Input
                      value={editing.name}
                      onChange={(e) => setEditing({ id: s.id, name: e.target.value })}
                      className="h-8"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={() => update.mutate({ id: s.id, name: editing.name.trim() }, { onSuccess: () => setEditing(null) })}
                      disabled={!editing.name.trim() || update.isPending}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </li>
                ) : (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing({ id: s.id, name: s.name })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => del.mutate(s.id)}
                        disabled={del.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const TONE_OPTIONS: { value: TaskPriorityTone; label: string }[] = [
  { value: 'neutral', label: 'Gray' },
  { value: 'info', label: 'Blue' },
  { value: 'warning', label: 'Amber' },
  { value: 'danger', label: 'Red' },
  { value: 'success', label: 'Green' },
]

/** A studio's own priority labels — "Rush", "Whenever" — shown on tasks instead of the plain Low/Medium/High/Urgent. */
function TaskPriorities() {
  const { data: items, isLoading } = useTaskPriorities()
  const create = useCreateTaskPriority()
  const update = useUpdateTaskPriority()
  const del = useDeleteTaskPriority()
  const [label, setLabel] = useState('')
  const [tone, setTone] = useState<TaskPriorityTone>('neutral')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editTone, setEditTone] = useState<TaskPriorityTone>('neutral')

  function handleAdd() {
    const trimmed = label.trim()
    if (!trimmed) return
    const code = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    create.mutate({ code: code || `p-${Date.now()}`, label: trimmed, tone }, { onSuccess: () => setLabel('') })
  }

  return (
    <Card className="mt-6">
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <Settings className="h-4 w-4" /> Task Priorities
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your own labels for how urgent a task is — shown on tasks instead of the plain Low/Medium/High/Urgent.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Rush"
            className="max-w-xs"
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Select value={tone} onChange={(e) => setTone(e.target.value as TaskPriorityTone)} className="w-32">
            {TONE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
          <Button size="sm" onClick={handleAdd} disabled={!label.trim() || create.isPending}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <SkeletonList rows={3} columns={2} />
          ) : !items || items.length === 0 ? (
            <EmptyState title="No custom priorities yet" description="Tasks show the default Low/Medium/High/Urgent until you add one." />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((p) =>
                editingId === p.id ? (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="h-8 max-w-xs" autoFocus />
                    <Select value={editTone} onChange={(e) => setEditTone(e.target.value as TaskPriorityTone)} className="h-8 w-28">
                      {TONE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      disabled={!editLabel.trim() || update.isPending}
                      onClick={() =>
                        update.mutate(
                          { id: p.id, patch: { label: editLabel.trim(), tone: editTone } },
                          { onSuccess: () => setEditingId(null) },
                        )
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </li>
                ) : (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <StatusBadge tone={p.tone}>{p.label}</StatusBadge>
                    <span className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setEditingId(p.id)
                          setEditLabel(p.label)
                          setEditTone(p.tone)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => del.mutate(p.id)}
                        disabled={del.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const REMINDER_PRESET_DAYS = [14, 7, 3, 1, 0]

/** When a team member gets nudged about work due soon, and how far ahead. */
function WorkReminders() {
  const { data, isLoading } = useWorkReminderSettings()
  const update = useUpdateWorkReminderSettings()
  const runNow = useRunWorkReminders()
  const [enabled, setEnabled] = useState(true)
  const [days, setDays] = useState<number[]>([7, 3, 1])
  const [loaded, setLoaded] = useState(false)

  if (data && !loaded) {
    setEnabled(data.enabled)
    setDays(data.reminder_days)
    setLoaded(true)
  }

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]).sort((a, b) => b - a))
  }

  return (
    <Card className="mt-6">
      <CardContent className="p-4 sm:p-4">
        <h3 className="font-semibold tracking-tight flex items-center gap-2">
          <Settings className="h-4 w-4" /> Work Submission Reminders
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Nudge whoever a task is assigned to before its due date, if nothing has been submitted yet.
        </p>

        {isLoading ? (
          <SkeletonList rows={2} columns={1} className="mt-4" />
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-lg border border-border p-3">
              <Switch checked={enabled} onChange={setEnabled} label="Enable reminders" />
            </div>

            <div>
              <p className="text-sm font-medium">Remind this many days before the due date</p>
              <p className="mt-0.5 text-xs text-muted-foreground">0 means "on the due date".</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {REMINDER_PRESET_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      days.includes(d) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                    }`}
                  >
                    {d === 0 ? 'Due day' : `${d}d before`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              {/* Otherwise the only way to tell whether these settings do
                  anything is to wait for the next hourly tick. */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => runNow.mutate()}
                disabled={runNow.isPending || !enabled}
              >
                {runNow.isPending ? 'Sending…' : 'Send now'}
              </Button>
              <Button
                size="sm"
                onClick={() => update.mutate({ enabled, reminder_days: days })}
                disabled={update.isPending}
              >
                {update.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
