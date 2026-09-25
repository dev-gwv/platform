import { useState, type FormEvent } from 'react'
import { CalendarDays, Plus, Trash2, UserPlus } from 'lucide-react'
import type { TaskListItem } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { RowMenu } from '@/shared/ui/row-menu'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { cn } from '@/shared/ui/cn'
import { useAccess } from '@/shared/auth/useAccess'
import { useFormDraft } from '@/shared/hooks/use-form-draft'
import { useMembers } from '@/features/allocation/api'
import { useCreateTask, useDeleteTask, useProjectTasks, useUpdateTask, useUpdateTaskStatus } from '@/features/tasks/api'
import { todayISO } from '@/features/tasks/board'
import { RemindMe } from '@/features/reminders/RemindMe'

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/**
 * The extra jobs on this project -- "call the florist", "re-export the reel
 * for Instagram" -- that are not a deliverable. Add one, pick who, set a
 * date, tick it off: all right here. (The Add button used to open the task
 * board with nothing filled in.)
 */
export function TasksTab({
  projectId,
  canEdit,
  deliverables,
}: {
  projectId: string
  canEdit: boolean
  deliverables: readonly { id: string; title: string }[]
}) {
  const access = useAccess()
  const { data, isLoading, isError, refetch } = useProjectTasks(projectId)

  if (!access.hasModule('tasks')) {
    return (
      <Card className="mt-4">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">Tasks are not switched on for your account.</CardContent>
      </Card>
    )
  }
  if (isLoading) return <SkeletonList rows={3} columns={3} />
  if (isError) return <ErrorState onRetry={() => void refetch()} />

  const all = (data ?? []).filter((t) => !t.parent_task_id && t.status !== 'cancelled')
  const open = all.filter((t) => t.status !== 'completed')
  const done = all.filter((t) => t.status === 'completed')
  const deliverableTitle = new Map(deliverables.map((d) => [d.id, d.title]))

  return (
    <div className="mt-4 flex flex-col gap-3">
      {canEdit && <AddTaskRow projectId={projectId} />}

      {all.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No tasks yet. Add anything that needs doing for this project and isn’t a deliverable.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {open.map((t) => (
              <TaskRow key={t.id} t={t} canEdit={canEdit} deliverableTitle={deliverableTitle} />
            ))}
          </ul>
          {done.length > 0 && (
            <>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Done ({done.length})</p>
              <ul className="flex flex-col gap-1.5">
                {done.map((t) => (
                  <TaskRow key={t.id} t={t} canEdit={canEdit} deliverableTitle={deliverableTitle} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** One line to add a task: what, who, by when. Enter adds it. */
function AddTaskRow({ projectId }: { projectId: string }) {
  const create = useCreateTask()
  const { data: members } = useMembers()
  const [title, setTitle] = useState('')
  const [who, setWho] = useState('')
  const [due, setDue] = useState('')
  // What was typed survives a refresh or a closed tab until it is saved.
  const draft = useFormDraft(`project-task:new:${projectId}`, { title, who, due }, (v) => {
    setTitle(v.title)
    setWho(v.who)
    setDue(v.due)
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    create.mutate(
      {
        project_id: projectId,
        deliverable_id: null,
        title: title.trim(),
        status: 'to_do',
        priority: 'medium',
        assignees: who ? [who] : [],
        ...(due ? { due_date: due } : {}),
      },
      {
        onSuccess: () => {
          draft.clear()
          setTitle('')
          setDue('')
        },
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
      <Input
        aria-label="New task"
        placeholder="Add a task, e.g. Call the florist"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="min-w-[14rem] flex-1"
      />
      <select
        aria-label="Who"
        value={who}
        onChange={(e) => setWho(e.target.value)}
        className="h-9 rounded-md border border-input bg-card px-2 text-sm"
      >
        <option value="">Anyone</option>
        {(members ?? []).map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.name}
          </option>
        ))}
      </select>
      <Input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
      <Button type="submit" disabled={!title.trim() || create.isPending}>
        <Plus /> Add
      </Button>
    </form>
  )
}

function TaskRow({ t, canEdit, deliverableTitle }: { t: TaskListItem; canEdit: boolean; deliverableTitle: Map<string, string> }) {
  const setStatus = useUpdateTaskStatus()
  const update = useUpdateTask()
  const del = useDeleteTask()
  const { data: members } = useMembers()
  const [editingDue, setEditingDue] = useState(false)
  const done = t.status === 'completed'
  const late = !done && !!t.due_date && t.due_date < todayISO()
  const forDeliverable = t.deliverable_id ? deliverableTitle.get(t.deliverable_id) : null

  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2', done && 'opacity-60')}>
      <input
        type="checkbox"
        aria-label={done ? `Mark ${t.title} not done` : `Mark ${t.title} done`}
        checked={done}
        disabled={!canEdit || setStatus.isPending}
        onChange={() => setStatus.mutate({ id: t.id, status: done ? 'to_do' : 'completed' })}
        className="size-4 accent-primary"
      />
      <div className="min-w-[12rem] flex-1">
        <p className={cn('text-sm font-medium', done && 'line-through')}>{t.title}</p>
        {forDeliverable && <p className="text-xs text-muted-foreground">For: {forDeliverable}</p>}
      </div>

      {/* Who -- changed right here. */}
      {canEdit && !done ? (
        <label className="inline-flex items-center gap-1 text-xs">
          <UserPlus className={cn('size-3.5', t.assignee_ids.length ? 'text-muted-foreground' : 'text-primary')} aria-hidden />
          <select
            aria-label={`Who does ${t.title}`}
            value={t.assignee_ids[0] ?? ''}
            onChange={(e) => update.mutate({ id: t.id, patch: { assignees: e.target.value ? [e.target.value] : [] } })}
            className={cn('cursor-pointer appearance-none bg-transparent font-medium hover:underline', t.assignee_ids.length ? 'text-muted-foreground' : 'text-primary')}
          >
            <option value="">Assign</option>
            {t.assignee_ids[0] && !(members ?? []).some((m) => m.user_id === t.assignee_ids[0]) && (
              <option value={t.assignee_ids[0]}>{t.assignee_names[0] ?? 'Assigned'}</option>
            )}
            {(members ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        t.assignee_names.length > 0 && <span className="text-xs text-muted-foreground">{t.assignee_names.join(', ')}</span>
      )}

      {/* When -- tap to change. */}
      {canEdit && !done && editingDue ? (
        <Input
          type="date"
          autoFocus
          aria-label={`Due date for ${t.title}`}
          defaultValue={t.due_date ?? ''}
          className="h-7 w-40 text-xs"
          onBlur={() => setEditingDue(false)}
          onChange={(e) => {
            update.mutate({ id: t.id, patch: { due_date: e.target.value || null } })
            setEditingDue(false)
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!canEdit || done}
          onClick={() => setEditingDue(true)}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium',
            late ? 'text-destructive' : t.due_date ? 'text-muted-foreground' : 'text-primary',
            canEdit && !done && 'hover:underline',
          )}
        >
          <CalendarDays className="size-3.5" aria-hidden />
          {t.due_date ? `${late ? 'Late · ' : ''}${day(t.due_date)}` : canEdit && !done ? 'Add date' : ''}
        </button>
      )}

      {/* Anyone who can see the task can ask to be reminded of it. */}
      {!done && <RemindMe entityType="task" entityId={t.id} name={t.title} context={t.project_name} />}

      {canEdit && (
        <RowMenu
          label={`More for ${t.title}`}
          items={[{ label: 'Delete', icon: <Trash2 className="size-4" />, onSelect: () => del.mutate(t.id) }]}
        />
      )}
    </li>
  )
}
