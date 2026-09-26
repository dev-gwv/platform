import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Ban, Bell, CalendarDays, CheckCircle2, Clock, ExternalLink, Layers, Mic, Pencil, Send } from 'lucide-react'
import { WORK_STATUS_LABEL, shootListItem, workSubmission, type TaskListItem, type TaskStatus, type WorkSubmission } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { ErrorState, EmptyState } from '@/shared/ui/states'
import { useMyTasks, useUpdateMyTaskStatus } from '@/features/tasks/api'
import { assigneeStatusOptions } from '@/features/tasks/delegation'
import { useProjects } from '@/features/projects/api'
import { useRevokeDelivery, useWorkReminderSettings } from '@/features/work/api'
import { SendWorkToClientDialog } from '@/features/work/SendWorkToClientDialog'
import { MyDeliverables } from '@/features/projects/MyDeliverables'
import { StartNowCard } from '@/features/projects/StartNowCard'
import { SubmitWorkDialog as SubmitDialog } from '@/features/work/SubmitWorkDialog'
import { useConfirm } from '@/shared/ui/confirm'
import { STATUS_LABEL, todayISO } from '@/features/tasks/board'

const list = workSubmission.array()
const shootsList = shootListItem.array()
const TONE = { submitted: 'warning', approved: 'success', rejected: 'danger', sent: 'success' } as const

type SortKey = 'due_asc' | 'due_desc' | 'recent' | 'priority'
type StatusFilter = 'all' | TaskStatus | 'pending_review'

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

function useMySubmissions() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['work', 'submissions', 'mine'],
    // Only mine, even for someone allowed to see everyone's.
    queryFn: () => callApi('/work/submissions?mine=1', { responseSchema: list }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

function useMyShoots() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['shoots', 'my'],
    queryFn: () => callApi('/shoots/my', { responseSchema: shootsList }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

export function MyWorkPage() {
  return (
    // Your own work is yours to see, whatever modules the studio has on --
    // the same as My Tasks, which has no gate.
    <>
      <MyWork />
    </>
  )
}

interface TaskRow {
  task: TaskListItem
  submission: WorkSubmission | null
}

function MyWork() {
  const today = todayISO()
  const tasksQ = useMyTasks()
  const subsQ = useMySubmissions()
  const shootsQ = useMyShoots()
  const { data: projects } = useProjects()
  const reminders = useWorkReminderSettings()
  const move = useUpdateMyTaskStatus()

  const [sort, setSort] = useState<SortKey>('due_asc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [sending, setSending] = useState<WorkSubmission | null>(null)

  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data])
  const submissions = useMemo(() => subsQ.data ?? [], [subsQ.data])
  const shoots = useMemo(() => shootsQ.data ?? [], [shootsQ.data])

  const subByTask = useMemo(() => {
    const map = new Map<string, WorkSubmission>()
    for (const s of submissions) {
      if (s.task_id && !map.has(s.task_id)) map.set(s.task_id, s)
    }
    return map
  }, [submissions])

  const shootsByProject = useMemo(() => {
    const map = new Map<string, typeof shoots>()
    for (const s of shoots) {
      const arr = map.get(s.project_id) ?? []
      arr.push(s)
      map.set(s.project_id, arr)
    }
    return map
  }, [shoots])

  const projectById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects])
  const projectTabs = useMemo(() => {
    const ids = new Set<string>()
    for (const t of tasks) if (t.project_id) ids.add(t.project_id)
    for (const s of submissions) if (s.project_id) ids.add(s.project_id)
    return [...ids].map((id) => ({
      id,
      name: projectById.get(id)?.name ?? tasks.find((t) => t.project_id === id)?.project_name ?? 'Project',
    }))
  }, [tasks, submissions, projectById])

  // Summary: due today / pending / in review / overdue.
  const summary = useMemo(() => {
    const open = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
    return {
      dueToday: open.filter((t) => t.due_date === today).length,
      pending: open.filter((t) => t.status === 'to_do').length,
      inReview: submissions.filter((s) => s.status === 'submitted').length,
      overdue: open.filter((t) => t.due_date && t.due_date < today).length,
      completed: tasks.filter((t) => t.status === 'completed').length + submissions.filter((s) => s.status === 'approved').length,
    }
  }, [tasks, submissions, today])

  const rows: TaskRow[] = useMemo(() => {
    const cmp = (a: TaskRow, b: TaskRow) => {
      if (sort === 'priority') {
        const pr = (PRIORITY_RANK[a.task.priority] ?? 99) - (PRIORITY_RANK[b.task.priority] ?? 99)
        if (pr !== 0) return pr
      }
      const ad = a.task.due_date
      const bd = b.task.due_date
      if (!ad && !bd) return 0
      if (!ad) return 1
      if (!bd) return -1
      if (ad === bd) return 0
      return sort === 'due_desc' ? (ad < bd ? 1 : -1) : ad < bd ? -1 : 1
    }
    return tasks
      .filter((t) => (projectFilter === 'all' ? true : t.project_id === projectFilter))
      .filter((t) => {
        if (statusFilter === 'all') return true
        if (statusFilter === 'pending_review') return subByTask.get(t.id)?.status === 'submitted'
        return t.status === statusFilter
      })
      .map((t) => ({ task: t, submission: subByTask.get(t.id) ?? null }))
      .sort(cmp)
  }, [tasks, projectFilter, statusFilter, sort, subByTask])

  const groups = useMemo(() => {
    const g = { overdue: [] as TaskRow[], today: [] as TaskRow[], upcoming: [] as TaskRow[], noDate: [] as TaskRow[], completed: [] as TaskRow[] }
    for (const r of rows) {
      if (r.task.status === 'completed' || r.task.status === 'cancelled') g.completed.push(r)
      else if (!r.task.due_date) g.noDate.push(r)
      else if (r.task.due_date < today) g.overdue.push(r)
      else if (r.task.due_date === today) g.today.push(r)
      else g.upcoming.push(r)
    }
    return g
  }, [rows, today])

  const loading = tasksQ.isLoading || subsQ.isLoading
  const failed = tasksQ.isError || subsQ.isError
  const reminderDays = reminders.data?.enabled ? (reminders.data.reminder_days ?? []) : []

  function changeStatus(t: TaskListItem, status: TaskStatus) {
    move.mutate({ id: t.id, status })
  }

  const Group = ({ title, icon: Icon, items }: { title: string; icon: typeof Clock; items: TaskRow[] }) => {
    if (items.length === 0) return null
    return (
      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Icon className="size-4" /> {title}
          <span className="rounded-full bg-muted px-1.5 text-[11px]">{items.length}</span>
        </h2>
        {items.map(({ task: t, submission }) => {
          const linked = (t.project_id ? (shootsByProject.get(t.project_id) ?? []) : []).slice(0, 3)
          const overdue = !!t.due_date && t.due_date < today && t.status !== 'completed'
          return (
            <Card key={t.id}>
              <CardContent className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{t.title}</p>
                    {t.project_name && (
                      <p className="text-xs text-muted-foreground">
                        <Link to="/my-work/project/$projectId" params={{ projectId: t.project_id ?? '' }} className="hover:text-primary hover:underline">
                          {t.project_name}
                        </Link>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={t.status === 'completed' ? 'success' : t.status === 'in_progress' ? 'info' : 'neutral'}>
                      {STATUS_LABEL[t.status]}
                    </StatusBadge>
                    {t.due_date && <StatusBadge tone={overdue ? 'danger' : t.due_date === today ? 'warning' : 'neutral'}>{overdue ? `Overdue · ${t.due_date}` : t.due_date === today ? 'Due today' : t.due_date}</StatusBadge>}
                    {submission && <StatusBadge tone={TONE[submission.status]}>{WORK_STATUS_LABEL[submission.status]}</StatusBadge>}
                  </div>
                </div>
                {t.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{t.description}</p>}
                {linked.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {linked.map((s) => (
                      <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                        <CalendarDays className="size-3" /> {s.name}{s.shoot_date ? ` · ${s.shoot_date}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={t.status}
                    onChange={(e) => changeStatus(t, e.target.value as TaskStatus)}
                    disabled={move.isPending}
                    aria-label={`Status for ${t.title}`}
                    className="h-8 w-36"
                  >
                    {assigneeStatusOptions(t.status).map((s) => (
                      <option key={s} value={s} disabled={s === 'completed' || s === 'cancelled' || s === 'blocked'}>{STATUS_LABEL[s]}</option>
                    ))}
                  </Select>
                  {t.voice_note_url && (
                    <a href={t.voice_note_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                      <Mic className="size-3" /> Voice note
                    </a>
                  )}
                  <span className="ml-auto flex flex-wrap gap-2">
                    {submission?.status === 'approved' && submission.submission_link && (
                      <Button size="sm" variant="outline" onClick={() => setSending(submission)}>
                        <Send /> Send to client
                      </Button>
                    )}
                    <SubmitDialog taskId={t.id} projectId={t.project_id} />
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>
    )
  }

  return (
    <>
      <PageHeader
        title="My work"
        description="Your tasks, deliverables, shoot details, and submissions."
        actions={<SubmitDialog />}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Due today" value={summary.dueToday} icon={CalendarDays} />
        <SummaryCard label="Pending" value={summary.pending} icon={Clock} />
        <SummaryCard label="In review" value={summary.inReview} icon={Layers} />
        <SummaryCard label="Overdue" value={summary.overdue} icon={AlertCircle} warn={summary.overdue > 0} />
        <SummaryCard label="Completed" value={summary.completed} icon={CheckCircle2} />
      </div>

      <StartNowCard />
      <MyDeliverables />

      {reminderDays.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
          <Bell className="size-3.5 text-muted-foreground" />
          <span className="font-medium">Reminders:</span>
          {reminderDays.map((d) => (
            <span key={d} className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-primary">
              {d === 0 ? 'On due date' : `${d}d before`}
            </span>
          ))}
          <Link to="/reminders" className="ml-auto text-primary hover:underline">Manage reminders</Link>
        </div>
      )}

      {projectTabs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          <TabButton active={projectFilter === 'all'} onClick={() => setProjectFilter('all')} label="All work" />
          {projectTabs.map((p) => (
            <TabButton key={p.id} active={projectFilter === p.id} onClick={() => setProjectFilter(p.id)} label={p.name} />
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort</span>
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-8 w-56">
          <option value="due_asc">Due date: nearest first</option>
          <option value="due_desc">Due date: farthest first</option>
          <option value="recent">Recently created</option>
          <option value="priority">Priority</option>
        </Select>
        <span className="ml-2 text-xs text-muted-foreground">Status</span>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="h-8 w-44">
          <option value="all">All</option>
          <option value="to_do">To do</option>
          <option value="in_progress">In progress</option>
          <option value="pending_review">Pending review</option>
          <option value="completed">Completed</option>
        </Select>
      </div>

      <div className="mt-4">
        {loading ? (
          <SkeletonCards count={3} />
        ) : failed ? (
          <ErrorState onRetry={() => { void tasksQ.refetch(); void subsQ.refetch() }} />
        ) : rows.length === 0 ? (
          <EmptyState title="No work assigned yet" description="Tasks assigned to you will show up here." action={<SubmitDialog />} />
        ) : (
          <div className="flex flex-col gap-4">
            <Group title="Overdue" icon={AlertCircle} items={groups.overdue} />
            <Group title="Due today" icon={Clock} items={groups.today} />
            <Group title="Upcoming" icon={Clock} items={groups.upcoming} />
            <Group title="No due date" icon={Clock} items={groups.noDate} />
            <Group title="Completed" icon={CheckCircle2} items={groups.completed} />
          </div>
        )}
      </div>

      <SubmissionsSection
        submissions={submissions}
        onSend={setSending}
      />

      {sending && (
        <SendWorkToClientDialog
          open
          onClose={() => setSending(null)}
          submissionId={sending.id}
          fallbackLink={sending.submission_link ?? ''}
          projectName={projectById.get(sending.project_id ?? '')?.name ?? null}
          clientName={projectById.get(sending.project_id ?? '')?.client_name ?? null}
          clientEmail={null}
          clientPhone={projectById.get(sending.project_id ?? '')?.client_phone ?? null}
        />
      )}
    </>
  )
}

function SummaryCard({ label, value, icon: Icon, warn }: { label: string; value: number; icon: typeof Clock; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={warn ? 'text-destructive' : 'text-primary'}>
          <Icon className="size-4" />
        </span>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={active
        ? 'rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground'
        : 'rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground'}
    >
      {label}
    </button>
  )
}

function SubmissionsSection({ submissions, onSend }: { submissions: WorkSubmission[]; onSend: (s: WorkSubmission) => void }) {
  const revoke = useRevokeDelivery()
  const confirm = useConfirm()

  // Revoking is not undoable — the token is expired, not paused — and the
  // client loses a link they may be using right now.
  async function onRevoke(s: WorkSubmission) {
    const yes = await confirm({
      title: 'Revoke this client link?',
      description: `${s.title ?? 'This submission'} will stop opening for the client. Sending again issues a new link.`,
      destructive: true,
      confirmLabel: 'Revoke link',
    })
    if (yes) revoke.mutate(s.id)
  }

  if (submissions.length === 0) return null
  return (
    <div className="mt-8 flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">Submissions ({submissions.length})</h2>
      {submissions.map((s) => (
        <Card key={s.id}>
          <CardContent className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <a
                href={s.submission_link ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 font-medium text-primary hover:underline"
              >
                {s.notes ?? s.submission_link} <ExternalLink className="size-3.5" />
              </a>
              {s.review_notes && (
                <p className="mt-1 text-sm text-muted-foreground">Review: {s.review_notes}</p>
              )}
              {s.client_sent_at && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Sent to client{s.client_channel ? ` via ${s.client_channel}` : ''}
                  {s.revoked_at ? ' · link revoked' : ''}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {s.status === 'submitted' && (
                <SubmitDialog submission={s} trigger={<Button size="sm" variant="ghost"><Pencil /></Button>} />
              )}
              {s.status === 'approved' && s.submission_link && (
                <Button size="sm" variant="outline" onClick={() => onSend(s)}>
                  <Send /> {s.client_sent_at ? 'Send again' : 'Send'}
                </Button>
              )}
              {/* The send dialog promises the link can be pulled back. This is
                  the control that keeps the promise — the wrong cut of a film
                  sitting on a link the client still has is the case it is for. */}
              {s.client_sent_at && !s.revoked_at && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={revoke.isPending}
                  onClick={() => void onRevoke(s)}
                >
                  <Ban /> Revoke link
                </Button>
              )}
              <StatusBadge tone={TONE[s.status]}>{WORK_STATUS_LABEL[s.status]}</StatusBadge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
