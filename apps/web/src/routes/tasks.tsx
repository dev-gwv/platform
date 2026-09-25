import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock,
  Eye,
  ListChecks,
  Package,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import type { DirectoryMember, TaskListItem, TaskPriority, TaskStatus } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { SkeletonCards, SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { HowToUse } from '@/shared/ui/how-to-use'
import { Input, Label, Select } from '@/shared/ui/input'
import { CreatableSelect } from '@/shared/ui/creatable-select'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { AvatarGroup } from '@/shared/ui/avatar'
import { CountUp } from '@/shared/ui/count-up'
import { useBoardDeliverables, useProjects } from '@/features/projects/api'
import { useDirectory } from '@/features/team/api'
import {
  useApplyBundle,
  useBundles,
  useCreateBundle,
  useCreateTask,
  useDeleteBundle,
  useDeleteTask,
  useSetTaskStatus,
  useSubtasks,
  useTask,
  useTaskPriorities,
  useCreateTaskPriority,
  useTasks,
  useUpdateBundle,
  useUpdateTask,
} from '@/features/tasks/api'
import {
  EMPTY_FILTERS,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_TABS,
  filterTasks,
  isOverdue,
  summarise,
  tabCounts,
  todayISO,
  type TaskFilters,
  type TaskTab,
} from '@/features/tasks/board'

const PRIORITY_TONE: Record<TaskPriority, 'danger' | 'warning' | 'neutral' | 'info'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'info',
}

/** The studio's own label/tone when it set one, else the plain canonical badge. */
function PriorityBadge({ task }: { task: TaskListItem }) {
  if (task.custom_priority_code && task.custom_priority_label && task.custom_priority_tone) {
    return <StatusBadge tone={task.custom_priority_tone}>{task.custom_priority_label}</StatusBadge>
  }
  return <StatusBadge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</StatusBadge>
}


const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

export function TasksPage() {
  return (
    <AuthedPage module="tasks">
      <Tasks />
    </AuthedPage>
  )
}

function Tasks() {
  const [tab, setTab] = useState<TaskTab>('all')
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS)
  const { data, isLoading, isError, refetch } = useTasks()

  const today = todayISO()
  const tasks = useMemo(() => data ?? [], [data])
  const totals = useMemo(() => summarise(tasks, today), [tasks, today])
  const counts = useMemo(() => tabCounts(tasks, today), [tasks, today])
  const rows = useMemo(() => filterTasks(tasks, tab, filters, today), [tasks, tab, filters, today])

  return (
    <>
      <HowToUse
        title="Track team work"
        description="Create tasks for editing, delivery, follow-up, and operations."
        steps={['Add the task and its details.', 'Assign it to a team member.', 'Track it to done.']}
      />

      <div className="mt-6">
        <PageHeader
          title="Task management"
          description="All tasks across your studio — assign, track, and close out work."
          actions={
            <>
              <BundlesDialog />
              <NewTaskDialog />
            </>
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile icon={ListChecks} label="Total" value={totals.total} />
        <Tile icon={Circle} label="To do" value={totals.toDo} tone="info" />
        <Tile icon={Clock} label="In progress" value={totals.inProgress} tone="warning" />
        <Tile icon={CheckCircle2} label="Completed" value={totals.completed} tone="success" />
        <Tile icon={CalendarClock} label="Overdue" value={totals.overdue} tone="danger" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <FeatureCard
          icon={Package}
          title="Task bundles"
          description="Reusable checklists for the work you repeat — wedding editing, album delivery, client onboarding, shoot prep."
          action={<BundlesDialog trigger={<Button variant="outline">Manage bundles</Button>} />}
        />
      </div>

      <div className="mt-6">
        <FilterTabs<TaskTab>
          tabs={TASK_TABS.map((t) => ({ ...t, count: counts[t.value] }))}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div className="mt-4 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search title, description, project or assignee…"
            aria-label="Search tasks"
          />
        </div>
        <Select
          value={filters.priority}
          onChange={(e) =>
            setFilters({ ...filters, priority: e.target.value as TaskFilters['priority'] })
          }
          aria-label="Priority"
        >
          <option value="all">All priorities</option>
          {(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonList rows={6} columns={6} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                title={tasks.length === 0 ? 'No tasks yet' : 'Nothing matches these filters'}
                description={
                  tasks.length === 0
                    ? 'Create your first task, or use a bundle to raise a whole checklist at once.'
                    : 'Try another tab, or clear the search.'
                }
                action={
                  tasks.length === 0 ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <NewTaskDialog />
                      <BundlesDialog trigger={<Button variant="outline">Task bundles</Button>} />
                      <Button variant="outline" asChild>
                        <Link to="/projects">Projects</Link>
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            </CardContent>
          </Card>
        ) : (
          <TaskTable rows={rows} today={today} />
        )}
      </div>
    </>
  )
}

function Tile({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof ListChecks
  label: string
  value: number
  tone?: 'success' | 'danger' | 'info' | 'warning' | 'neutral'
}) {
  const toneClass = {
    success: 'bg-success/15 text-success',
    danger: 'bg-destructive/10 text-destructive',
    info: 'bg-primary/10 text-primary',
    warning: 'bg-warning/15 text-warning',
    neutral: 'bg-muted text-muted-foreground',
  }[tone]

  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', toneClass)}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xl font-semibold tabular-nums">
            <CountUp value={value} />
          </p>
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Package
  title: string
  description: string
  action: ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          <div className="mt-3">{action}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function TaskTable({ rows, today }: { rows: readonly TaskListItem[]; today: string }) {
  const setStatus = useSetTaskStatus()
  const deleteTask = useDeleteTask()
  const confirm = useConfirm()
  const isMobile = useIsMobile()
  const [detailId, setDetailId] = useState<string | null>(null)

  async function onDelete(t: TaskListItem) {
    const yes = await confirm({
      title: 'Delete this task?',
      description: `${t.title}. This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (yes) deleteTask.mutate(t.id)
  }

  const StatusSelect = ({ task }: { task: TaskListItem }) => (
    <Select
      value={task.status}
      onChange={(e) => setStatus.mutate({ id: task.id, status: e.target.value as TaskStatus })}
      disabled={setStatus.isPending}
      aria-label={`Status for ${task.title}`}
      className="h-8 w-36"
    >
      {(['to_do', 'in_progress', 'completed', 'cancelled'] as TaskStatus[]).map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </Select>
  )

  if (isMobile) {
    return (
      <>
      <div className="flex flex-col gap-3">
        {rows.map((t) => (
          <div key={t.id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => setDetailId(t.id)}
                className="text-left font-medium hover:text-primary hover:underline"
              >
                {t.title}
              </button>
              <PriorityBadge task={t} />
            </div>
            {t.project_name && (
              <p className="mt-1 truncate text-sm text-muted-foreground">{t.project_name}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <StatusSelect task={t} />
              <DueBadge task={t} today={today} />
            </div>
            <div className="mt-2 flex justify-end gap-1">
              <EditTaskDialog
                task={t}
                trigger={
                  <Button size="sm" variant="ghost">
                    <Pencil />
                  </Button>
                }
              />
              <Button size="sm" variant="ghost" onClick={() => void onDelete(t)}>
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {detailId && <TaskDetailDialog taskId={detailId} onClose={() => setDetailId(null)} />}
      </>
    )
  }

  return (
    <>
    <div className="table-wrap rounded-lg border border-border">
      <table className="table-sticky w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="min-w-64 px-4 py-2 font-medium">Task</th>
            <th className="px-4 py-2 font-medium">Project</th>
            <th className="px-4 py-2 font-medium">Assigned</th>
            <th className="px-4 py-2 font-medium">Priority</th>
            <th className="px-4 py-2 font-medium">Due</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t border-border hover:bg-muted/30">
              <td className="px-4 py-2">
                <button
                  type="button"
                  onClick={() => setDetailId(t.id)}
                  className={cn(
                    'text-left font-medium hover:text-primary hover:underline',
                    t.status === 'completed' && 'text-muted-foreground line-through',
                  )}
                >
                  {t.title}
                </button>
                {t.description && (
                  <p className="truncate text-xs text-muted-foreground">{t.description}</p>
                )}
                {t.voice_note_url && (
                  <a
                    href={t.voice_note_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Voice note
                  </a>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{t.project_name ?? '—'}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {t.assignee_names.length ? (
                  <span className="flex items-center gap-2">
                    <AvatarGroup names={t.assignee_names} />
                    <span className="truncate">{t.assignee_names.join(', ')}</span>
                  </span>
                ) : (
                  <span className="text-warning">Unassigned</span>
                )}
              </td>
              <td className="px-4 py-2">
                <PriorityBadge task={t} />
              </td>
              <td className="px-4 py-2">
                <DueBadge task={t} today={today} />
              </td>
              <td className="px-4 py-2">
                <StatusSelect task={t} />
              </td>
              <td className="px-4 py-2 text-right">
                <div className="flex justify-end gap-1">
                  {/* The title opens this too, but a row of icons that skips
                      "look at it" reads as if editing is the only way in. */}
                  <Button size="sm" variant="ghost" title="View" aria-label={`View ${t.title}`} onClick={() => setDetailId(t.id)}>
                    <Eye />
                  </Button>
                  <EditTaskDialog
                    task={t}
                    trigger={
                      <Button size="sm" variant="ghost" title="Edit">
                        <Pencil />
                      </Button>
                    }
                  />
                  <Button size="sm" variant="ghost" title="Delete" onClick={() => void onDelete(t)}>
                    <Trash2 />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {detailId && <TaskDetailDialog taskId={detailId} onClose={() => setDetailId(null)} />}
    </>
  )
}

/**
 * Task detail dialog (Lovable parity with _app.tasks.$taskId): full header,
 * status move, voice note, and the subtask list. Subtasks are a client-side
 * slice on parent_task_id until a dedicated subtask API lands.
 */
function TaskDetailDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { data: task, isLoading } = useTask(taskId)
  const subtasks = useSubtasks(taskId)
  const setStatus = useSetTaskStatus()

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        title={task?.title ?? 'Task'}
        description={task?.project_name ? `Project · ${task.project_name}` : 'Task details'}
        className="max-h-[85vh] max-w-2xl overflow-y-auto"
      >
        {isLoading || !task ? (
          <SkeletonList rows={4} columns={2} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={task.status === 'completed' ? 'success' : task.status === 'in_progress' ? 'info' : 'neutral'}>
                {STATUS_LABEL[task.status]}
              </StatusBadge>
              <PriorityBadge task={task} />
              <DueBadge task={task} today={todayISO()} />
            </div>

            {task.description && (
              <p className="whitespace-pre-wrap text-sm">{task.description}</p>
            )}

            {task.assignee_names.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AvatarGroup names={task.assignee_names} />
                <span>{task.assignee_names.join(', ')}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <Select
                value={task.status}
                onChange={(e) => setStatus.mutate({ id: task.id, status: e.target.value as TaskStatus })}
                disabled={setStatus.isPending}
                aria-label={`Status for ${task.title}`}
                className="h-8 w-40"
              >
                {(['to_do', 'in_progress', 'completed', 'cancelled'] as TaskStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>
              {task.voice_note_url && (
                <a
                  href={task.voice_note_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Voice note
                </a>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium">
                Subtasks {subtasks.length > 0 && <span className="text-muted-foreground">({subtasks.length})</span>}
              </p>
              {subtasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No subtasks yet. Subtask creation lands with the dedicated subtask API.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {subtasks.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                      <StatusBadge tone={s.status === 'completed' ? 'success' : 'neutral'}>
                        {STATUS_LABEL[s.status]}
                      </StatusBadge>
                      <DueBadge task={s} today={todayISO()} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DueBadge({ task, today }: { task: TaskListItem; today: string }) {
  if (!task.due_date) return <span className="text-xs text-muted-foreground">No date</span>
  const late = isOverdue(task, today)
  const label = dayFormat.format(new Date(`${task.due_date}T00:00:00`))
  return (
    <StatusBadge tone={late ? 'danger' : task.due_date === today ? 'warning' : 'neutral'}>
      {late ? `Overdue · ${label}` : task.due_date === today ? 'Due today' : label}
    </StatusBadge>
  )
}

/** Checkbox list of active team members, for assigning a task to whoever's doing the work. */
function AssigneePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { data: members } = useDirectory()
  const active = (members ?? []).filter((m: DirectoryMember) => m.status === 'active')

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id])
  }

  if (active.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Assigned to</Label>
      <div className="grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {active.map((m) => (
          <label key={m.user_id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
            <input type="checkbox" checked={selected.includes(m.user_id)} onChange={() => toggle(m.user_id)} />
            {m.name}
          </label>
        ))}
      </div>
    </div>
  )
}

function NewTaskDialog() {
  const create = useCreateTask()
  const { data: projects } = useProjects()
  const { data: customPriorities } = useTaskPriorities()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [projectId, setProjectId] = useState('')
  /**
   * Which deliverable this work is for. The column, the contract and the API
   * have always accepted it — "Generate tasks from deliverables" sets it
   * server-side — but this dialog sent `deliverable_id: null` outright, so a
   * task typed by hand could never be attached to the thing it delivers.
   */
  const [deliverableId, setDeliverableId] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [customPriorityCode, setCustomPriorityCode] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [voiceNoteUrl, setVoiceNoteUrl] = useState('')
  const [assignees, setAssignees] = useState<string[]>([])
  const { data: deliverables } = useBoardDeliverables()
  // Only the chosen project's own, still-open deliverables: attaching a task to
  // another project's, or to one already delivered, would be a mistake.
  const projectDeliverables = (deliverables ?? []).filter((d) => d.project_id === projectId && d.status !== 'completed')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? 'tasks-page:new' : null,
    { title, description, projectId, deliverableId, priority, customPriorityCode, dueDate, voiceNoteUrl, assignees },
    (v) => {
      setTitle(v.title)
      setDescription(v.description)
      setProjectId(v.projectId)
      setDeliverableId(v.deliverableId)
      setPriority(v.priority)
      setCustomPriorityCode(v.customPriorityCode)
      setDueDate(v.dueDate)
      setVoiceNoteUrl(v.voiceNoteUrl)
      setAssignees(v.assignees)
    },
  )

  function reset() {
    setTitle('')
    setDescription('')
    setProjectId('')
    setPriority('medium')
    setCustomPriorityCode('')
    setDueDate('')
    setVoiceNoteUrl('')
    setAssignees([])
    setDeliverableId('')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        title: title.trim(),
        project_id: projectId || null,
        deliverable_id: deliverableId || null,
        status: 'to_do',
        priority,
        custom_priority_code: customPriorityCode || null,
        assignees,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(voiceNoteUrl.trim() ? { voice_note_url: voiceNoteUrl.trim() } : {}),
      },
      {
        onSuccess: () => {
          draft.clear()
          setOpen(false)
          reset()
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New task
        </Button>
      </DialogTrigger>
      <DialogContent title="New task" description="Give it a title, assign it, and track it to done.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Cull and select — Sharma wedding"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What does done look like?"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <AssigneePicker selected={assignees} onChange={setAssignees} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value)
                  // The old pick belongs to the old project.
                  setDeliverableId('')
                }}
              >
                <option value="">None</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Deliverable</Label>
              <Select
                value={deliverableId}
                onChange={(e) => setDeliverableId(e.target.value)}
                disabled={!projectId || projectDeliverables.length === 0}
              >
                <option value="">
                  {!projectId
                    ? 'Pick a project first'
                    : projectDeliverables.length === 0
                      ? 'None on this project'
                      : 'Not tied to one'}
                </option>
                {projectDeliverables.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Priority</Label>
              <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {(['low', 'medium', 'high', 'urgent'] as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Voice note URL (optional)</Label>
            <Input
              value={voiceNoteUrl}
              onChange={(e) => setVoiceNoteUrl(e.target.value)}
              placeholder="https://…"
              type="url"
            />
          </div>
          {/* Always shown: hidden while the list was empty, nobody ever found
              out labels existed. A new one is added right here. */}
          <div className="flex flex-col gap-1.5">
            <Label>Custom label (optional)</Label>
            <TaskLabelPicker
              value={customPriorityCode}
              onChange={setCustomPriorityCode}
              options={customPriorities ?? []}
              noneLabel={`None — use ${PRIORITY_LABEL[priority]}`}
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || title.trim().length === 0}>
              {create.isPending ? 'Creating…' : 'Create task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Everything the create form set, editable afterwards — same fields, plus who's assigned. */
function EditTaskDialog({ task, trigger }: { task: TaskListItem; trigger: ReactNode }) {
  const update = useUpdateTask()
  const { data: projects } = useProjects()
  const { data: customPriorities } = useTaskPriorities()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [projectId, setProjectId] = useState(task.project_id ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [customPriorityCode, setCustomPriorityCode] = useState(task.custom_priority_code ?? '')
  const [dueDate, setDueDate] = useState(task.due_date ?? '')
  const [voiceNoteUrl, setVoiceNoteUrl] = useState(task.voice_note_url ?? '')
  const [assignees, setAssignees] = useState<string[]>(task.assignee_ids)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `tasks-page:${task.id}` : null,
    { title, description, projectId, priority, customPriorityCode, dueDate, voiceNoteUrl, assignees },
    (v) => {
      setTitle(v.title)
      setDescription(v.description)
      setProjectId(v.projectId)
      setPriority(v.priority)
      setCustomPriorityCode(v.customPriorityCode)
      setDueDate(v.dueDate)
      setVoiceNoteUrl(v.voiceNoteUrl)
      setAssignees(v.assignees)
    },
  )

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    update.mutate(
      {
        id: task.id,
        patch: {
          title: title.trim(),
          project_id: projectId || null,
          priority,
          custom_priority_code: customPriorityCode || null,
          due_date: dueDate || null,
          description: description.trim() || null,
          voice_note_url: voiceNoteUrl.trim() || null,
          assignees,
        },
      },
      {
        onSuccess: () => {
          draft.clear()
          setOpen(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Edit task" description="Anything set when it was created can be corrected here.">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>
              Title <span className="text-destructive">*</span>
            </Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <AssigneePicker selected={assignees} onChange={setAssignees} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Project</Label>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">None</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Priority</Label>
              <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {(['low', 'medium', 'high', 'urgent'] as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Voice note URL (optional)</Label>
            <Input
              value={voiceNoteUrl}
              onChange={(e) => setVoiceNoteUrl(e.target.value)}
              placeholder="https://…"
              type="url"
            />
          </div>
          {/* Always shown: hidden while the list was empty, nobody ever found
              out labels existed. A new one is added right here. */}
          <div className="flex flex-col gap-1.5">
            <Label>Custom label (optional)</Label>
            <TaskLabelPicker
              value={customPriorityCode}
              onChange={setCustomPriorityCode}
              options={customPriorities ?? []}
              noneLabel={`None — use ${PRIORITY_LABEL[priority]}`}
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={update.isPending || title.trim().length === 0}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Build a checklist once; raise it against a project whenever it comes round. */
function BundlesDialog({ trigger }: { trigger?: ReactNode }) {
  const { data: bundles, isLoading } = useBundles()
  const { data: projects } = useProjects()
  const createBundle = useCreateBundle()
  const updateBundle = useUpdateBundle()
  const deleteBundle = useDeleteBundle()
  const applyBundle = useApplyBundle()
  const confirm = useConfirm()

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [itemText, setItemText] = useState('')
  const [applyTo, setApplyTo] = useState<Record<string, string>>({})
  // A checklist being written survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(open ? `task-bundle:${editingId ?? 'new'}` : null, { name, itemText }, (v) => {
    setName(v.name)
    setItemText(v.itemText)
  })
  const saved = () => {
    draft.clear()
    cancelEdit()
  }

  function startEdit(b: { id: string; name: string; items: { title: string }[] }) {
    setEditingId(b.id)
    setName(b.name)
    setItemText(b.items.map((i) => i.title).join('\n'))
  }

  function cancelEdit() {
    setEditingId(null)
    setName('')
    setItemText('')
  }

  const items = itemText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  async function onDelete(id: string, bundleName: string) {
    const yes = await confirm({
      title: `Delete the ${bundleName} bundle?`,
      description: 'Tasks already created from it stay. Only the checklist goes.',
      confirmLabel: 'Delete bundle',
      destructive: true,
    })
    if (yes) deleteBundle.mutate(id)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button variant="outline">
        <Package /> Task bundles
      </Button>}</DialogTrigger>
      <DialogContent
        title="Task bundles"
        description="A checklist you raise again every time the same job comes round."
        className="max-h-[85vh] max-w-2xl overflow-y-auto"
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-medium">Your bundles</p>
            {isLoading ? (
              <SkeletonCards count={3} />
            ) : !bundles || bundles.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                No bundles yet. Create one below.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {bundles.map((b) => (
                  <li key={b.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate font-medium">{b.name}</p>
                      <StatusBadge>{b.items.length} tasks</StatusBadge>
                      <Button size="sm" variant="ghost" onClick={() => startEdit(b)}>
                        <Pencil />
                        <span className="sr-only">Edit {b.name}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void onDelete(b.id, b.name)}
                        disabled={deleteBundle.isPending}
                      >
                        <Trash2 />
                        <span className="sr-only">Delete {b.name}</span>
                      </Button>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {b.items.map((i) => i.title).join(' · ')}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Select
                        value={applyTo[b.id] ?? ''}
                        onChange={(e) => setApplyTo({ ...applyTo, [b.id]: e.target.value })}
                        className="h-8 w-52"
                        aria-label={`Project for ${b.name}`}
                      >
                        <option value="">No project</option>
                        {(projects ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        disabled={applyBundle.isPending}
                        onClick={() =>
                          applyBundle.mutate({
                            id: b.id,
                            input: { project_id: applyTo[b.id] || null, assignees: [] },
                          })
                        }
                      >
                        Create {b.items.length} tasks
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              const payload = { name: name.trim(), items: items.map((title) => ({ title, priority: 'medium' as const })) }
              if (editingId) {
                updateBundle.mutate({ id: editingId, input: payload }, { onSuccess: saved })
              } else {
                createBundle.mutate(payload, { onSuccess: saved })
              }
            }}
            className="flex flex-col gap-3 border-t border-border pt-5"
          >
            <p className="text-sm font-medium">{editingId ? 'Edit bundle' : 'New bundle'}</p>
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Wedding editing"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tasks — one per line</Label>
              <textarea
                value={itemText}
                onChange={(e) => setItemText(e.target.value)}
                rows={5}
                placeholder={'Cull and select\nColour grade\nAlbum layout\nClient review'}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? 'task' : 'tasks'} · they keep this order.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              {editingId && (
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                disabled={(editingId ? updateBundle.isPending : createBundle.isPending) || name.trim().length < 2 || items.length === 0}
              >
                {(editingId ? updateBundle.isPending : createBundle.isPending)
                  ? 'Saving…'
                  : editingId
                    ? 'Save changes'
                    : 'Save bundle'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A task's custom label, or a new one typed on the spot (saved for the studio). */
function TaskLabelPicker({
  value,
  onChange,
  options,
  noneLabel,
}: {
  value: string
  onChange: (code: string) => void
  options: { id: string; code: string; label: string }[]
  noneLabel: string
}) {
  const create = useCreateTaskPriority()
  return (
    <CreatableSelect
      aria-label="Custom label"
      value={value}
      onChange={onChange}
      options={options.map((p) => ({ value: p.code, label: p.label }))}
      placeholder={noneLabel}
      addLabel="Add a label…"
      inputPlaceholder="e.g. Client waiting"
      onCreate={async (label) => {
        const code =
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 32) || 'label'
        const made = await create.mutateAsync({ code: `${code}-${Date.now().toString(36).slice(-4)}`, label, tone: 'neutral' })
        return made.code
      }}
    />
  )
}
