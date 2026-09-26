import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Clock, Eye, Flame, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { TASK_TAGS, type DirectoryMember, type TaskListItem, type TaskPriority, type TaskStatus } from '@ipc/contracts'
import { ModuleRouteGuard } from '@/shared/auth/ModuleRouteGuard'
import { PageHeader } from '@/shared/layout/page-header'
import { FilterTabs } from '@/shared/layout/filter-tabs'
import { Button } from '@/shared/ui/button'
import { SkeletonCards, SkeletonList } from '@/shared/ui/skeleton'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { CreatableSelect } from '@/shared/ui/creatable-select'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useUrlParam } from '@/shared/hooks/use-url-param'
import { AvatarGroup } from '@/shared/ui/avatar'
import { CountUp } from '@/shared/ui/count-up'
import { useProjects } from '@/features/projects/api'
import { useProductionBoard } from '@/features/board/api'
import { TaskBoard } from '@/features/board/TaskBoard'
import { useDirectory } from '@/features/team/api'
import {
  useApplyBundle,
  useBundles,
  useCreateBundle,
  useCreateTask,
  useDeleteBundle,
  useDeleteTask,
  useMyTasks,
  useSetTaskStatus,
  useTaskPriorities,
  useCreateTaskPriority,
  useTasks,
  useUpdateBundle,
  useUpdateTask,
} from '@/features/tasks/api'
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_TABS,
  filterTasks,
  tabCounts,
  todayISO,
  type TaskTab,
} from '@/features/tasks/board'
import {
  DUE_FILTERS,
  isOpen,
  matchesDue,
  matchesScope,
  taskStats,
  weekStart,
  type DueFilter,
} from '@/features/tasks/delegation'
import { DueText, PriorityPill } from '@/features/tasks/TaskCard'
import { TaskPeopleView } from '@/features/tasks/TaskPeopleView'
import { TaskDrawer } from '@/features/tasks/TaskDrawer'
import { useTaskActions, useTaskViewer } from '@/features/tasks/TaskActions'

/**
 * Tasks: give work, see who is carrying what, and close the loop —
 * assign → they are told → they work → they submit a link → you review → done.
 *
 * Someone who manages tasks sees the studio; everyone else sees their own
 * (and may add tasks for themselves). The same page, so a link from a
 * notification (/tasks?open=<id>) or the dashboard (?mine=1) works for all.
 */
export function TasksPage() {
  return (
    <ModuleRouteGuard module="tasks" fallback={<Tasks managed={false} />}>
      <Tasks managed />
    </ModuleRouteGuard>
  )
}

type TaskView = 'people' | 'list' | 'board'
const VIEWS: ReadonlyArray<{ value: TaskView; label: string }> = [
  { value: 'people', label: 'People' },
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
]

function Tasks({ managed }: { managed: boolean }) {
  // People first: who is carrying what is the question a studio owner opens
  // this page to answer. Every choice lives in the address so it sticks.
  const [viewParam, setView] = useUrlParam('view', 'people')
  const view: TaskView = VIEWS.some((v) => v.value === viewParam) ? (viewParam as TaskView) : 'people'
  const [mineParam, setMine] = useUrlParam('mine', '')
  const [member, setMember] = useUrlParam('member', '')
  const [dueParam, setDue] = useUrlParam('due', 'all')
  const due: DueFilter = DUE_FILTERS.some((d) => d.value === dueParam) ? (dueParam as DueFilter) : 'all'
  const [openId, setOpenId] = useUrlParam('open', '')
  // A notification tapped while already on this page changes the address,
  // not this state: follow it, so the task it names opens.
  const { search: locSearch } = useLocation()
  const linkedOpen = (locSearch as Record<string, unknown>).open
  useEffect(() => {
    if (typeof linkedOpen === 'string' && linkedOpen) setOpenId(linkedOpen)
  }, [linkedOpen, setOpenId])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<TaskTab>('all')

  const { me, canManage, canAssign } = useTaskViewer()
  const mine = !managed || mineParam === '1'
  const studio = useTasks()
  const own = useMyTasks()
  const { data, isLoading, isError, refetch } = managed ? studio : own
  const { data: directory } = useDirectory()
  const members = useMemo(() => (directory ?? []).filter((m: DirectoryMember) => m.status === 'active'), [directory])
  const actions = useTaskActions()

  const today = todayISO()
  const monday = weekStart(today)
  const needle = search.trim().toLowerCase()

  // Everything the toolbar says, in one predicate the three views share.
  const keep = useMemo(
    () => (t: TaskListItem) =>
      matchesScope(t, { mine, me, member: managed && !mine ? member : '' }) &&
      matchesDue(t, due, today) &&
      (!needle ||
        [t.title, t.description, t.project_name, t.tag, ...t.assignee_names]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))),
    [mine, me, member, managed, due, today, needle],
  )
  const scoped = useMemo(() => (data ?? []).filter(keep), [data, keep])
  const stats = useMemo(() => taskStats(scoped, today), [scoped, today])
  // The People view is about work in hand: open tasks, and what was finished
  // this week so a tick does not make a card vanish on the spot.
  const peopleRows = useMemo(
    () => scoped.filter((t) => isOpen(t) || (t.status === 'completed' && (t.updated_at ?? '').slice(0, 10) >= monday)),
    [scoped, monday],
  )
  const counts = useMemo(() => tabCounts(scoped, today), [scoped, today])
  const listRows = useMemo(() => filterTasks(scoped, tab, { search: '', priority: 'all' }, today), [scoped, tab, today])
  const total = (data ?? []).length

  return (
    <>
      <PageHeader
        title={managed ? 'Task management' : 'My tasks'}
        description={
          managed
            ? 'Give work, see who is carrying what, and review it to done.'
            : 'Do the work, submit a link, and it goes for review.'
        }
        actions={
          <>
            {managed && <BundlesDialog />}
            <NewTaskDialog own={!canAssign} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Flame} label="High priority" value={stats.highPriority} tone="danger" />
        <Stat icon={Clock} label="In progress" value={stats.inProgress} tone="info" />
        <Stat icon={AlertTriangle} label="Due today" value={stats.dueToday} tone="warning" />
        <Stat icon={CheckCircle2} label="Done this week" value={stats.doneThisWeek} tone="success" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Segmented label="View" value={view} onChange={(v) => setView(v)} options={VIEWS} />
        <Segmented
          label="Whose tasks"
          value={mine ? 'mine' : 'all'}
          onChange={(v) => setMine(v === 'mine' ? '1' : '')}
          options={[
            { value: 'mine', label: 'My tasks' },
            { value: 'all', label: 'All tasks', disabled: !managed },
          ]}
        />
        {managed && !mine && (
          <Select value={member} onChange={(e) => setMember(e.target.value)} aria-label="Person" className="h-9 w-44">
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
        <Select value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="h-9 w-40">
          {DUE_FILTERS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="h-9 w-full sm:w-56"
        />
      </div>

      <div className="mt-4">
        {view === 'board' ? (
          <TaskBoard items={managed ? undefined : (data ?? [])} filter={keep} />
        ) : isLoading ? (
          <SkeletonList rows={6} columns={4} />
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : scoped.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                title={total === 0 ? 'No tasks yet' : 'Nothing matches'}
                description={
                  total === 0
                    ? managed
                      ? 'Give someone their first task, or raise a whole checklist from a bundle.'
                      : 'Tasks given to you show up here. You can add your own too.'
                    : 'Try another date, person, or search.'
                }
                action={
                  total === 0 && managed ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <NewTaskDialog own={!canAssign} />
                      <Button variant="outline" asChild>
                        <Link to="/projects">Projects</Link>
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            </CardContent>
          </Card>
        ) : view === 'people' ? (
          <TaskPeopleView
            rows={peopleRows}
            today={today}
            me={me}
            canManage={canManage}
            canAssign={canAssign && managed}
            members={managed && !mine && !member ? members : []}
            onOpen={(t) => setOpenId(t.id)}
            onAction={actions.run}
          />
        ) : (
          <>
            <FilterTabs<TaskTab> tabs={TASK_TABS.map((t) => ({ ...t, count: counts[t.value] }))} value={tab} onChange={setTab} />
            <div className="mt-3">
              <TaskTable rows={listRows} today={today} canManage={canManage} onOpen={(id) => setOpenId(id)} />
            </div>
          </>
        )}
      </div>

      {actions.dialogs}
      {openId && (
        <TaskDrawer
          taskId={openId}
          onClose={() => setOpenId('')}
          editSlot={
            canManage
              ? (t) => (
                  <EditTaskDialog
                    task={t}
                    trigger={
                      <Button size="sm" variant="outline">
                        <Pencil /> Edit
                      </Button>
                    }
                  />
                )
              : undefined
          }
        />
      )}
    </>
  )
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          disabled={o.disabled}
          title={o.disabled ? 'Only someone who manages tasks sees everyone’s' : undefined}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Flame
  label: string
  value: number
  tone: 'success' | 'danger' | 'info' | 'warning'
}) {
  const toneClass = {
    success: 'bg-success/15 text-success',
    danger: 'bg-destructive/10 text-destructive',
    info: 'bg-primary/10 text-primary',
    warning: 'bg-warning/15 text-warning',
  }[tone]
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', toneClass)}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight tabular-nums">
          <CountUp value={value} />
        </p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

const MANAGER_STATUSES: TaskStatus[] = ['to_do', 'in_progress', 'review', 'blocked', 'completed', 'cancelled']

function TaskTable({
  rows,
  today,
  canManage,
  onOpen,
}: {
  rows: readonly TaskListItem[]
  today: string
  canManage: boolean
  onOpen: (id: string) => void
}) {
  const setStatus = useSetTaskStatus()
  const deleteTask = useDeleteTask()
  const confirm = useConfirm()
  const isMobile = useIsMobile()

  async function onDelete(t: TaskListItem) {
    const yes = await confirm({
      title: 'Delete this task?',
      description: `${t.title}. This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    })
    if (yes) deleteTask.mutate(t.id)
  }

  const statusCell = (task: TaskListItem) =>
    canManage ? (
      <Select
        value={task.status}
        onChange={(e) => setStatus.mutate({ id: task.id, status: e.target.value as TaskStatus })}
        disabled={setStatus.isPending}
        aria-label={`Status for ${task.title}`}
        className="h-8 w-36"
      >
        {MANAGER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </Select>
    ) : (
      <StatusBadge>{STATUS_LABEL[task.status]}</StatusBadge>
    )

  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {rows.map((t) => (
          <div key={t.id} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => onOpen(t.id)} className="text-left font-medium hover:text-primary hover:underline">
                {t.title}
              </button>
              <PriorityPill task={t} />
            </div>
            {t.project_name && <p className="mt-1 truncate text-sm text-muted-foreground">{t.project_name}</p>}
            <div className="mt-3 flex items-center gap-2">
              {statusCell(t)}
              <DueText task={t} today={today} />
            </div>
            {canManage && (
              <div className="mt-2 flex justify-end gap-1">
                <EditTaskDialog
                  task={t}
                  trigger={
                    <Button size="sm" variant="ghost" aria-label={`Edit ${t.title}`}>
                      <Pencil />
                    </Button>
                  }
                />
                <Button size="sm" variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => void onDelete(t)}>
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="table-wrap rounded-lg border border-border">
      <table className="table-sticky w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="min-w-64 px-4 py-2 font-medium">Task</th>
            <th className="px-4 py-2 font-medium">Tag</th>
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
                  onClick={() => onOpen(t.id)}
                  className={cn(
                    'text-left font-medium hover:text-primary hover:underline',
                    t.status === 'completed' && 'text-muted-foreground line-through',
                  )}
                >
                  {t.title}
                </button>
                {t.project_name && <p className="truncate text-xs text-muted-foreground">{t.project_name}</p>}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{t.tag}</td>
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
                <PriorityPill task={t} />
              </td>
              <td className="px-4 py-2">
                {t.due_date ? <DueText task={t} today={today} /> : <span className="text-xs text-muted-foreground">No date</span>}
              </td>
              <td className="px-4 py-2">{statusCell(t)}</td>
              <td className="px-4 py-2 text-right">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" title="Open" aria-label={`Open ${t.title}`} onClick={() => onOpen(t.id)}>
                    <Eye />
                  </Button>
                  {canManage && (
                    <>
                      <EditTaskDialog
                        task={t}
                        trigger={
                          <Button size="sm" variant="ghost" title="Edit" aria-label={`Edit ${t.title}`}>
                            <Pencil />
                          </Button>
                        }
                      />
                      <Button size="sm" variant="ghost" title="Delete" aria-label={`Delete ${t.title}`} onClick={() => void onDelete(t)}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TagSelect({ value, onChange }: { value: string; onChange: (tag: string) => void }) {
  const tags: string[] = [...TASK_TAGS]
  if (value && !tags.includes(value)) tags.push(value)
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Tag</Label>
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Tag">
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
    </div>
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

/**
 * A new task. Someone who manages tasks gives it to anyone, on any project;
 * everyone else adds one for themselves (the API holds them to that too).
 */
function NewTaskDialog({ own = false }: { own?: boolean }) {
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
  const [tag, setTag] = useState('General')
  const deliverables = useProductionBoard().data?.items
  // Only the chosen project's own, still-open deliverables: attaching a task to
  // another project's, or to one already delivered, would be a mistake.
  const projectDeliverables = (deliverables ?? []).filter((d) => d.project_id === projectId && d.status !== 'completed' && d.status !== 'cancelled')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? 'tasks-page:new' : null,
    { title, description, projectId, deliverableId, priority, customPriorityCode, dueDate, voiceNoteUrl, assignees, tag },
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
      setTag(v.tag)
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
    setTag('General')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        title: title.trim(),
        project_id: own ? null : projectId || null,
        deliverable_id: own ? null : deliverableId || null,
        status: 'to_do',
        priority,
        tag,
        ...(own ? {} : { custom_priority_code: customPriorityCode || null }),
        assignees: own ? [] : assignees,
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
      <DialogContent title="New task" description={own ? 'A task for yourself. Submit a link when it is done.' : 'Give it a title and a person. They are told straight away.'}>
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
          {!own && <AssigneePicker selected={assignees} onChange={setAssignees} />}
          <div className="grid gap-3 sm:grid-cols-3">
            {!own && (<>
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
            </>)}
            <TagSelect value={tag} onChange={setTag} />
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
          {/* Always shown to managers: hidden while the list was empty, nobody
              ever found out labels existed. A new one is added right here. */}
          {!own && (
            <div className="flex flex-col gap-1.5">
              <Label>Custom label (optional)</Label>
              <TaskLabelPicker
                value={customPriorityCode}
                onChange={setCustomPriorityCode}
                options={customPriorities ?? []}
                noneLabel={`None — use ${PRIORITY_LABEL[priority]}`}
              />
            </div>
          )}
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
  const [tag, setTag] = useState(task.tag)
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(
    open ? `tasks-page:${task.id}` : null,
    { title, description, projectId, priority, customPriorityCode, dueDate, voiceNoteUrl, assignees, tag },
    (v) => {
      setTitle(v.title)
      setDescription(v.description)
      setProjectId(v.projectId)
      setPriority(v.priority)
      setCustomPriorityCode(v.customPriorityCode)
      setDueDate(v.dueDate)
      setVoiceNoteUrl(v.voiceNoteUrl)
      setAssignees(v.assignees)
      setTag(v.tag)
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
          tag,
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
            <TagSelect value={tag} onChange={setTag} />
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
