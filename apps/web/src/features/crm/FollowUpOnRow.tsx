import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Moon } from 'lucide-react'
import type { CrmActivity } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { TONE_CHIP } from '@/shared/ui/tones'
import { useActivities, useUpdateActivity } from './api'
import { useLookupColor } from './fields'
import { dueWords, followUpBucket, presetAt } from './follow-ups'

/** Every open follow-up with a date, the caller's or the studio's. */
export function useOpenFollowUps(scope: 'mine' | 'all') {
  return useActivities({ openTasks: true, mine: scope === 'mine' })
}

/**
 * What was promised, on the call row: the follow-up's type and priority as
 * chips and when it is owed. Red only once it is late.
 */
export function FollowUpTag({ task, showAssignee }: { task: CrmActivity; showAssignee?: boolean | undefined }) {
  const typeColor = useLookupColor('follow_up_type')
  const priorityColor = useLookupColor('follow_up_priority')
  const now = useMemo(() => new Date(), [])
  const tc = typeColor(task.subject)
  const pc = priorityColor(task.priority)
  const late = task.due_at ? followUpBucket(task.due_at, now) === 'overdue' : false
  return (
    <>
      <span className={cn('rounded-full border px-2 py-0.5 text-[0.7rem]', tc ? TONE_CHIP[tc] : 'border-border bg-muted')}>
        {task.subject ?? 'Follow-up'}
      </span>
      {task.priority && task.priority !== 'Normal' && (
        <span className={cn('rounded-full border px-2 py-0.5 text-[0.7rem]', pc ? TONE_CHIP[pc] : 'border-border bg-muted')}>
          {task.priority}
        </span>
      )}
      {task.due_at && (
        <span className={cn(late ? 'font-medium text-tone-rose' : 'text-muted-foreground')}>{dueWords(task.due_at, now)}</span>
      )}
      {showAssignee && task.assignee_name && <span>· {task.assignee_name}</span>}
    </>
  )
}

/** Push a follow-up to tomorrow 11 am, or mark it done, from the row. */
export function FollowUpActions({ task }: { task: CrmActivity }) {
  const update = useUpdateActivity()
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        title="Move to tomorrow 11 am"
        disabled={update.isPending}
        onClick={() => update.mutate({ id: task.id, patch: { due_at: presetAt('tomorrow').toISOString() } })}
      >
        <Moon /> <span className="hidden sm:inline">Tomorrow</span>
      </Button>
      <Button
        size="sm"
        className="bg-tone-green text-card hover:bg-tone-green/90"
        disabled={update.isPending}
        onClick={() => update.mutate({ id: task.id, patch: { done: true } })}
      >
        <Check /> Done
      </Button>
    </>
  )
}

/**
 * The follow-ups whose lead is not owed a call today (tomorrow, later this
 * week, or a lead given to someone else), after the call list. One row a
 * lead; a lead already in the list carries its follow-up on its own row.
 */
export function ComingUpFollowUps({ tasks, scope }: { tasks: CrmActivity[]; scope: 'mine' | 'all' }) {
  if (tasks.length === 0) return null
  return (
    <section aria-label="Follow-ups coming up" className="mt-4">
      <h2 className="mb-2 text-sm font-semibold">Coming up</h2>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
            <div className="min-w-0 flex-1">
              <Link to="/follow-ups" search={{ lead: t.lead_id } as never} className="block truncate font-medium hover:underline">
                {t.lead_name ?? 'Lead'}
              </Link>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <FollowUpTag task={t} showAssignee={scope === 'all'} />
              </p>
            </div>
            <span className="flex shrink-0 gap-1.5">
              <FollowUpActions task={t} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
