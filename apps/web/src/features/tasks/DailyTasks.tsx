import { useMemo, useState } from 'react'
import { CalendarClock, Check, CircleAlert, Pause, Pencil, Play, Plus, Repeat, Search, Trash2, Users } from 'lucide-react'
import type { DirectoryMember, SaveRoutineRequest, TaskRoutine } from '@ipc/contracts'
import { useDirectory } from '@/features/team/api'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { Input, Label, Textarea } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useConfirm } from '@/shared/ui/confirm'
import { IconTile } from '@/shared/ui/icon-tile'
import { todayInIndia } from '@/shared/ui/days-left'
import { clockText, repeatLine, todayLine, useDailyDone, useDeleteRoutine, usePauseRoutine, useRoutines, useSaveRoutine } from './routines'

/**
 * Daily tasks (owner, 14 Nov: "a place where we can set a recurring task ...
 * for any team member ... it should show them daily on the dashboard. If they
 * do not ... there should be an intimation"). Each one is a card: what, for
 * whom, which days and by when, and today's state per person -- done, still
 * to do, or late -- with how the last week went. The person sees today's copy
 * on their Home with one Done button; a copy still open past its time rings
 * them and whoever set it.
 */
export function DailyTasks({ manage }: { manage: boolean }) {
  const q = useRoutines(!manage)
  const [editing, setEditing] = useState<TaskRoutine | 'new' | null>(null)
  const list = q.data ?? []
  const lateNow = list.reduce((n, r) => n + (r.paused ? 0 : r.people.filter((p) => p.today === 'late').length), 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={Repeat} tone="violet" />
          <div className="min-w-0">
            <p className="font-semibold">Daily tasks</p>
            <p className="text-sm text-muted-foreground">
              {list.length === 0
                ? 'Work that comes back by itself, every day or on the days you pick.'
                : `${list.length} daily task${list.length === 1 ? '' : 's'}${lateNow ? ` · ${lateNow} late today` : ''}`}
            </p>
          </div>
        </div>
        {manage && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add daily task
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="font-medium">{manage ? 'No daily tasks yet' : 'Nothing set for you yet'}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {manage
              ? 'For example: "Back up yesterday\'s cards by 11 am", "Post one Instagram story", "Call 10 leads". Each person gets it on their Home every day.'
              : 'When your studio sets a daily task for you, it shows here and on your Home.'}
          </p>
          {manage && (
            <Button className="mt-4" onClick={() => setEditing('new')}>
              <Plus /> Add daily task
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {list.map((r) => (
            <RoutineCard key={r.id} routine={r} manage={manage} onEdit={() => setEditing(r)} />
          ))}
        </ul>
      )}

      {editing && <RoutineDialog routine={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function RoutineCard({ routine: r, manage, onEdit }: { routine: TaskRoutine; manage: boolean; onEdit: () => void }) {
  const pause = usePauseRoutine()
  const remove = useDeleteRoutine()
  const done = useDailyDone()
  const confirm = useConfirm()
  return (
    <li className={cn('rounded-xl border bg-card p-4', r.paused ? 'border-dashed border-border opacity-75' : 'border-border')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{r.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarClock className="size-4 shrink-0" aria-hidden /> {repeatLine(r)}
          </p>
          {r.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
            r.paused
              ? 'bg-muted text-muted-foreground'
              : r.people.some((p) => p.today === 'late')
                ? 'bg-warning/15 text-warning'
                : r.people.length > 0 && r.people.every((p) => p.today === 'done' || p.today === 'none') && r.people.some((p) => p.today === 'done')
                  ? 'bg-success/15 text-success'
                  : 'bg-muted text-foreground/80',
          )}
        >
          {todayLine(r)}
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-1.5">
        {r.people.map((p) => (
          <li key={p.user_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full',
                p.today === 'done' ? 'bg-success text-success-foreground' : p.today === 'late' ? 'bg-warning text-white' : 'border border-input',
              )}
              aria-hidden
            >
              {p.today === 'done' ? <Check className="size-3.5" /> : p.today === 'late' ? <CircleAlert className="size-3.5" /> : null}
            </span>
            <span className="min-w-0 flex-1 font-medium">{p.name}</span>
            <span className={cn('text-xs', p.today === 'late' ? 'font-medium text-warning' : 'text-muted-foreground')}>
              {p.today === 'done' ? 'Done today' : p.today === 'late' ? 'Not done, late' : p.today === 'open' ? 'Still to do' : 'Not due today'}
              {p.done_7 + p.missed_7 > 0 && ` · last 7 days: ${p.done_7} done${p.missed_7 ? `, ${p.missed_7} missed` : ''}`}
            </span>
            {!manage && p.task_id && p.today !== 'none' && (
              <Button size="sm" variant={p.today === 'done' ? 'outline' : 'default'} disabled={done.isPending} onClick={() => done.mutate({ id: p.task_id!, done: p.today !== 'done' })}>
                {p.today === 'done' ? 'Not done' : <><Check /> Done</>}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {manage && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
          <Button size="sm" variant="outline" disabled={pause.isPending} onClick={() => pause.mutate({ id: r.id, paused: !r.paused })}>
            {r.paused ? <><Play /> Resume</> : <><Pause /> Pause</>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="hover:border-destructive hover:text-destructive"
            disabled={remove.isPending}
            onClick={async () => {
              if (await confirm({ title: `Remove "${r.title}"?`, description: 'It stops coming back. Days already done stay in the history.', confirmLabel: 'Remove', destructive: true })) {
                remove.mutate(r.id)
              }
            }}
          >
            <Trash2 /> Remove
          </Button>
        </div>
      )}
    </li>
  )
}

// ── add / edit ─────────────────────────────────────────────────────
type DaysChoice = 'every' | 'monsat' | 'pick' | 'monthly'
const WEEK = [
  { n: 1, label: 'Mon' },
  { n: 2, label: 'Tue' },
  { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' },
  { n: 6, label: 'Sat' },
  { n: 7, label: 'Sun' },
] as const
const TIMES = ['10:00', '11:00', '13:00', '16:00', '18:00'] as const

function choiceOf(r: TaskRoutine | null): DaysChoice {
  if (!r) return 'every'
  if (r.repeat === 'monthly') return 'monthly'
  const d = [...r.weekdays].sort((a, b) => a - b).join()
  return d === '1,2,3,4,5,6,7' ? 'every' : d === '1,2,3,4,5,6' ? 'monsat' : 'pick'
}

const chip = (on: boolean) =>
  cn(
    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
    on ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90' : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5',
  )

function RoutineDialog({ routine, onClose }: { routine: TaskRoutine | null; onClose: () => void }) {
  const save = useSaveRoutine()
  const [title, setTitle] = useState(routine?.title ?? '')
  const [note, setNote] = useState(routine?.description ?? '')
  const [people, setPeople] = useState<string[]>(routine?.people.map((p) => p.user_id) ?? [])
  const [days, setDays] = useState<DaysChoice>(choiceOf(routine))
  const [weekdays, setWeekdays] = useState<number[]>(routine?.repeat === 'days' ? routine.weekdays : [1, 2, 3, 4, 5, 6])
  const [monthDay, setMonthDay] = useState<number>(routine?.month_day ?? 1)
  const [time, setTime] = useState<string>(routine?.due_time ?? '')
  const [otherTime, setOtherTime] = useState(!!routine?.due_time && !TIMES.includes(routine.due_time as (typeof TIMES)[number]))
  const [startsOn, setStartsOn] = useState(routine?.starts_on ?? todayInIndia())
  const [error, setError] = useState<string | null>(null)

  const body = (): SaveRoutineRequest | string => {
    if (!title.trim()) return 'Say what is to be done.'
    if (people.length === 0) return 'Pick who does it.'
    const wd = days === 'every' ? [1, 2, 3, 4, 5, 6, 7] : days === 'monsat' ? [1, 2, 3, 4, 5, 6] : weekdays
    if (days === 'pick' && wd.length === 0) return 'Pick at least one day.'
    return {
      title: title.trim(),
      description: note.trim() || null,
      priority: routine?.priority ?? 'medium',
      repeat: days === 'monthly' ? 'monthly' : 'days',
      weekdays: days === 'monthly' ? [1, 2, 3, 4, 5, 6, 7] : wd,
      month_day: days === 'monthly' ? monthDay : null,
      due_time: time || null,
      starts_on: startsOn,
      ends_on: routine?.ends_on ?? null,
      paused: routine?.paused ?? false,
      project_id: routine?.project_id ?? null,
      people,
    }
  }

  async function submit() {
    const b = body()
    if (typeof b === 'string') return setError(b)
    setError(null)
    await save.mutateAsync({ ...(routine ? { id: routine.id } : {}), body: b })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={routine ? 'Edit daily task' : 'Add a daily task'} className="max-w-xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routine-title">What is to be done</Label>
            <Input
              id="routine-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Back up yesterday's cards"
              className={cn(!title.trim() && 'border-dashed border-tone-amber bg-tone-amber-soft')}
              autoFocus
            />
          </div>

          <PeoplePicker selected={people} onChange={setPeople} />

          <div className="flex flex-col gap-1.5">
            <Label>Which days</Label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['every', 'Every day'],
                  ['monsat', 'Mon–Sat'],
                  ['pick', 'Pick days'],
                  ['monthly', 'Once a month'],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" className={chip(days === v)} onClick={() => setDays(v)} aria-pressed={days === v}>
                  {l}
                </button>
              ))}
            </div>
            {days === 'pick' && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {WEEK.map((d) => {
                  const on = weekdays.includes(d.n)
                  return (
                    <button
                      key={d.n}
                      type="button"
                      aria-pressed={on}
                      className={chip(on)}
                      onClick={() => setWeekdays(on ? weekdays.filter((x) => x !== d.n) : [...weekdays, d.n])}
                    >
                      {d.label}
                    </button>
                  )
                })}
              </div>
            )}
            {days === 'monthly' && (
              <label className="mt-1 flex items-center gap-2 text-sm">
                On the
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={monthDay}
                  onChange={(e) => setMonthDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
                  className="h-9 w-20"
                  aria-label="Date of the month"
                />
                of each month (the last day in a shorter month)
              </label>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Finish by</Label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={chip(!time && !otherTime)} onClick={() => { setTime(''); setOtherTime(false) }}>
                End of the day
              </button>
              {TIMES.map((t) => (
                <button key={t} type="button" className={chip(time === t && !otherTime)} onClick={() => { setTime(t); setOtherTime(false) }}>
                  {clockText(t)}
                </button>
              ))}
              <button type="button" className={chip(otherTime)} onClick={() => setOtherTime(true)}>
                Other time
              </button>
            </div>
            {otherTime && (
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 h-9 w-36" aria-label="Finish by" />
            )}
            <p className="text-xs text-muted-foreground">
              Not done by then: they get a reminder, and you are told.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="routine-start">Starts on</Label>
              <Input id="routine-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="h-9" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="routine-note">Note (optional)</Label>
            <Textarea id="routine-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How, or where, if it helps" />
          </div>

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {routine ? 'Save' : 'Add daily task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Who does it: always open, a search, the team as chips; amber until someone is picked. */
function PeoplePicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const { data } = useDirectory()
  const [q, setQ] = useState('')
  const active = useMemo(() => (data ?? []).filter((m: DirectoryMember) => m.status === 'active'), [data])
  const shown = active.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()))
  const names = active.filter((m) => selected.includes(m.user_id)).map((m) => m.name.split(' ')[0])
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5">
        <Users className="size-4" aria-hidden /> Who does it
      </Label>
      <div
        className={cn(
          'rounded-lg border p-2',
          selected.length ? 'border-success/40 bg-success/5' : 'border-dashed border-tone-amber bg-tone-amber-soft',
        )}
      >
        <p className={cn('mb-2 text-xs font-medium', selected.length ? 'text-success' : 'text-warning')}>
          {selected.length ? `${selected.length} chosen · ${names.join(', ')}` : 'Pick who does it'}
        </p>
        {active.length > 8 && (
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the team" className="h-9 pl-8" aria-label="Search the team" />
          </div>
        )}
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {shown.map((m) => {
            const on = selected.includes(m.user_id)
            return (
              <button key={m.user_id} type="button" aria-pressed={on} className={chip(on)} onClick={() => toggle(m.user_id)}>
                {on && <Check className="-ml-0.5 mr-1 inline size-3.5" aria-hidden />}
                {m.name}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
