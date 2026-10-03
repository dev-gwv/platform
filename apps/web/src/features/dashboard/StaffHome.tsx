import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRight, Check, ClipboardList, HardDrive, MapPin, Phone, Play, UserRoundCheck } from 'lucide-react'
import { PROFILE_FIELD_LABEL, z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { DeliverableTile, EventTile, IconTile } from '@/shared/ui/icon-tile'
import { useSlots } from '@/features/allocation/api'
import { SlotAnswer } from '@/features/allocation/SlotAnswer'
import { TodayAttendanceCard } from '@/features/attendance/TodayAttendanceCard'
import { useMyData } from '@/features/data/api'
import { optedOut } from '@/features/data/stage'
import { useMyProfile } from '@/features/profile/api'
import { profileLine } from './profile-line'
import { useMyDeliverables } from '@/features/projects/api'
import { useMyTasks, useUpdateMyTaskStatus } from '@/features/tasks/api'
import { SubmitWorkDialog } from '@/features/work/SubmitWorkDialog'
import { localDate } from '@/features/shoots/assign'
import { useFollowUpDone, useMyFollowUps } from './api'
import { myDay, openWorkLine, type TodayItem } from './today'

/**
 * Everything given to the signed-in person, worked out once: their day in
 * time order, the week after it, and how much else is open.
 */
export function useMyDay() {
  const { session } = useAuth()
  const me = session?.user_id ?? null
  // Only their own bookings, from two months back (cards still owed) on --
  // a manager's call would otherwise fetch the whole studio's calendar.
  const [from] = useState(() => localDate(new Date(Date.now() - 60 * 86_400_000)))
  const slots = useSlots(me ? { user_id: me, from } : undefined)
  const tasks = useMyTasks()
  const edits = useMyDeliverables()
  const calls = useMyFollowUps()
  const data = useMyData()

  return useMemo(() => {
    const now = new Date()
    const nowIso = now.toISOString()
    const handedIn = new Map((data.data ?? []).filter((r) => r.slot_id).map((r) => [r.slot_id!, r.data_status]))
    const mine = (slots.data ?? []).filter((s) => s.user_id === me)
    const owedCards = new Set(
      mine
        .filter((s) => s.status === 'booked' && !!s.shoot_id && s.end_at < nowIso && !optedOut(s) && (handedIn.get(s.id) ?? 'with_shooter') === 'with_shooter')
        .map((s) => s.id),
    )
    const day = myDay({
      me,
      slots: mine,
      tasks: tasks.data ?? [],
      edits: edits.data ?? [],
      calls: calls.data ?? [],
      owedCards,
      now,
    })
    const openTasks = (tasks.data ?? []).filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length
    return {
      ...day,
      open: { tasks: openTasks, edits: (edits.data ?? []).length, handovers: owedCards.size },
      loading: slots.isLoading || tasks.isLoading,
    }
  }, [me, slots.data, slots.isLoading, tasks.data, tasks.isLoading, edits.data, calls.data, data.data])
}

/**
 * A team member's Home: today's attendance, then one list of what to do
 * today -- each line with its one action -- then the week ahead, one line on
 * everything else, and a quiet nudge if their profile is unfinished.
 * (It replaced fourteen cards: tiles, score, reminders and quick links.)
 */
export function StaffHome() {
  const day = useMyDay()
  const line = openWorkLine(day.open)
  return (
    <div className="flex flex-col gap-4">
      <TodayAttendanceCard />

      <Card>
        <CardContent className="p-4">
          <p className="mb-2 text-sm font-semibold">
            Today <span className="font-normal text-muted-foreground">· {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
          </p>
          {day.loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : day.today.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due today.</p>
          ) : (
            <ul className="divide-y divide-border">
              {day.today.map((i) => (
                <TodayRow key={`${i.kind}:${i.id}`} item={i} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {day.next.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-semibold">Coming up</p>
            <ul className="flex flex-col gap-2">
              {day.next.slice(0, 8).map((i) => (
                <li key={`${i.kind}:${i.id}`} className="flex items-center gap-2 text-sm">
                  <KindIcon item={i} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{i.note}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {line && (
        <Link
          to="/my-work"
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm hover:bg-accent"
        >
          <ClipboardList className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1">{line}</span>
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            My work <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>
      )}

      <ProfileNudge />
    </div>
  )
}

function KindIcon({ item, size = 'md' }: { item: TodayItem; size?: 'sm' | 'md' }) {
  if (item.kind === 'shoot') return <EventTile name={item.slot?.shoot_name ?? item.slot?.service_name} size={size} />
  if (item.kind === 'edit') return <DeliverableTile title={item.edit?.title} size={size} />
  if (item.kind === 'handover') return <IconTile icon={HardDrive} tone="amber" size={size} />
  if (item.kind === 'call') return <IconTile icon={Phone} tone="blue" size={size} />
  return <IconTile icon={ClipboardList} tone="violet" size={size} />
}

function TodayRow({ item }: { item: TodayItem }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <KindIcon item={item} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className={cn('text-xs', item.late ? 'font-medium text-warning' : 'text-muted-foreground')}>
          {item.note}
          {item.kind === 'shoot' && item.slot?.location ? ` · ${item.slot.location}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <RowAction item={item} />
      </div>
    </li>
  )
}

function RowAction({ item }: { item: TodayItem }) {
  if (item.kind === 'shoot' && item.slot) {
    return (
      <>
        {item.slot.map_link && (
          <Button asChild size="sm" variant="outline">
            <a href={item.slot.map_link} target="_blank" rel="noreferrer">
              <MapPin /> Venue
            </a>
          </Button>
        )}
        <SlotAnswer slot={item.slot} />
      </>
    )
  }
  if (item.kind === 'task' && item.task) return <TaskAction task={item.task} />
  if (item.kind === 'edit' && item.edit) return <EditAction item={item} />
  if (item.kind === 'handover') {
    return (
      <Button asChild size="sm" variant="outline">
        <Link to="/shoots/my">Hand over</Link>
      </Button>
    )
  }
  if (item.kind === 'call' && item.call) return <CallAction call={item.call} />
  return null
}

function TaskAction({ task }: { task: NonNullable<TodayItem['task']> }) {
  const move = useUpdateMyTaskStatus()
  if (task.status === 'to_do') {
    return (
      <Button size="sm" disabled={move.isPending} onClick={() => move.mutate({ id: task.id, status: 'in_progress' })}>
        <Play /> Start
      </Button>
    )
  }
  return (
    <SubmitWorkDialog
      taskId={task.id}
      projectId={task.project_id}
      trigger={
        <Button size="sm" variant="outline">
          Submit
        </Button>
      }
    />
  )
}

function EditAction({ item }: { item: TodayItem }) {
  const qc = useQueryClient()
  const start = useMutation({
    mutationFn: (id: string) => callApi(`/projects/deliverables/${id}/start`, { method: 'POST', responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Started. Good luck!')
      void qc.invalidateQueries({ queryKey: ['projects', 'my-deliverables'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const d = item.edit!
  if (!d.started_at && !d.changes_requested) {
    return (
      <Button size="sm" disabled={start.isPending} onClick={() => start.mutate(d.id)}>
        <Play /> I&apos;ve started
      </Button>
    )
  }
  return (
    <Button asChild size="sm" variant="outline">
      <Link to="/my-work" search={{ d: d.id } as never}>
        Open
      </Link>
    </Button>
  )
}

function CallAction({ call }: { call: NonNullable<TodayItem['call']> }) {
  const done = useFollowUpDone()
  return (
    <>
      {call.lead_phone && (
        <Button asChild size="sm" variant="outline">
          <a href={`tel:${call.lead_phone}`}>
            <Phone /> Call
          </a>
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={done.isPending} onClick={() => done.mutate(call.id)}>
        <Check /> Done
      </Button>
    </>
  )
}

const laterKey = (me: string | undefined) => `profile-nudge-later:${me ?? ''}`
const todayKey = () => new Date().toDateString()

/**
 * One line while the profile is unfinished. "Later" hides it until tomorrow;
 * it comes back each day until the profile is done, by design.
 */
function ProfileNudge() {
  const { session } = useAuth()
  const { data } = useMyProfile()
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(laterKey(session?.user_id)) === todayKey()
    } catch {
      return false
    }
  })
  if (!data || session?.is_owner || hidden || data.completeness.missing.length === 0) return null
  const line = profileLine(data.completeness.percent, data.completeness.missing.map((m) => PROFILE_FIELD_LABEL[m]))
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
      <UserRoundCheck className="size-4 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        {line}
      </span>
      <Button asChild size="sm">
        <Link to="/profile">Finish it</Link>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          try {
            localStorage.setItem(laterKey(session?.user_id), todayKey())
          } catch {
            /* private window: it simply shows again */
          }
          setHidden(true)
        }}
      >
        Later
      </Button>
    </div>
  )
}

/**
 * For an owner, admin or manager who also shoots and edits: their own day in
 * one line above the studio's command centre. Nothing when there is nothing.
 */
export function YourDayStrip() {
  const day = useMyDay()
  if (day.loading || day.today.length === 0) return null
  const shoots = day.today.filter((i) => i.kind === 'shoot')
  const rest = day.today.length - shoots.length
  const bits = [
    ...shoots.slice(0, 2).map((i) => i.title),
    rest > 0 ? `${rest} more thing${rest === 1 ? '' : 's'} to do` : null,
  ].filter(Boolean)
  return (
    <Link
      to={shoots.length ? '/shoots/my' : '/my-work'}
      className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm hover:bg-accent"
    >
      <span className="font-semibold">Your day</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">· {bits.join(' · ')}</span>
      <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden />
    </Link>
  )
}
