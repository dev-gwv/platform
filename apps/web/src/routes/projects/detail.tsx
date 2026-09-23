import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowRight,
  Briefcase,
  Camera,
  CheckSquare,
  CircleCheck,
  Clock,
  Database,
  FileSignature,
  FileText,
  Gift,
  IndianRupee,
  LayoutGrid,
  Link2,
  Mail,
  MessageCircle,
  Package,
  PauseCircle,
  Pencil,
  Phone,
  Plus,
  Printer,
  Receipt,
  Eye,
  FileCheck,
  ListChecks,
  MapPin,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { shootListItem, type Deliverable, type DeliverableInput, type DeliverableStatus, type PaymentInput, type ProjectStatus, type UpdateProjectRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { QuotationLinkDialog } from '@/features/projects/QuotationLinkDialog'
import { Breadcrumbs } from '@/shared/layout/breadcrumbs'
import { useAccess } from '@/shared/auth/useAccess'
import { useConfirm } from '@/shared/ui/confirm'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select, Textarea } from '@/shared/ui/input'
import { useCreateTask } from '@/features/tasks/api'
import { MonthlyProfitabilityReport } from '@/features/projects/MonthlyProfitabilityReport'
import { formatINR, humanize } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import {
  useAddDeliverable,
  useAddPayment,
  useDeleteDeliverable,
  useDeletePayment,
  useDeleteProject,
  useProject,
  useSetDeliverableSources,
  useUpdateDeliverable,
  useUpdateProject,
  useUpdateQuotation,
} from '@/features/projects/api'
import { useReferralCampaigns, useReferralSubmissions } from '@/features/referrals/api'
import { useProjectFinancials } from '@/features/financials/api'
import { EntityReminders } from '@/features/reminders/EntityReminders'
import { ShootsTab } from '@/features/projects/tabs/ShootsTab'
import { CompletedWorkTab } from '@/features/projects/tabs/CompletedWorkTab'
import { TermsTab } from '@/features/projects/tabs/TermsTab'
import { ExpensesTab } from '@/features/projects/tabs/ExpensesTab'
import { TasksTab } from '@/features/projects/tabs/TasksTab'
import { DataTab } from '@/features/projects/tabs/DataTab'

/** The tabs across a project. Each one is a view of the same project. */
const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'shoots', label: 'Shoots', icon: Camera },
  { value: 'deliverables', label: 'Deliverables', icon: Package },
  { value: 'completed_work', label: 'Completed Work', icon: FileCheck },
  { value: 'terms', label: 'Terms', icon: FileSignature },
  { value: 'billing', label: 'Billing', icon: Wallet },
  { value: 'expenses', label: 'Expenses', icon: Receipt },
  { value: 'tasks', label: 'Tasks', icon: CheckSquare },
  { value: 'data', label: 'Data', icon: Database },
  { value: 'referrals', label: 'Referrals', icon: Gift },
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

const DELIVERABLE_STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'danger',
}

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
  const del = useDeleteDeliverable(id)
  const updateDeliverable = useUpdateDeliverable(id)
  const setDeliverableSources = useSetDeliverableSources(id)
  const update = useUpdateProject(id)
  const updateQuotation = useUpdateQuotation(id)
  const removeProject = useDeleteProject()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('overview')
  const [groupByShoot, setGroupByShoot] = useState(false)

  /**
   * The month the Allocation action should open on. Same query key the Shoots
   * tab uses, so this shares its cache rather than fetching again — and it has
   * to sit above the loading guard, or the hook count changes once the project
   * resolves.
   */
  const projectShoots = useQuery({
    queryKey: ['shoots', 'project', id],
    queryFn: () => callApi(`/shoots?project_id=${id}`, { responseSchema: shootsList }),
    enabled: !!id,
    staleTime: 15_000,
  })
  const allocationSearch = (() => {
    const dates = (projectShoots.data ?? [])
      .map((s) => s.shoot_date)
      .filter((d): d is string => !!d)
      .sort()
    // Prefer the next one still ahead; fall back to the first, so a finished
    // project still opens somewhere with its work on screen.
    const today = new Date().toISOString().slice(0, 10)
    const pick = dates.find((d) => d >= today) ?? dates[0]
    return pick ? { month: pick.slice(0, 7) } : {}
  })()

  if (isLoading) return <SkeletonCards count={3} />
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />

  const received = data.payments.reduce((s, p) => s + p.amount, 0)
  const balance = Math.max(0, data.total_cost - received)
  const StatusIcon = STATUS_ICON[data.status]

  async function removeDeliverable(dId: string, title: string) {
    if (await confirm({ title: `Remove "${title}"?`, destructive: true, confirmLabel: 'Remove' })) {
      del.mutate(dId)
    }
  }

  async function onDelete() {
    const yes = await confirm({
      title: `Delete ?`,
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

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure icon={IndianRupee} label="Total cost" value={formatINR(data.total_cost)} />
        <Figure icon={CircleCheck} label="Received" value={formatINR(received)} tone="success" />
        <Figure icon={Clock} label="Pending payments" value={formatINR(balance)} tone="warning" />
        <Figure icon={Briefcase} label="Balance" value={formatINR(balance)} tone="info" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1.5">
        {TABS.map((t) => (
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
              <FileText /> Staff quotation
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            {/* Carries the month of this project's first shoot, so the calendar
                opens where the work actually is. */}
            <Link to="/team-allocation" search={allocationSearch}>
              <Users /> Allocation
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/referrals">
              <Gift /> Refer &amp; Earn
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

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Financial snapshot</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-2 text-sm">
                  <Money label="Package cost" value={data.package_cost} />
                  <Money label="Additional" value={data.additional_deliverables_cost} />
                  <Money label="Total project value" value={data.total_cost} accent />
                  <Money label="Received" value={received} />
                  <Money label="Balance due" value={balance} accent />
                </dl>
                {canEdit && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <AddPaymentDialog id={id} balance={balance} />
                    <Button variant="outline" size="sm" onClick={() => setTab('billing')}>
                      <FileText /> View payments
                    </Button>
                  </div>
                )}
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

            <EntityReminders entityType="project" entityId={id} title="Reminders" />
          </div>
        </div>
      )}

      {tab === 'deliverables' && (
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="tablist" aria-label="Deliverables view">
            <button
              type="button"
              role="tab"
              aria-selected={!groupByShoot}
              onClick={() => setGroupByShoot(false)}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition-colors',
                !groupByShoot ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              By scope
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={groupByShoot}
              onClick={() => setGroupByShoot(true)}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition-colors',
                groupByShoot ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              title="Group every deliverable under its shoot"
            >
              Grouped by shoot
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {groupByShoot ? 'Client + internal together under each shoot.' : 'Client vs internal lists.'}
          </p>
        </div>
        {groupByShoot ? (
          <DeliverablesByShoot
            projectId={id}
            items={data.deliverables}
            canEdit={canEdit}
            updateDeliverable={updateDeliverable}
            setDeliverableSources={setDeliverableSources}
            onRemove={removeDeliverable}
          />
        ) : (
        <>
        <DeliverableGroup
          projectId={id}
          title="Client Deliverables"
          description="Shown on quotation and promised to the client."
          scope="client"
          items={data.deliverables.filter((d) => d.visibility_scope === 'client')}
          canEdit={canEdit}
          updateDeliverable={updateDeliverable}
          setDeliverableSources={setDeliverableSources}
          onRemove={removeDeliverable}
        />
        <DeliverableGroup
          projectId={id}
          title="Internal Work"
          description="Your team's own work items — never shown to the client."
          scope="internal"
          items={data.deliverables.filter((d) => d.visibility_scope === 'internal')}
          canEdit={canEdit}
          updateDeliverable={updateDeliverable}
          setDeliverableSources={setDeliverableSources}
          onRemove={removeDeliverable}
        />
        </>
        )}
      </div>
      )}

      {tab === 'billing' && (
      <div className="mt-4 flex flex-col gap-4">
        <ProfitabilityPanel
          projectId={id}
          packageCost={data.package_cost}
          addOns={data.additional_deliverables_cost}
          total={data.total_cost}
          received={received}
          balance={balance}
        />
        {/* What the project cost to run, not just what came in. */}
        <MonthlyProfitabilityReport projectId={id} bookedRevenue={data.total_cost} />

        {/* The quotation lived only behind a Quick action, so whether the
            client could currently see it was invisible from the tab that is
            about this project's money. */}
        <Card>
          <CardContent className="p-4 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold tracking-tight">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  Quotation
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  A printable quotation built from this project&apos;s details, deliverables and shoots.
                </p>
              </div>
              <StatusBadge tone={data.show_quotation ? 'success' : 'neutral'}>
                {data.show_quotation ? 'Visible to client' : 'Hidden from client'}
              </StatusBadge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {canEdit && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={data.show_quotation}
                    onChange={(e) => updateQuotation.mutate({ show_quotation: e.target.checked })}
                  />
                  Show quotation to client
                </label>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link to="/projects/$id/quotation" params={{ id }}>
                  <FileText /> Open quotation
                </Link>
              </Button>
            </div>
            {!data.show_quotation && (
              <p className="mt-2 text-xs text-muted-foreground">
                The public link shows a &ldquo;hidden by the studio&rdquo; notice until this is switched on.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Payments</CardTitle>
            {canEdit && <AddPaymentDialog id={id} balance={balance} />}
          </CardHeader>
          <CardContent>
            {data.payments.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Record an advance or an instalment and the balance updates here."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {data.payments.map((p) => (
                  <PaymentRow
                    key={p.id}
                    projectId={id}
                    projectName={data.name}
                    clientName={data.client_name}
                    clientPhone={data.client_phone}
                    payment={p}
                    canEdit={canEdit}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      {tab === 'shoots' && <ShootsTab projectId={id} onOpenData={() => setTab('data')} />}
      {tab === 'completed_work' && <CompletedWorkTab projectId={id} canReview={canReviewWork} />}
      {tab === 'terms' && <TermsTab projectId={id} canEdit={canEdit} />}
      {tab === 'expenses' && <ExpensesTab projectId={id} />}
      {tab === 'tasks' && <TasksTab projectId={id} canEdit={canEditTasks} />}
      {tab === 'data' && <DataTab projectId={id} canEdit={canEdit} />}
      {tab === 'referrals' && <ReferralsTab projectId={id} projectName={data.name} clientName={data.client_name} />}
    </>
  )
}

/** Project value vs money in: collection progress and what's still out. */
function ProfitabilityPanel({
  projectId,
  packageCost,
  addOns,
  total,
  received,
  balance,
}: {
  projectId: string
  packageCost: number
  addOns: number
  total: number
  received: number
  balance: number
}) {
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
  // True margin once team payouts and company expenses are booked: the
  // project_financials view's cost summary for this project, when the
  // financials module is available to this user.
  const { data: financials } = useProjectFinancials()
  const costs = financials?.find((f) => f.project_id === projectId)
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Profitability</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          <Money label="Package cost" value={packageCost} />
          <Money label="Additional deliverables" value={addOns} />
          <Money label="Total project value" value={total} accent />
          <Money label="Total received" value={received} accent />
          <Money label="Balance pending" value={balance} />
        </dl>
        {costs && (
          <>
            <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cost summary
            </p>
            <dl className="flex flex-col gap-2 text-sm">
              <Money label="Revenue" value={costs.revenue} />
              <Money label="Direct team cost" value={costs.direct_team_cost} />
              <Money label="Project expenses" value={costs.project_expenses} />
              <Money label="Gross profit" value={costs.gross_profit} accent />
            </dl>
          </>
        )}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Collected</span>
            <span className="font-medium tabular-nums">{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Collection progress">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Gross margin before team payouts and company expenses. Price team work in the Shoots tab so payouts stay inside this total.
        </p>
      </CardContent>
    </Card>
  )
}

type DetailPayment = {
  id: string
  amount: number
  paid_on: string
  mode: string | null
  reference: string | null
  status: string | null
  description: string | null
  is_gst: boolean
  gst_number: string | null
}

function receiptText(projectName: string, clientName: string | null, p: DetailPayment): string {
  const lines = [
    `Payment receipt — ${projectName}`,
    clientName ? `Client: ${clientName}` : null,
    `Amount: ${formatINR(p.amount)}`,
    `Date: ${p.paid_on}`,
    p.mode ? `Mode: ${p.mode}` : null,
    p.reference ? `Reference: ${p.reference}` : null,
    p.status ? `Status: ${p.status}` : null,
    p.is_gst ? `GST invoice${p.gst_number ? ` (${p.gst_number})` : ''}` : null,
    p.description ? `Note: ${p.description}` : null,
  ]
  return lines.filter(Boolean).join('\n')
}

/** One payment with receipt actions: view, print, email, WhatsApp, delete. */
function PaymentRow({
  projectId,
  projectName,
  clientName,
  clientPhone,
  payment: p,
  canEdit,
}: {
  projectId: string
  projectName: string
  clientName: string | null
  clientPhone: string | null
  payment: DetailPayment
  canEdit: boolean
}) {
  const del = useDeletePayment(projectId)
  const confirm = useConfirm()
  const [viewOpen, setViewOpen] = useState(false)
  const digits = (clientPhone ?? '').replace(/\D/g, '')

  async function onDelete() {
    const yes = await confirm({
      title: `Delete this ${formatINR(p.amount)} payment?`,
      description: 'The balance updates immediately. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete payment',
    })
    if (yes) del.mutate(p.id)
  }

  function onWhatsApp() {
    if (!digits) {
      toast.error('Add a client phone number to send this receipt on WhatsApp.')
      return
    }
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(receiptText(projectName, clientName, p))}`, '_blank', 'noopener,noreferrer')
  }

  function onEmail() {
    const body = encodeURIComponent(receiptText(projectName, clientName, p))
    const subject = encodeURIComponent(`Payment receipt — ${projectName} — ${formatINR(p.amount)}`)
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{formatINR(p.amount)}</p>
        <p className="text-xs text-muted-foreground">
          {p.paid_on}
          {p.mode ? ` · ${p.mode}` : ''}
          {p.reference ? ` · ${p.reference}` : ''}
          {p.description ? ` · ${p.description}` : ''}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          <StatusBadge tone={p.status === 'pending' ? 'warning' : 'success'}>
            {p.status === 'pending' ? 'Pending' : 'Paid'}
          </StatusBadge>
          {p.is_gst && <StatusBadge tone="info">GST{p.gst_number ? ` ${p.gst_number}` : ''}</StatusBadge>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="icon" title="View receipt" aria-label="View receipt" onClick={() => setViewOpen(true)}>
          <Eye />
        </Button>
        <Button variant="ghost" size="icon" title="Print receipt" aria-label="Print receipt" onClick={() => setViewOpen(true)}>
          <Printer />
        </Button>
        <Button variant="ghost" size="icon" title="Email receipt" aria-label="Email receipt" onClick={onEmail}>
          <Mail />
        </Button>
        <Button variant="ghost" size="icon" title="WhatsApp receipt" aria-label="WhatsApp receipt" onClick={onWhatsApp} className="text-success">
          <MessageCircle />
        </Button>
        {canEdit && (
          <Button variant="ghost" size="icon" title="Delete payment" aria-label="Delete payment" className="text-destructive" onClick={() => void onDelete()}>
            <Trash2 />
          </Button>
        )}
      </div>
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent
          className="paper"
          title={`Receipt — ${formatINR(p.amount)}`}
          description={`${projectName}${clientName ? ` · ${clientName}` : ''}`}
        >
          <dl className="flex flex-col gap-2 text-sm">
            <Money label="Amount" value={p.amount} accent />
            <Fact label="Date" value={p.paid_on} />
            <Fact label="Mode" value={p.mode ?? '—'} />
            <Fact label="Reference" value={p.reference ?? '—'} />
            <Fact label="Status" value={p.status === 'pending' ? 'Pending' : 'Paid'} />
            <Fact label="GST" value={p.is_gst ? `Yes${p.gst_number ? ` (${p.gst_number})` : ''}` : 'No'} />
            {p.description && <Fact label="Note" value={p.description} />}
          </dl>
          {/* The buttons are part of the dialog, so they are inside `paper`
              and would print on the receipt. `paper-toolbar` drops them. */}
          <div className="paper-toolbar mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onEmail}>
              <Mail /> Email
            </Button>
            <Button variant="outline" size="sm" onClick={onWhatsApp}>
              <MessageCircle /> WhatsApp
            </Button>
            <Button size="sm" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  )
}

/** Deliverables grouped under their shoot instead of split by scope. */
function DeliverablesByShoot({
  projectId,
  items,
  canEdit,
  updateDeliverable,
  setDeliverableSources,
  onRemove,
}: {
  projectId: string
  items: Deliverable[]
  canEdit: boolean
  updateDeliverable: ReturnType<typeof useUpdateDeliverable>
  setDeliverableSources: ReturnType<typeof useSetDeliverableSources>
  onRemove: (deliverableId: string, title: string) => void
}) {
  const groups = new Map<string, { name: string; items: Deliverable[] }>()
  const unlinked: Deliverable[] = []
  for (const d of items) {
    const first = d.source_shoots[0]
    if (!first) {
      unlinked.push(d)
      continue
    }
    const g = groups.get(first.id) ?? { name: first.name, items: [] }
    g.items.push(d)
    groups.set(first.id, g)
  }
  if (items.length === 0) {
    return <EmptyState title="No deliverables yet" description="Add what the client receives and what the team must produce." />
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups.values()].map((g) => (
        <Card key={g.name}>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Camera className="size-4" aria-hidden /> {g.name}
                <StatusBadge tone="neutral">{g.items.length}</StatusBadge>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {g.items.map((d) => (
                <ShootGroupedRow
                  key={d.id}
                  projectId={projectId}
                  d={d}
                  canEdit={canEdit}
                  updateDeliverable={updateDeliverable}
                  setDeliverableSources={setDeliverableSources}
                  onRemove={onRemove}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      {unlinked.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4" aria-hidden /> Project-level (unlinked)
              <StatusBadge tone="neutral">{unlinked.length}</StatusBadge>
            </CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">Not waiting on any specific shoot.</p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {unlinked.map((d) => (
                <ShootGroupedRow
                  key={d.id}
                  projectId={projectId}
                  d={d}
                  canEdit={canEdit}
                  updateDeliverable={updateDeliverable}
                  setDeliverableSources={setDeliverableSources}
                  onRemove={onRemove}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ShootGroupedRow({
  projectId,
  d,
  canEdit,
  updateDeliverable,
  setDeliverableSources,
  onRemove,
}: {
  projectId: string
  d: Deliverable
  canEdit: boolean
  updateDeliverable: ReturnType<typeof useUpdateDeliverable>
  setDeliverableSources: ReturnType<typeof useSetDeliverableSources>
  onRemove: (deliverableId: string, title: string) => void
}) {
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{d.title}</p>
        <StatusBadge tone={DELIVERABLE_STATUS_TONE[d.status] ?? 'neutral'}>{humanize(d.status)}</StatusBadge>
        <StatusBadge tone={d.visibility_scope === 'client' ? 'info' : 'neutral'}>
          {d.visibility_scope === 'client' ? 'Client deliverable' : 'Internal work'}
        </StatusBadge>
        <StatusBadge tone={d.show_on_quotation ? 'success' : 'neutral'}>
          {d.show_on_quotation ? 'Shown on quotation' : 'Internal only'}
        </StatusBadge>
        {d.is_additional_charge && <span className="text-sm font-medium">{formatINR(d.additional_charge_amount)}</span>}
      </div>
      {d.source_shoots.length > 1 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">Sources:</span>
          {d.source_shoots.map((s) => (
            <StatusBadge key={s.id} tone="neutral">{s.name}</StatusBadge>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={d.estimated_date ?? ''}
          disabled={!canEdit}
          onChange={(e) => updateDeliverable.mutate({ deliverableId: d.id, patch: { estimated_date: e.target.value || null } })}
          className="w-40"
          aria-label={`Estimated delivery for ${d.title}`}
        />
        <Select
          value={d.status}
          disabled={!canEdit}
          onChange={(e) => updateDeliverable.mutate({ deliverableId: d.id, patch: { status: e.target.value as DeliverableStatus } })}
          className="w-36"
          aria-label={`Status for ${d.title}`}
        >
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        {canEdit && <EditDeliverableDialog id={projectId} deliverable={d} />}
        {canEdit && <LinkedShootsDialog projectId={projectId} deliverable={d} setDeliverableSources={setDeliverableSources} />}
        {canEdit && (
          <Button variant="ghost" size="icon" onClick={() => onRemove(d.id, d.title)}>
            <Trash2 />
          </Button>
        )}
      </div>
    </li>
  )
}

/** Referrals for this project: active campaigns plus a share-ready message. */
function ReferralsTab({ projectId, projectName, clientName }: { projectId: string; projectName: string; clientName: string | null }) {
  void projectId
  const { data, isLoading } = useReferralCampaigns()
  const campaigns = data?.campaigns ?? []
  const [pickedId, setPickedId] = useState('')
  const campaign = campaigns.find((c) => c.id === pickedId) ?? campaigns[0]
  const submissions = useReferralSubmissions(campaign?.id)
  const received = submissions.data?.pages.flatMap((pg) => pg.items) ?? []

  /**
   * The share link needs the campaign's slug on the end. It used to build
   * `/refer/` and append `first ? '' : ''` — a no-op — so every message a
   * studio copied from here carried a link that went nowhere.
   */
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = campaign ? `${origin}/refer/${campaign.slug}` : null
  const shareText = shareUrl
    ? `Hi ${clientName ?? 'there'}! Loved working on ${projectName} with you. If anyone you know is looking for a photo/video team, please share this link: ${shareUrl}`
    : ''

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Gift className="size-4" aria-hidden /> Refer &amp; earn
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Ask {clientName ?? 'the client'} to send new bookings your way after {projectName}.
          </p>

          {campaigns.length > 1 && (
            <label className="mt-3 flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground">Campaign to share</span>
              <Select value={campaign?.id ?? ''} onChange={(e) => setPickedId(e.target.value)} className="max-w-xs">
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>
          )}

          {campaign && (
            <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                The reward
              </p>
              <p className="mt-1 font-medium">
                {campaign.reward_title ??
                  (campaign.reward_type === 'percentage'
                    ? `${campaign.reward_value}% off`
                    : formatINR(campaign.reward_value))}
              </p>
              {campaign.reward_description && (
                <p className="text-muted-foreground">{campaign.reward_description}</p>
              )}
              {shareUrl && (
                <code className="mt-2 block truncate rounded bg-card px-2 py-1 font-mono text-xs">{shareUrl}</code>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!shareUrl}
              onClick={() => {
                void navigator.clipboard?.writeText(shareText)
                toast.success('Referral message copied')
              }}
            >
              <Link2 /> Copy referral message
            </Button>
            <Button variant="outline" size="sm" disabled={!shareUrl} asChild={!!shareUrl}>
              {shareUrl ? (
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <MessageCircle /> WhatsApp
                </a>
              ) : (
                <span>WhatsApp</span>
              )}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/referrals">
                <Gift /> Edit reward
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Active campaigns ({isLoading ? '…' : campaigns.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading campaigns…</p>
          ) : campaigns.length === 0 ? (
            <EmptyState title="No referral campaigns yet" description="Create one on the referrals page, then share it from here." />
          ) : (
            <ul className="flex flex-col gap-2">
              {campaigns.slice(0, 5).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <Button variant="ghost" size="sm" asChild>
                    <Link to="/referrals">Open</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Whether the ask actually worked. Sharing a link and never seeing what
          came back is why referral schemes quietly die. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Referrals received{campaign ? ` — ${campaign.name}` : ''}</CardTitle>
        </CardHeader>
        <CardContent>
          {!campaign ? (
            <p className="text-sm text-muted-foreground">Create a campaign to start collecting referrals.</p>
          ) : submissions.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : received.length === 0 ? (
            <EmptyState
              title="Nobody yet"
              description="Send the link above to this client — anyone who fills it in shows up here."
            />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {received.slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.client_name ?? 'Unnamed'}</span>
                  {r.referrer_name && (
                    <span className="text-xs text-muted-foreground">via {r.referrer_name}</span>
                  )}
                  <StatusBadge tone={r.status === 'converted' ? 'success' : 'neutral'}>{r.status}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** One figure in the strip under the header: icon tile, number, label. */
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

function Money({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', accent ? 'font-semibold text-primary' : 'font-medium')}>
        {formatINR(value)}
      </dd>
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

function DeliverableGroup({
  projectId,
  title,
  description,
  scope,
  items,
  canEdit,
  updateDeliverable,
  setDeliverableSources,
  onRemove,
}: {
  projectId: string
  title: string
  description: string
  scope: 'client' | 'internal'
  items: Deliverable[]
  canEdit: boolean
  updateDeliverable: ReturnType<typeof useUpdateDeliverable>
  setDeliverableSources: ReturnType<typeof useSetDeliverableSources>
  onRemove: (deliverableId: string, title: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            {title}
            <StatusBadge tone="neutral">{items.length}</StatusBadge>
          </CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        {canEdit && (
          <AddDeliverableDialog
            id={projectId}
            defaultVisibility={scope}
            label={scope === 'client' ? 'Add client deliverable' : 'Add internal work'}
          />
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            title={scope === 'client' ? 'No client deliverables yet' : 'No internal work yet'}
            description={
              scope === 'client'
                ? 'List what the client receives — the album, the film, the reel. Chargeable ones add to the project total.'
                : "Track your team's own work items here — they never reach the client."
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((d) => (
              <li key={d.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{d.title}</p>
                  <StatusBadge tone={DELIVERABLE_STATUS_TONE[d.status] ?? 'neutral'}>
                    {humanize(d.status)}
                  </StatusBadge>
                  <StatusBadge tone={d.visibility_scope === 'client' ? 'info' : 'neutral'}>
                    {d.visibility_scope === 'client' ? 'Client deliverable' : 'Internal work'}
                  </StatusBadge>
                  <StatusBadge tone={d.show_on_quotation ? 'success' : 'neutral'}>
                    {d.show_on_quotation ? 'Shown on quotation' : 'Internal only'}
                  </StatusBadge>
                  {d.is_additional_charge && (
                    <span className="text-sm font-medium">{formatINR(d.additional_charge_amount)}</span>
                  )}
                </div>
                {d.source_shoots.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide">Sources:</span>
                    {d.source_shoots.map((s) => (
                      <StatusBadge key={s.id} tone="neutral">
                        {s.name}
                      </StatusBadge>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={d.estimated_date ?? ''}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDeliverable.mutate({
                        deliverableId: d.id,
                        patch: { estimated_date: e.target.value || null },
                      })
                    }
                    className="w-40"
                    aria-label={`Estimated delivery for ${d.title}`}
                  />
                  <Select
                    value={d.status}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDeliverable.mutate({
                        deliverableId: d.id,
                        patch: { status: e.target.value as DeliverableStatus },
                      })
                    }
                    className="w-36"
                    aria-label={`Status for ${d.title}`}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateDeliverable.mutate({
                          deliverableId: d.id,
                          patch: { visibility_scope: scope === 'client' ? 'internal' : 'client' },
                        })
                      }
                    >
                      {scope === 'client' ? 'To internal' : 'To client'}
                    </Button>
                  )}
                  {canEdit && <CreateTaskForDeliverable projectId={projectId} deliverable={d} />}
                  {canEdit && <EditDeliverableDialog id={projectId} deliverable={d} />}
                  {canEdit && (
                    <LinkedShootsDialog
                      projectId={projectId}
                      deliverable={d}
                      setDeliverableSources={setDeliverableSources}
                    />
                  )}
                  {canEdit && (
                    <Button variant="ghost" size="icon" onClick={() => onRemove(d.id, d.title)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Turn one deliverable into a task someone owns.
 *
 * Generating tasks existed only for a whole project at once, from the Tasks
 * page — so the answer to "who is cutting the highlight film" was to generate
 * tasks for everything and then delete the ones you did not want. The old app
 * puts an Assign Task action on each row; this is that, pre-linked to the
 * deliverable so the task and the thing it delivers stay connected.
 */
function CreateTaskForDeliverable({
  projectId,
  deliverable,
}: {
  projectId: string
  deliverable: Deliverable
}) {
  const create = useCreateTask()
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={create.isPending || done}
      title={`Create a task for ${deliverable.title}`}
      onClick={() =>
        create.mutate(
          {
            title: deliverable.title,
            project_id: projectId,
            deliverable_id: deliverable.id,
            status: 'to_do',
            priority: 'medium',
            assignees: [],
            ...(deliverable.description ? { description: deliverable.description } : {}),
            ...(deliverable.estimated_date ? { due_date: deliverable.estimated_date } : {}),
          },
          { onSuccess: () => setDone(true) },
        )
      }
    >
      <ListChecks /> {done ? 'Task created' : 'Create task'}
    </Button>
  )
}

const shootsList = shootListItem.array()

/** Pick which of this project's shoots a deliverable is waiting on data from. */
function LinkedShootsDialog({
  projectId,
  deliverable,
  setDeliverableSources,
}: {
  projectId: string
  deliverable: Deliverable
  setDeliverableSources: ReturnType<typeof useSetDeliverableSources>
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set(deliverable.source_shoots.map((s) => s.id)))
  const shoots = useQuery({
    queryKey: ['shoots', 'project', projectId],
    queryFn: () => callApi(`/shoots?project_id=${projectId}`, { responseSchema: shootsList }),
    enabled: open,
  })

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function onSave() {
    await setDeliverableSources.mutateAsync({ deliverableId: deliverable.id, shoot_ids: [...selected] })
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setSelected(new Set(deliverable.source_shoots.map((s) => s.id)))
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Link2 /> Linked shoots
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Linked shoots"
        description={`Which shoots is "${deliverable.title}" waiting on data from?`}
      >
        <div className="flex flex-col gap-3">
          {shoots.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading shoots…</p>
          ) : !shoots.data || shoots.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">This project has no shoots yet.</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {shoots.data.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 rounded-md p-2 hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="size-4"
                    />
                    <span className="text-sm">
                      {s.name}
                      {s.shoot_date && <span className="ml-1.5 text-xs text-muted-foreground">{s.shoot_date}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={() => void onSave()} disabled={setDeliverableSources.isPending}>
              {setDeliverableSources.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AddDeliverableDialog({
  id,
  defaultVisibility = 'client',
  label = 'Add',
}: {
  id: string
  defaultVisibility?: 'client' | 'internal'
  label?: string
}) {
  const add = useAddDeliverable(id)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [charge, setCharge] = useState(false)
  const [amount, setAmount] = useState('')
  const [workType, setWorkType] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [brief, setBrief] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body: DeliverableInput = {
      title: title.trim(),
      list_key: 'primary',
      is_additional_charge: charge,
      additional_charge_amount: charge ? Number(amount) || 0 : 0,
      visibility_scope: defaultVisibility,
      // Internal work is never shown on the client's quotation by definition.
      show_on_quotation: defaultVisibility === 'client',
      start_rule: 'whole_project',
      ...(workType.trim() ? { work_type: workType.trim() } : {}),
      ...(internalNotes.trim() ? { internal_notes: internalNotes.trim() } : {}),
      ...(brief.trim() ? { description: brief.trim() } : {}),
    }
    await add.mutateAsync(body)
    setOpen(false)
    setTitle('')
    setCharge(false)
    setAmount('')
    setWorkType('')
    setInternalNotes('')
    setBrief('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={defaultVisibility === 'client' ? 'Add client deliverable' : 'Add internal work'}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Work type (optional)</Label>
            <Input value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="e.g. Editing, Album design" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
            Additional charge
          </label>
          {charge && (
            <div className="flex flex-col gap-1.5">
              <Label>Amount (₹)</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Brief (optional)</Label>
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              placeholder="What this is, and what done looks like — the editor reads this."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Internal notes (optional)</Label>
            <Textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              placeholder="Never shown to the client"
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditDeliverableDialog({ id, deliverable }: { id: string; deliverable: Deliverable }) {
  const update = useUpdateDeliverable(id)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(deliverable.title)
  const [charge, setCharge] = useState(deliverable.is_additional_charge)
  const [amount, setAmount] = useState(String(deliverable.additional_charge_amount ?? ''))
  const [showOnQuotation, setShowOnQuotation] = useState(deliverable.show_on_quotation)
  const [workType, setWorkType] = useState(deliverable.work_type ?? '')
  const [internalNotes, setInternalNotes] = useState(deliverable.internal_notes ?? '')
  /**
   * What this deliverable actually is, in the studio's words. `description`
   * has been on the deliverable and in the contract all along and no form
   * asked for it — the old app puts an "Add brief" action right on the row.
   */
  const [brief, setBrief] = useState(deliverable.description ?? '')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    await update.mutateAsync({
      deliverableId: deliverable.id,
      patch: {
        title: title.trim(),
        is_additional_charge: charge,
        additional_charge_amount: charge ? Number(amount) || 0 : 0,
        show_on_quotation: showOnQuotation,
        work_type: workType.trim() || null,
        internal_notes: internalNotes.trim() || null,
        description: brief.trim() || null,
      },
    })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Edit">
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit deliverable">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Work type (optional)</Label>
            <Input value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="e.g. Editing, Album design" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />
            Additional charge
          </label>
          {charge && (
            <div className="flex flex-col gap-1.5">
              <Label>Amount (₹)</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showOnQuotation} onChange={(e) => setShowOnQuotation(e.target.checked)} />
            Show on quotation
          </label>
          <div className="flex flex-col gap-1.5">
            <Label>Brief (optional)</Label>
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              placeholder="What this is, and what done looks like — the editor reads this."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Internal notes (optional)</Label>
            <Textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              placeholder="Never shown to the client"
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddPaymentDialog({ id, balance }: { id: string; balance: number }) {
  const add = useAddPayment(id)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(balance))
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState('upi')
  const [reference, setReference] = useState('')
  const [status, setStatus] = useState<'paid' | 'pending'>('paid')
  const [description, setDescription] = useState('')
  const [isGst, setIsGst] = useState(false)
  const [gstNumber, setGstNumber] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const body: PaymentInput = {
      amount: Number(amount) || 0,
      paid_on: paidOn || undefined,
      ...(mode.trim() ? { mode: mode.trim() } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(status !== 'paid' ? { status } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(isGst ? { is_gst: true } : {}),
      ...(gstNumber.trim() ? { gst_number: gstNumber.trim() } : {}),
    }
    await add.mutateAsync(body)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IndianRupee /> Record
        </Button>
      </DialogTrigger>
      <DialogContent title="Record payment" description={`Balance ${formatINR(balance)}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Amount</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Mode</Label>
              <Input value={mode} onChange={(e) => setMode(e.target.value)} placeholder="upi / cash / bank" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as 'paid' | 'pending')}>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Reference (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Advance, final settlement…" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isGst} onChange={(e) => setIsGst(e.target.checked)} />
            GST invoice
          </label>
          {isGst && (
            <div className="flex flex-col gap-1.5">
              <Label>GST number</Label>
              <Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="e.g. 27ABCDE1234F1Z5" />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
