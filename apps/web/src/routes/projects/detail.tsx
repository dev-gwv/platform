import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  Camera,
  CheckSquare,
  CircleCheck,
  Clock,
  FileSignature,
  FileText,
  IndianRupee,
  LayoutGrid,
  Mail,
  Package,
  PauseCircle,
  Pencil,
  Phone,
  Receipt,
  FileCheck,
  MapPin,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { shootListItem, type ProjectStatus, type UpdateProjectRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { QuotationLinkDialog } from '@/features/projects/QuotationLinkDialog'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { useAccess } from '@/shared/auth/useAccess'
import { useConfirm } from '@/shared/ui/confirm'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { formatINR, humanize } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import {
  useDeleteProject,
  useProject,
  useUpdateProject,
} from '@/features/projects/api'
import { EntityReminders } from '@/features/reminders/EntityReminders'
import { ShootsTab } from '@/features/projects/tabs/ShootsTab'
import { CompletedWorkTab } from '@/features/projects/tabs/CompletedWorkTab'
import { TermsTab } from '@/features/projects/tabs/TermsTab'
import { ExpensesTab } from '@/features/projects/tabs/ExpensesTab'
import { TasksTab } from '@/features/projects/tabs/TasksTab'
import { DeliverablesTab } from '@/features/projects/tabs/DeliverablesTab'
import { ReferralCard } from '@/features/projects/ReferralCard'
import { BillingTab, CollectionBar, projectMoney } from '@/features/projects/tabs/BillingTab'
import { DeliverablesSummary } from '@/features/projects/DeliverablesSummary'

/** The tabs across a project. Each one is a view of the same project. */
const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'shoots', label: 'Shoots', icon: Camera },
  { value: 'deliverables', label: 'Deliverables', icon: Package },
  { value: 'completed_work', label: 'Work to review', icon: FileCheck },
  { value: 'terms', label: 'Terms', icon: FileSignature },
  { value: 'billing', label: 'Billing', icon: Wallet },
  { value: 'expenses', label: 'Expenses', icon: Receipt },
  { value: 'tasks', label: 'Tasks', icon: CheckSquare },
] as const
type Tab = (typeof TABS)[number]['value']

const STATUS_TONE: Record<ProjectStatus, 'info' | 'success' | 'danger' | 'warning'> = {
  active: 'info',
  completed: 'success',
  cancelled: 'danger',
  on_hold: 'warning',
}

const STATUS_ICON: Record<ProjectStatus, typeof Clock> = {
  active: Clock,
  completed: CircleCheck,
  cancelled: X,
  on_hold: PauseCircle,
}

const dayFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
const prettyDate = (iso: string) => dayFormat.format(new Date(iso))

const shootsList = shootListItem.array()


export function ProjectDetailPage() {
  return (
    <AuthedPage module="projects">
      <ProjectDetail />
    </AuthedPage>
  )
}

function ProjectDetail() {
  const { id } = useParams({ from: '/authed/projects/$id' })
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useProject(id)
  const access = useAccess()
  const canEdit = access.hasAction('projects', 'edit')
  // The review endpoint is gated on team_work_preview, not projects — a project
  // editor without that permission would see the buttons but get a 403.
  const canReviewWork = access.hasAction('team_work_preview', 'edit')
  // Task status updates are gated on tasks:edit, not projects:edit.
  const canEditTasks = access.hasAction('tasks', 'edit')
  const update = useUpdateProject(id)
  const removeProject = useDeleteProject()
  const confirm = useConfirm()
  // ?tab=deliverables opens straight onto a tab -- My Work links to it.
  const [tab, setTabState] = useState<Tab>(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab')
    // Data now lives on the Shoots tab, beside each person who shot it.
    if (wanted === 'data') return 'shoots'
    return TABS.some((t) => t.value === wanted) ? (wanted as Tab) : 'overview'
  })
  // The tab is kept in the address, so refresh and Back land where you were.
  const setTab = (t: Tab) => {
    setTabState(t)
    const url = new URL(window.location.href)
    if (t === 'overview') url.searchParams.delete('tab')
    else url.searchParams.set('tab', t)
    window.history.replaceState(window.history.state, '', url)
  }
  // Tabs for things this person cannot use are not shown at all.
  const visibleTabs = TABS.filter(
    (t) =>
      (t.value !== 'tasks' || access.hasModule('tasks')) &&
      (t.value !== 'expenses' || access.hasModule('company_expenses')) &&
      (t.value !== 'completed_work' || access.hasModule('team_work_preview')),
  )

  // The shoots' dates give the terms their {{event_date}}. Same query key the
  // Shoots tab uses, so this shares its cache; it sits above the loading guard
  // so the hook count never changes.
  const projectShoots = useQuery({
    queryKey: ['shoots', 'project', id],
    queryFn: () => callApi(`/shoots?project_id=${id}`, { responseSchema: shootsList }),
    enabled: !!id,
    staleTime: 15_000,
  })

  if (isLoading) return <SkeletonCards count={3} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  // Received counts only money that came in; "promised" payments are shown
  // separately and never counted as collected.
  const money = projectMoney(data)
  const received = money.received
  const balance = money.due
  const StatusIcon = STATUS_ICON[data.status]

  async function onDelete() {
    const yes = await confirm({
      title: `Delete ${data?.name ?? 'this project'}?`,
      description:
        'Its shoots, deliverables and tasks go with it. A project with payments recorded cannot be deleted — cancel it instead.',
      confirmLabel: 'Delete project',
      destructive: true,
    })
    if (yes) removeProject.mutate(id, { onSuccess: () => void navigate({ to: '/projects' }) })
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Projects', to: '/projects' },
          { label: data.name },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{data.name}</h1>
            <StatusBadge tone={STATUS_TONE[data.status]}>
              <StatusIcon className="mr-1 size-3" aria-hidden />
              {humanize(data.status)}
            </StatusBadge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Created {prettyDate(data.created_at)}
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Status is one press here rather than buried in the edit dialog:
                it is the field that changes most often. */}
            <Select
              value={data.status}
              onChange={(e) => update.mutate({ status: e.target.value as ProjectStatus })}
              aria-label="Project status"
              className="w-40"
            >
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <EditProjectDialog
              id={id}
              name={data.name}
              status={data.status}
              packageCost={data.package_cost}
              showQuotation={data.show_quotation}
              received={received}
            />
            <Button variant="outline" size="sm" asChild title="Open the full-page editor with live shoot planning">
              <Link to="/projects/$id/edit" params={{ id }}>
                <Pencil /> Full editor
              </Link>
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10"
              disabled={removeProject.isPending}
              onClick={() => void onDelete()}
            >
              <Trash2 /> Delete
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Figure icon={IndianRupee} label="Project value" value={formatINR(data.total_cost)} />
        <Figure icon={CircleCheck} label="Received" value={formatINR(received)} tone="success" />
        <Figure
          icon={Clock}
          label={money.promised > 0 ? `Still to collect · ${formatINR(money.promised)} promised` : 'Still to collect'}
          value={formatINR(balance)}
          tone={balance > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1.5">
        {visibleTabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            aria-current={tab === t.value ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab === t.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
          </button>
        ))}
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Quick actions:
          </span>
          <QuotationLinkDialog projectId={id} />
          <Button variant="ghost" size="sm" asChild>
            <Link to="/projects/$id/quotation" params={{ id }}>
              <FileText /> Preview &amp; edit quotation
            </Link>
          </Button>
        </div>
      )}

      {tab === 'overview' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Project &amp; client</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                <Fact label="Project" value={data.name} />
                <Fact label="Status" value={humanize(data.status)} />
                <Fact label="Created" value={prettyDate(data.created_at)} />
                <Fact label="Client" value={data.client_name ?? '—'} />
                <Fact label="Phone" value={data.client_phone ?? '—'} />
                <Fact label="Email" value={data.client_email ?? '—'} />
              </CardContent>
            </Card>

            <DeliverablesSummary deliverables={data.deliverables} onOpen={() => setTab('deliverables')} />

            <Card>
              <CardHeader className="flex-row items-center justify-between pb-3">
                <CardTitle>Payments</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setTab('billing')}>
                  Open billing
                </Button>
              </CardHeader>
              <CardContent>
                <CollectionBar project={data} onRecord={canEdit ? () => setTab('billing') : undefined} />
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card className="self-start">
              <CardHeader className="pb-3">
                <CardTitle>Client</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium">{data.client_name ?? 'No client on file'}</p>
                {data.client_phone && (
                  <a
                    href={`tel:${data.client_phone}`}
                    className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Phone className="size-3.5" aria-hidden />
                    {data.client_phone}
                  </a>
                )}
                {data.client_email && (
                  <a
                    href={`mailto:${data.client_email}`}
                    className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Mail className="size-3.5" aria-hidden />
                    {data.client_email}
                  </a>
                )}
                {data.client_address && (
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {data.client_address}
                  </p>
                )}
                <Link
                  to="/clients"
                  className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  View client <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </CardContent>
            </Card>

            <ReferralCard projectId={id} projectName={data.name} clientName={data.client_name} clientPhone={data.client_phone} />
            <EntityReminders entityType="project" entityId={id} title="Reminders" />
          </div>
        </div>
      )}

      {tab === 'deliverables' && (
        <DeliverablesTab
          projectId={id}
          deliverables={data.deliverables}
          shoots={(projectShoots.data ?? []).map((s) => ({ id: s.id, name: s.name, shoot_date: s.shoot_date }))}
          canEdit={canEdit}
        />
      )}

      {tab === 'billing' && <BillingTab project={data} canEdit={canEdit} onOpenTab={setTab} />}

      {tab === 'shoots' && <ShootsTab projectId={id} />}
      {tab === 'completed_work' && <CompletedWorkTab projectId={id} canReview={canReviewWork} />}
      {tab === 'terms' && (
        <TermsTab
          canEdit={canEdit}
          project={{
            id,
            name: data.name,
            client_name: data.client_name,
            client_phone: data.client_phone,
            client_email: data.client_email,
            total_cost: data.total_cost,
            event_date: (projectShoots.data ?? []).map((s) => s.shoot_date).filter((d): d is string => !!d).sort()[0] ?? null,
          }}
        />
      )}
      {tab === 'expenses' && <ExpensesTab projectId={id} />}
      {tab === 'tasks' && <TasksTab projectId={id} canEdit={canEditTasks} deliverables={data.deliverables} />}
    </>
  )
}

/** Project value vs money in: collection progress and what's still out. */
function Figure({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock
  label: string
  value: string
  tone?: 'success' | 'warning' | 'info'
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            tone === 'success'
              ? 'bg-success/10 text-success'
              : tone === 'warning'
                ? 'bg-warning/10 text-warning'
                : 'bg-primary/10 text-primary',
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold tabular-nums">{value}</p>
          <p className="truncate text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

/** A label and its value, side by side, the way the reference reads them. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm font-medium">{value}</span>
    </div>
  )
}


function EditProjectDialog({
  id,
  name,
  status,
  packageCost,
  showQuotation,
  received,
}: {
  id: string
  name: string
  status: ProjectStatus
  packageCost: number
  showQuotation: boolean
  received: number
}) {
  const update = useUpdateProject(id)
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const initial = { name, status, package_cost: packageCost, show_quotation: showQuotation }
  const [form, setForm] = useState<UpdateProjectRequest>({ ...initial })
  // Kept separate from `form.package_cost` (a number, for the request body) so
  // the field displays exactly what was typed instead of fighting a
  // type="number" input's leading-zero quirks.
  const [packageCostText, setPackageCostText] = useState(String(packageCost))

  const dirty =
    (form.name ?? '') !== initial.name ||
    form.status !== initial.status ||
    Number(form.package_cost ?? 0) !== initial.package_cost ||
    (form.show_quotation ?? false) !== initial.show_quotation
  const belowReceived = Number(form.package_cost ?? 0) < received

  function reset() {
    setForm({ ...initial })
    setPackageCostText(String(packageCost))
  }

  async function onOpenChange(next: boolean) {
    if (!next && dirty && !update.isPending) {
      const leave = await confirm({
        title: 'Discard unsaved changes?',
        description: 'Your edits to this project have not been saved.',
        confirmLabel: 'Discard',
      })
      if (!leave) return
      reset()
    }
    if (next) {
      setForm({ ...initial })
      setPackageCostText(String(packageCost))
    }
    setOpen(next)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (belowReceived) {
      const yes = await confirm({
        title: `New total is below ${formatINR(received)} already received?`,
        description: 'The package no longer covers the money recorded. Continue anyway?',
        confirmLabel: 'Save anyway',
      })
      if (!yes) return
    }
    await update.mutateAsync(form)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => void onOpenChange(v)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit project">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Package (₹)</Label>
              <Input
                inputMode="decimal"
                value={packageCostText}
                onChange={(e) => {
                  setPackageCostText(e.target.value)
                  setForm({ ...form, package_cost: e.target.value.trim() ? Number(e.target.value) : 0 })
                }}
              />
            </div>
          </div>
          {belowReceived && (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              Received {formatINR(received)} already exceeds this package. Review the Billing tab after saving.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.show_quotation ?? false}
              onChange={(e) => setForm({ ...form, show_quotation: e.target.checked })}
            />
            Show quotation to client
          </label>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
