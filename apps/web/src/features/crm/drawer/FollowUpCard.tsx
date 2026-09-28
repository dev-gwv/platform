import { useMemo, useState } from 'react'
import { AlarmClock, Check, History, Pencil, X } from 'lucide-react'
import type { CrmActivity } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Input } from '@/shared/ui/input'
import { TONE_CHIP, type ToneName } from '@/shared/ui/tones'
import { useActivities, useDeleteActivity, useLogActivity, useUpdateActivity } from '../api'
import { LookupChip, useLookupColor } from '../fields'
import {
  FOLLOW_UP_PRESETS,
  dueWords,
  followUpBucket,
  presetAt,
  toLocalInput,
  type FollowUpPreset,
} from '../follow-ups'

const STATUS: Record<'overdue' | 'today' | 'upcoming' | 'none', { label: string; tone: ToneName }> = {
  overdue: { label: 'Overdue', tone: 'rose' },
  today: { label: 'Due today', tone: 'amber' },
  upcoming: { label: 'Upcoming', tone: 'blue' },
  none: { label: 'No follow-up', tone: 'slate' },
}

/**
 * "Next follow-up": every promise made to this family, and the one box to
 * make the next. Each is a task (0209) with a time, a type (Call, Site
 * visit, or the studio's own), a priority and a note; the earliest open one
 * is what the call list, the board and the morning email see.
 */
export function FollowUpCard({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const open = useActivities({ leadId, openTasks: true })
  const all = useActivities({ leadId, type: 'task' })
  const log = useLogActivity()
  const update = useUpdateActivity()
  const remove = useDeleteActivity()
  const priorityColor = useLookupColor('follow_up_priority')
  const typeColor = useLookupColor('follow_up_type')

  const [at, setAt] = useState('')
  const [type, setType] = useState<string | null>('Call')
  const [priority, setPriority] = useState<string | null>('Normal')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editAt, setEditAt] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const tasks = open.data ?? []
  const done = useMemo(() => (all.data ?? []).filter((t) => t.done_at), [all.data])
  const now = new Date()
  const first = tasks.find((t) => t.due_at)
  const status = !first?.due_at
    ? 'none'
    : followUpBucket(first.due_at, now) === 'overdue'
      ? 'overdue'
      : followUpBucket(first.due_at, now) === 'today'
        ? 'today'
        : 'upcoming'

  function pick(p: FollowUpPreset) {
    setAt(toLocalInput(presetAt(p)))
  }

  function add() {
    if (!at) return
    log.mutate(
      {
        lead_id: leadId,
        type: 'task',
        direction: 'none',
        subject: type || 'Follow-up',
        due_at: new Date(at).toISOString(),
        ...(priority ? { priority } : {}),
        ...(note.trim() ? { body: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          setAt('')
          setNote('')
        },
      },
    )
  }

  return (
    <section
      aria-label="Next follow-up"
      className={cn(
        'rounded-xl border p-3',
        status === 'overdue' ? 'border-tone-rose/50 bg-tone-rose-soft/40' : 'border-tone-amber/40 bg-tone-amber-soft/30',
      )}
    >
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tone-amber">
        <AlarmClock className="size-3.5" /> Next follow-up
        <span className={cn('rounded-full border px-2 py-0.5 text-[0.65rem] normal-case tracking-normal', TONE_CHIP[STATUS[status].tone])}>
          {STATUS[status].label}
        </span>
      </h3>

      {tasks.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {tasks.map((t: CrmActivity) => {
            const b = t.due_at ? followUpBucket(t.due_at, now) : null
            const pc = priorityColor(t.priority)
            const tc = typeColor(t.subject)
            return (
              <li key={t.id} className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn('rounded-full border px-2 py-0.5 text-[0.7rem] font-medium', tc ? TONE_CHIP[tc] : 'border-border bg-muted')}>
                    {t.subject ?? 'Follow-up'}
                  </span>
                  {t.priority && (
                    <span className={cn('rounded-full border px-2 py-0.5 text-[0.7rem]', pc ? TONE_CHIP[pc] : 'border-border bg-muted')}>
                      {t.priority}
                    </span>
                  )}
                  <span className={cn('text-xs font-medium', b === 'overdue' ? 'text-tone-rose' : 'text-foreground')}>
                    {t.due_at ? dueWords(t.due_at, now) : 'No time set'}
                  </span>
                  {t.assignee_name && <span className="text-[0.7rem] text-muted-foreground">· {t.assignee_name}</span>}
                </div>
                {t.body && <p className="mt-1 text-xs text-muted-foreground">{t.body}</p>}
                {editing === t.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input type="datetime-local" value={editAt} onChange={(e) => setEditAt(e.target.value)} className="h-8 w-52" />
                    <Button
                      size="sm"
                      disabled={!editAt || update.isPending}
                      onClick={() =>
                        update.mutate(
                          { id: t.id, patch: { due_at: new Date(editAt).toISOString() } },
                          { onSuccess: () => setEditing(null) },
                        )
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  canEdit && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        className="h-7 bg-tone-green text-card hover:bg-tone-green/90"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: t.id, patch: { done: true } })}
                      >
                        <Check /> Mark done
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => {
                          setEditing(t.id)
                          setEditAt(toLocalInput(t.due_at))
                        }}
                      >
                        <Pencil /> Reschedule
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => remove.mutate(t.id)}>
                        <X /> Cancel
                      </Button>
                    </div>
                  )
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-card/70 p-2.5">
          <div className="flex flex-wrap gap-1.5">
            {FOLLOW_UP_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => pick(p.key)}
                className="h-7 rounded-full border border-border bg-card px-2.5 text-xs hover:border-primary/40"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="datetime-local"
              aria-label="Follow-up time"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className={cn('h-8 w-52', at ? 'border-tone-green/60' : 'border-tone-amber/60 bg-tone-amber-soft/30')}
            />
            <LookupChip category="follow_up_type" noun="type" value={type} onChange={setType} clearable={false} aria-label="Follow-up type" />
            <LookupChip
              category="follow_up_priority"
              noun="priority"
              value={priority}
              onChange={setPriority}
              clearable={false}
              aria-label="Priority"
            />
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What is it for? (optional)"
            className="h-8"
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={add} disabled={!at || log.isPending}>
              Add follow-up
            </Button>
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <History className="size-3" /> {showHistory ? 'Hide' : 'Show'} {done.length} done
          </button>
          {showHistory && (
            <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
              {done.map((t) => (
                <li key={t.id}>
                  ✓ {t.subject ?? 'Follow-up'} · done{' '}
                  {t.done_at ? new Date(t.done_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
