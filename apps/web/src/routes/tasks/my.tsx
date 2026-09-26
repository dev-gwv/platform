import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Clock, Layers, Mic } from 'lucide-react'
import type { TaskListItem, TaskPriority, TaskStatus } from '@ipc/contracts'
import { PageHeader } from '@/shared/layout/page-header'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/shared/ui/dialog'
import { Input, Label, Select } from '@/shared/ui/input'
import { SkeletonList } from '@/shared/ui/skeleton'
import { StatusBadge } from '@/shared/ui/status-badge'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { HowToUse } from '@/shared/ui/how-to-use'
import { useMyTasks, useUpdateMyTaskStatus } from '@/features/tasks/api'
import { RemindMe } from '@/features/reminders/RemindMe'
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  todayISO,
} from '@/features/tasks/board'
import { assigneeStatusOptions } from '@/features/tasks/delegation'

const STATUSES: TaskStatus[] = ['to_do', 'in_progress', 'review', 'blocked', 'completed', 'cancelled']

type SortKey = 'due_asc' | 'due_desc' | 'recent' | 'priority'
type StatusFilter = 'all' | TaskStatus

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

const PRIORITY_TONE = { low: 'neutral', medium: 'info', high: 'warning', urgent: 'danger' } as const

function compareTasks(a: TaskListItem, b: TaskListItem, sort: SortKey): number {
  if (sort === 'priority') {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (pr !== 0) return pr
  }
  if (!a.due_date && !b.due_date) return a.title.localeCompare(b.title)
  if (!a.due_date) return 1
  if (!b.due_date) return -1
  if (a.due_date === b.due_date) return 0
  if (sort === 'due_desc') return a.due_date < b.due_date ? 1 : -1
  return a.due_date < b.due_date ? -1 : 1
}

interface Buckets {
  overdue: TaskListItem[]
  dueToday: TaskListItem[]
  upcoming: TaskListItem[]
  noDue: TaskListItem[]
  completed: TaskListItem[]
}

function bucketize(items: TaskListItem[], sort: SortKey, today: string): Buckets {
  const out: Buckets = { overdue: [], dueToday: [], upcoming: [], noDue: [], completed: [] }
  for (const t of items) {
    if (t.status === 'completed' || t.status === 'cancelled') {
      out.completed.push(t)
      continue
    }
    if (!t.due_date) out.noDue.push(t)
    else if (t.due_date < today) out.overdue.push(t)
    else if (t.due_date === today) out.dueToday.push(t)
    else out.upcoming.push(t)
  }
  const fn = (a: TaskListItem, b: TaskListItem) => compareTasks(a, b, sort)
  out.overdue.sort(fn)
  out.dueToday.sort(fn)
  out.upcoming.sort(fn)
  out.noDue.sort(fn)
  out.completed.sort(fn)
  return out
}

/**
 * My tasks as buckets (Lovable parity with _app.tasks.my): summary cards,
 * sort + status filter, and Overdue / Due-today / Upcoming / No-date /
 * Completed groups with inline status moves and voice notes.
 */
export function MyTasksPage() {
  return <MyTasks />
}

function MyTasks() {
  const { data, isLoading, isError, error, refetch } = useMyTasks()
  const move = useUpdateMyTaskStatus()
  const today = todayISO()
  const [sort, setSort] = useState<SortKey>('due_asc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [voiceTask, setVoiceTask] = useState<TaskListItem | null>(null)
  const [voiceUrl, setVoiceUrl] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const tasks = useMemo(() => data ?? [], [data])

  const summary = useMemo(() => {
    const s = { dueToday: 0, overdue: 0, inProgress: 0, completed: 0 }
    for (const t of tasks) {
      if (t.status === 'completed') {
        s.completed++
        continue
      }
      if (t.status === 'cancelled') continue
      if (t.status === 'in_progress') s.inProgress++
      if (t.due_date === today) s.dueToday++
      else if (t.due_date && t.due_date < today) s.overdue++
    }
    return s
  }, [tasks, today])

  const filtered = useMemo(
    () => (statusFilter === 'all' ? tasks : tasks.filter((t) => t.status === statusFilter)),
    [tasks, statusFilter],
  )
  const buckets = useMemo(() => bucketize(filtered, sort, today), [filtered, sort, today])

  function onChangeStatus(t: TaskListItem, status: TaskStatus) {
    setBusyId(t.id)
    move.mutate(
      { id: t.id, status },
      { onSettled: () => setBusyId(null) },
    )
  }

  function openVoice(t: TaskListItem) {
    setVoiceTask(t)
    setVoiceUrl(t.voice_note_url ?? '')
  }

  function saveVoice() {
    if (!voiceTask) return
    setBusyId(voiceTask.id)
    move.mutate(
      { id: voiceTask.id, status: voiceTask.status, voice_note_url: voiceUrl.trim() || null },
      {
        onSettled: () => {
          setBusyId(null)
          setVoiceTask(null)
        },
      },
    )
  }

  const renderTask = (t: TaskListItem) => {
    const overdue = t.status !== 'completed' && t.status !== 'cancelled' && !!t.due_date && t.due_date < today
    const dueToday = !!t.due_date && t.due_date === today && t.status !== 'completed'
    return (
      <div key={t.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{t.title}</p>
          {t.description && <p className="truncate text-xs text-muted-foreground">{t.description}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</StatusBadge>
            {t.due_date && <StatusBadge tone="neutral">Due {t.due_date}</StatusBadge>}
            {overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
            {dueToday && <StatusBadge tone="warning">Due today</StatusBadge>}
            {t.project_name && <span className="text-[11px] text-muted-foreground">{t.project_name}</span>}
            {t.voice_note_url && <StatusBadge tone="info">Voice note</StatusBadge>}
          </div>
          <p className="mt-1 text-xs">
            <span className="font-medium text-muted-foreground">Next action: </span>
            {t.status === 'completed'
              ? 'No action needed'
              : t.status === 'cancelled'
                ? 'Cancelled — no action'
                : overdue
                  ? 'Complete overdue work'
                  : dueToday
                    ? 'Complete today'
                    : t.status === 'in_progress'
                      ? 'Continue work'
                      : 'Start this task'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={t.status}
            disabled={busyId === t.id}
            onChange={(e) => onChangeStatus(t, e.target.value as TaskStatus)}
            className="h-8 w-36"
            aria-label={`Status for ${t.title}`}
          >
            {assigneeStatusOptions(t.status).map((s) => (
              <option key={s} value={s} disabled={s === 'completed' || s === 'cancelled' || s === 'blocked'}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Button size="sm" variant="outline" onClick={() => openVoice(t)}>
            <Mic /> Voice note
          </Button>
          {t.status !== 'completed' && t.status !== 'cancelled' && (
            <RemindMe entityType="task" entityId={t.id} name={t.title} context={t.project_name} />
          )}
        </div>
      </div>
    )
  }

  const Section = ({ title, icon: Icon, items }: { title: string; icon: typeof Clock; items: TaskListItem[] }) => {
    if (items.length === 0) return null
    return (
      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Icon className="size-4" /> {title}
          <span className="rounded-full bg-muted px-1.5 text-[11px]">{items.length}</span>
        </h2>
        <div className="flex flex-col gap-2">{items.map(renderTask)}</div>
      </section>
    )
  }

  return (
    <>
      <PageHeader title="My tasks" description="Everything assigned to you, most urgent first." />
      <HowToUse
        title="Work the list top-down"
        description="Overdue first, then what is due soonest. Start a task when you pick it up and mark it done when it is."
        steps={['Pick the top task.', 'Change its status.', 'Attach a voice note when words are faster than typing.']}
      />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Due today" value={summary.dueToday} icon={Clock} />
        <SummaryCard label="Overdue" value={summary.overdue} icon={AlertCircle} warn={summary.overdue > 0} />
        <SummaryCard label="In progress" value={summary.inProgress} icon={Layers} />
        <SummaryCard label="Completed" value={summary.completed} icon={CheckCircle2} />
      </div>

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
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <SkeletonList rows={5} columns={5} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : tasks.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                title="Nothing assigned to you yet"
                description="When a manager assigns you a task, it will appear here."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <Section title="Overdue" icon={Clock} items={buckets.overdue} />
            <Section title="Due today" icon={Clock} items={buckets.dueToday} />
            <Section title="Upcoming" icon={Clock} items={buckets.upcoming} />
            <Section title="No due date" icon={Clock} items={buckets.noDue} />
            <Section title="Completed" icon={CheckCircle2} items={buckets.completed} />
          </div>
        )}
      </div>

      <Dialog open={!!voiceTask} onOpenChange={(v) => { if (!v) setVoiceTask(null) }}>
        <DialogContent title="Voice note" description="Paste a link to your voice note (audio file or recording).">
          <div className="flex flex-col gap-1.5">
            <Label>URL</Label>
            <Input value={voiceUrl} onChange={(e) => setVoiceUrl(e.target.value)} placeholder="https://" />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={saveVoice} disabled={busyId !== null}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
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
