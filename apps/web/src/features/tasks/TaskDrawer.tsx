import { useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { TASK_TAGS, type TaskListItem, type TaskStatus } from '@ipc/contracts'
import { Sheet, SheetContent } from '@/shared/ui/sheet'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { Select, Textarea } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { SkeletonList } from '@/shared/ui/skeleton'
import { cn } from '@/shared/ui/cn'
import { useBlockTask, useMoveTask, useSubtasks, useTask, useTaskActivity, useTaskSubmissions, useUpdateTask } from './api'
import { STATUS_LABEL, todayISO } from './board'
import { ASSIGNEE_STATUSES, canReview, extractUrls, hostOf, isOpen, isWebLink } from './delegation'
import { DueText, PriorityPill } from './TaskCard'
import { ReviewBox, SubmitWorkForm, useTaskViewer } from './TaskActions'

const STATUS_TONE: Record<TaskStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  to_do: 'neutral',
  in_progress: 'info',
  review: 'warning',
  blocked: 'danger',
  completed: 'success',
  cancelled: 'neutral',
}
const ALL_STATUSES: TaskStatus[] = ['to_do', 'in_progress', 'review', 'blocked', 'completed', 'cancelled']

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const fmtWhen = (iso: string) => when.format(new Date(iso))

/**
 * One task, whole: the review (when it waits for you), moving it, handing in
 * work, what was handed in, and what happened. Opens from any card, and from
 * a notification (/tasks?open=<id>).
 */
export function TaskDrawer({
  taskId,
  onClose,
  editSlot,
}: {
  taskId: string
  onClose: () => void
  /** The page's own edit dialog trigger, for someone who manages tasks. */
  editSlot?: ((task: TaskListItem) => ReactNode) | undefined
}) {
  const { data: task, isLoading, isError } = useTask(taskId)
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={task?.title ?? 'Task'} className="overflow-y-auto">
        {isLoading ? (
          <div className="p-5">
            <SkeletonList rows={5} columns={2} />
          </div>
        ) : isError || !task ? (
          <p className="p-5 text-sm text-muted-foreground">This task could not be opened. It may have been deleted.</p>
        ) : (
          <DrawerBody task={task} editSlot={editSlot} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function DrawerBody({ task, editSlot }: { task: TaskListItem; editSlot?: ((task: TaskListItem) => ReactNode) | undefined }) {
  const today = todayISO()
  const { me, canManage } = useTaskViewer()
  const onIt = !!me && task.assignee_ids.includes(me)
  const links = extractUrls(task.description)
  const subtasks = useSubtasks(task.id)

  return (
    <div className="flex flex-col gap-5 p-5 pt-12">
      <header className="flex flex-col gap-2">
        <h2 className={cn('text-lg font-semibold leading-snug', task.status === 'completed' && 'line-through')}>{task.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</StatusBadge>
          <PriorityPill task={task} />
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-muted px-2 text-[11px] font-medium text-muted-foreground">
            {task.tag}
          </span>
          <DueText task={task} today={today} />
        </div>
        {task.project_name && <p className="text-sm text-muted-foreground">Project · {task.project_name}</p>}
      </header>

      {canReview(task, me, canManage) && <ReviewBox task={task} />}

      {task.status === 'blocked' && task.blocked_reason && (
        <p className="rounded-lg bg-tone-amber-soft px-3 py-2 text-sm text-tone-amber">Blocked: {task.blocked_reason}</p>
      )}

      <StatusRow task={task} onIt={onIt} canManage={canManage} />

      {(canManage || editSlot) && (
        <div className="flex flex-wrap items-center gap-2">
          {canManage && <TagPicker task={task} />}
          {editSlot?.(task)}
        </div>
      )}

      {task.description && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</h3>
          <p className="whitespace-pre-wrap text-sm">{task.description}</p>
          {links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {links.map((l) => (
                <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  <ExternalLink className="size-3.5" aria-hidden /> {hostOf(l)}
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {task.assignee_names.length > 0 ? (
          task.assignee_names.map((n) => (
            <span key={n} className="flex items-center gap-1.5">
              <Avatar name={n} size="sm" /> {n}
            </span>
          ))
        ) : (
          <span className="text-warning">Nobody is on this task yet</span>
        )}
        {task.created_by_name && <span className="text-muted-foreground">Given by {task.created_by_name}</span>}
        {task.voice_note_url && (
          <a href={task.voice_note_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Voice note
          </a>
        )}
      </section>

      {onIt && isOpen(task) && (
        <section className="rounded-xl border border-border p-3">
          <h3 className="mb-2 text-sm font-medium">Submit work</h3>
          <SubmitWorkForm taskId={task.id} />
        </section>
      )}

      <Submissions taskId={task.id} />

      {subtasks.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subtasks</h3>
          <ul className="flex flex-col gap-1.5">
            {subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <StatusBadge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</StatusBadge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Activity taskId={task.id} />
    </div>
  )
}

/** Move it: the person on it picks from their four; a manager from all. Blocked asks why. */
function StatusRow({ task, onIt, canManage }: { task: TaskListItem; onIt: boolean; canManage: boolean }) {
  const move = useMoveTask()
  const block = useBlockTask()
  const [askReason, setAskReason] = useState(false)
  const [reason, setReason] = useState('')
  if (!onIt && !canManage) return null
  if (!canManage && !isOpen(task)) return null
  const options = canManage ? ALL_STATUSES : ASSIGNEE_STATUSES

  return (
    <section className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status</span>
        <Select
          value={task.status}
          className="h-9 w-44"
          aria-label="Status"
          disabled={move.isPending}
          onChange={(e) => {
            const status = e.target.value as TaskStatus
            if (status === 'blocked') return setAskReason(true)
            setAskReason(false)
            move.mutate({ id: task.id, status, manage: canManage && (!onIt || status === 'completed' || status === 'cancelled') })
          }}
        >
          {!options.includes(task.status) && <option value={task.status}>{STATUS_LABEL[task.status]}</option>}
          {options.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </label>
      {askReason && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!reason.trim()) return
            block.mutate(
              { id: task.id, input: { reason: reason.trim() } },
              {
                onSuccess: () => {
                  setAskReason(false)
                  setReason('')
                },
              },
            )
          }}
        >
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What is blocking this?" aria-label="Blocked reason" autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setAskReason(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!reason.trim() || block.isPending}>
              Mark blocked
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

function TagPicker({ task }: { task: TaskListItem }) {
  const update = useUpdateTask()
  const tags: string[] = [...TASK_TAGS]
  if (!tags.includes(task.tag)) tags.push(task.tag)
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Tag</span>
      <Select
        value={task.tag}
        className="h-9 w-36"
        aria-label="Tag"
        onChange={(e) => update.mutate({ id: task.id, patch: { tag: e.target.value } })}
      >
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
    </label>
  )
}

const SUB_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'info'> = {
  submitted: 'info',
  approved: 'success',
  sent: 'success',
  rejected: 'warning',
}
const SUB_LABEL: Record<string, string> = { submitted: 'Waiting for review', approved: 'Approved', sent: 'Approved', rejected: 'Sent back' }

function Submissions({ taskId }: { taskId: string }) {
  const { data } = useTaskSubmissions(taskId)
  if (!data || data.length === 0) return null
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Submitted work</h3>
      <ul className="flex flex-col gap-2">
        {data.map((s) => (
          <li key={s.id} className="rounded-lg border border-border p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={SUB_TONE[s.status] ?? 'neutral'}>{SUB_LABEL[s.status] ?? s.status}</StatusBadge>
              <span className="text-xs text-muted-foreground">
                {s.submitted_by_name ?? 'Someone'} · {fmtWhen(s.created_at)}
              </span>
            </div>
            {s.link && isWebLink(s.link) && (
              <a href={s.link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-primary hover:underline">
                <ExternalLink className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{s.link}</span>
              </a>
            )}
            {s.note && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{s.note}</p>}
            {s.review_notes && <p className="mt-1 whitespace-pre-wrap text-tone-amber">Reviewer: {s.review_notes}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Activity({ taskId }: { taskId: string }) {
  const { data } = useTaskActivity(taskId)
  const [all, setAll] = useState(false)
  if (!data || data.length === 0) return null
  const rows = all ? data : data.slice(0, 5)
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Activity</h3>
      <ol className="flex flex-col gap-2 border-l border-border pl-3">
        {rows.map((a) => (
          <li key={a.id} className="text-sm">
            <span className="font-medium">{a.user_name ?? 'Studio'}</span> <span className="text-muted-foreground">{a.action}</span>
            <span className="block text-xs text-muted-foreground">{fmtWhen(a.created_at)}</span>
          </li>
        ))}
      </ol>
      {data.length > 5 && (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAll((v) => !v)}>
          {all ? 'Show less' : `Show all (${data.length})`}
        </Button>
      )}
    </section>
  )
}
