import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { taskRoutine, z, type SaveRoutineRequest, type TaskRoutine } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/**
 * Daily tasks (0305): a task that comes back by itself for the people it is
 * set for. The server makes each day's copy and rings when one is not done;
 * this is the Tasks page's Daily tasks view and the one-tap Done.
 */
const KEY = ['tasks', 'routines'] as const

export function useRoutines(mine = false) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...KEY, mine ? 'mine' : 'all'],
    queryFn: () => callApi(`/tasks/routines${mine ? '?mine=1' : ''}`, { responseSchema: taskRoutine.array() }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

export function useSaveRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: SaveRoutineRequest }) =>
      callApi(id ? `/tasks/routines/${id}` : '/tasks/routines', { method: id ? 'PATCH' : 'POST', body, responseSchema: taskRoutine }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function usePauseRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
      callApi(`/tasks/routines/${id}/pause`, { method: 'POST', body: { paused }, responseSchema: taskRoutine }),
    onSuccess: (r) => {
      toast.success(r.paused ? `Paused. "${r.title}" will not come back until you resume it.` : `"${r.title}" is back on.`)
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/tasks/routines/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Daily task removed. Days already done stay in the history.')
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Today's copy, done in one tap (or taken back). */
export function useDailyDone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      callApi(`/tasks/daily/${id}/done`, { method: 'POST', body: { done }, responseSchema: z.object({ status: z.string() }) }),
    onSuccess: (_r, v) => {
      toast.success(v.done ? 'Done for today. Well done!' : 'Marked not done.')
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ── words ──────────────────────────────────────────────────────────
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** "4:30 pm" from "16:30". */
export function clockText(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  const am = h < 12
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${am ? 'am' : 'pm'}`
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${n % 10 > 3 ? 'th' : s}`
}

/** Which days, in words: "Every day", "Mon–Sat", "Mon, Wed, Fri", "On the 1st of each month". */
export function daysText(r: Pick<TaskRoutine, 'repeat' | 'weekdays' | 'month_day'>): string {
  if (r.repeat === 'monthly') return `On the ${ordinal(r.month_day ?? 1)} of each month`
  const days = [...new Set(r.weekdays)].sort((a, b) => a - b)
  if (days.length === 7) return 'Every day'
  if (days.join() === '1,2,3,4,5,6') return 'Mon–Sat'
  if (days.join() === '1,2,3,4,5') return 'Mon–Fri'
  return days.map((d) => DAY[d - 1]).join(', ')
}

/** "Every day · by 11 am", "Mon–Sat · by the end of the day". */
export function repeatLine(r: Pick<TaskRoutine, 'repeat' | 'weekdays' | 'month_day' | 'due_time'>): string {
  return `${daysText(r)} · ${r.due_time ? `by ${clockText(r.due_time)}` : 'by the end of the day'}`
}

/** "3 of 4 done today" over the people who have a copy today. */
export function todayLine(r: Pick<TaskRoutine, 'people' | 'paused'>): string {
  if (r.paused) return 'Paused'
  const today = r.people.filter((p) => p.today !== 'none')
  if (today.length === 0) return 'Not due today'
  const done = today.filter((p) => p.today === 'done').length
  const late = today.filter((p) => p.today === 'late').length
  return `${done} of ${today.length} done today${late ? ` · ${late} late` : ''}`
}
