import type { ReactNode } from 'react'
import { Check, CheckCircle2, ExternalLink, Upload } from 'lucide-react'
import type { TaskListItem, TaskPriority } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { StatusBadge } from '@/shared/ui/status-badge'
import { cn } from '@/shared/ui/cn'
import { PRIORITY_LABEL, isOverdue } from './board'
import {
  QUICK_LABEL,
  creatorInitials,
  extractUrls,
  hostOf,
  isOpen,
  isWebLink,
  quickActions,
  type QuickAction,
} from './delegation'

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
export const formatDay = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00`))

const PRIORITY_TONE: Record<TaskPriority, 'danger' | 'warning' | 'neutral' | 'info'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'neutral',
  low: 'info',
}

/** The studio's own label/tone when it set one, else the plain canonical badge. */
export function PriorityPill({ task }: { task: TaskListItem }) {
  if (task.custom_priority_code && task.custom_priority_label && task.custom_priority_tone) {
    return <StatusBadge tone={task.custom_priority_tone}>{task.custom_priority_label}</StatusBadge>
  }
  return <StatusBadge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</StatusBadge>
}

/** "Overdue · 12 Sep" in red, "Today" in amber, a plain date otherwise. */
export function DueText({ task, today, className }: { task: TaskListItem; today: string; className?: string }) {
  if (!task.due_date) return null
  const late = isOverdue(task, today)
  const isToday = isOpen(task) && task.due_date === today
  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        late ? 'font-semibold text-destructive' : isToday ? 'font-medium text-warning' : 'text-muted-foreground',
        className,
      )}
    >
      {late ? `Overdue · ${formatDay(task.due_date)}` : isToday ? 'Today' : formatDay(task.due_date)}
    </span>
  )
}

const SUBMISSION_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Sent back',
  sent: 'Approved',
}

const chip = 'inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium'
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/**
 * One task, at a glance: what it is, how urgent, when, who is on it, who gave
 * it, and the links that matter (the brief in its description, the work
 * handed in). The quick buttons appear on hover (always on a phone).
 *
 * Presentational: dragging and what a button does belong to the caller.
 */
export function TaskCard({
  task,
  today,
  me,
  canManage,
  onOpen,
  onAction,
  lifted,
  select,
}: {
  task: TaskListItem
  today: string
  me: string | null
  canManage: boolean
  onOpen: (task: TaskListItem) => void
  onAction: (task: TaskListItem, action: QuickAction) => void
  /** Being dragged (the overlay copy). */
  lifted?: boolean
  /** A tick for bulk moves on the board. */
  select?: { ticked: boolean; onToggle: () => void }
}) {
  const done = task.status === 'completed'
  const links = extractUrls(task.description)
  const firstLink = links[0]
  const sub = task.latest_submission
  const by = creatorInitials(task)
  const actions = quickActions(task, {
    isAssignee: !!me && task.assignee_ids.includes(me),
    canManage,
  })

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(task)
      }}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors',
        'hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        done && 'border-success/30 bg-success/5',
        task.status === 'blocked' && 'border-tone-amber/50',
        lifted && 'rotate-1 shadow-lg ring-2 ring-primary/30',
        select?.ticked && 'ring-2 ring-primary/50',
      )}
    >
      <div className="flex items-start gap-2">
        {select && (
          <button
            type="button"
            role="checkbox"
            aria-checked={select.ticked}
            aria-label={`Select ${task.title}`}
            onClick={(e) => {
              stop(e)
              select.onToggle()
            }}
            onPointerDown={stop}
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
              select.ticked ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:border-primary/50',
            )}
          >
            {select.ticked && <Check className="size-2.5" aria-hidden />}
          </button>
        )}
        <p className={cn('min-w-0 flex-1 text-sm font-medium leading-snug', done && 'text-muted-foreground line-through')}>
          {task.title}
        </p>
      </div>

      {task.project_name && <p className="-mt-1 truncate text-xs text-muted-foreground">{task.project_name}</p>}

      <div className="flex items-center justify-between gap-2">
        <PriorityPill task={task} />
        <DueText task={task} today={today} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn(chip, 'border-border bg-muted text-muted-foreground')}>{task.tag}</span>
        {firstLink && (
          <a
            href={firstLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop}
            onPointerDown={stop}
            className={cn(chip, 'border-tone-blue/30 bg-card text-tone-blue hover:bg-tone-blue-soft')}
          >
            <ExternalLink className="size-3" aria-hidden /> Open {hostOf(firstLink)}
          </a>
        )}
        {links.length > 1 && <span className="text-[11px] text-muted-foreground">+{links.length - 1}</span>}
        {sub && (
          <span
            className={cn(
              chip,
              sub.status === 'rejected'
                ? 'border-tone-amber/40 bg-tone-amber-soft text-tone-amber'
                : 'border-success/30 bg-success/10 text-success',
            )}
          >
            <CheckCircle2 className="size-3" aria-hidden /> {SUBMISSION_LABEL[sub.status] ?? 'Submitted'}
          </span>
        )}
        {sub?.link && isWebLink(sub.link) && (
          <a
            href={sub.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop}
            onPointerDown={stop}
            className={cn(chip, 'border-success/30 bg-card text-success hover:bg-success/10')}
          >
            <ExternalLink className="size-3" aria-hidden /> Open submission
          </a>
        )}
      </div>

      {task.status === 'blocked' && task.blocked_reason && (
        <p className="rounded-md bg-tone-amber-soft px-2 py-1 text-xs text-tone-amber">Blocked: {task.blocked_reason}</p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {task.assignee_names.length > 0 ? (
            <>
              <Avatar name={task.assignee_names[0]} size="sm" />
              <span className="truncate text-xs text-muted-foreground">
                {task.assignee_names[0]}
                {task.assignee_names.length > 1 ? ` +${task.assignee_names.length - 1}` : ''}
              </span>
            </>
          ) : (
            <span className="text-xs font-medium text-warning">Unassigned</span>
          )}
        </span>
        {by && (
          <span className="shrink-0 text-[11px] text-muted-foreground" title={`Given by ${task.created_by_name}`}>
            by {by}
          </span>
        )}
      </div>

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1 md:hidden md:group-focus-within:flex md:group-hover:flex">
          {actions.map((a) => (
            <QuickButton key={a} action={a} onClick={() => onAction(task, a)} />
          ))}
        </div>
      )}
    </div>
  )
}

function QuickButton({ action, onClick }: { action: QuickAction; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e)
        onClick()
      }}
      onPointerDown={stop}
      className={cn(
        'inline-flex h-7 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 text-[11px] font-medium transition-colors',
        action === 'submit'
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
          : action === 'done'
            ? 'border-success/40 bg-success/10 text-success hover:bg-success/20'
            : action === 'blocked'
              ? 'border-tone-amber/40 bg-tone-amber-soft text-tone-amber hover:opacity-90'
              : 'border-border bg-card text-foreground hover:bg-muted',
      )}
    >
      {action === 'submit' && <Upload className="size-3" aria-hidden />}
      {QUICK_LABEL[action]}
    </button>
  )
}
