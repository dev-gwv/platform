import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  attendancePlace,
  attendanceRule,
  attendanceSettings,
  checkInResponse,
  monthRegister,
  myAttendanceToday,
  resolvedPin,
  todayBoard,
  z,
  type UpdateAttendanceSettings,
  type AttendancePlaceInput,
  type AttendanceRuleInput,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const idOnly = z.object({ id: z.string() })

/** Today, and the rule that decides it (0206). Under ['hr'] with the rest of attendance. */
export function useAttendanceMe() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'attendance', 'me'],
    queryFn: () => callApi('/hr/attendance/me', { responseSchema: myAttendanceToday }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

function useInvalidateAttendance() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['hr'] })
    void qc.invalidateQueries({ queryKey: ['attendance'] })
  }
}

/** Check in with a location; `auto` when the app did it on open. The error carries the distance. */
export function useCheckIn() {
  const invalidate = useInvalidateAttendance()
  return useMutation({
    mutationFn: (v: { lat: number; lng: number; auto?: boolean; accuracy_m?: number; selfie_file_id?: string }) =>
      callApi('/hr/check-in', { method: 'POST', body: v, responseSchema: checkInResponse }),
    onSuccess: invalidate,
  })
}

// ── attendance v2 (0224) ────────────────────────────────────────
/** The owner's attendance settings: the switch, the hours, the selfie. */
export function useAttendanceSettings() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'settings'],
    queryFn: () => callApi('/hr/policy', { responseSchema: attendanceSettings }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useSaveAttendanceSettings() {
  const invalidate = useInvalidateAttendance()
  return useMutation({
    mutationFn: (v: UpdateAttendanceSettings) =>
      callApi('/hr/policy', { method: 'PATCH', body: v, responseSchema: attendanceSettings }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Everyone the studio tracks, today (or on `date`). */
export function useTodayBoard(date?: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'today', date ?? 'today'],
    queryFn: () => callApi(`/hr/today${date ? `?date=${date}` : ''}`, { responseSchema: todayBoard }),
    enabled: !!session,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/** One code per person per day for a month ("2026-10"); `mine` for one's own. */
export function useMonthRegister(month: string, mine = false) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'register', month, mine],
    queryFn: () => callApi(`/hr/register?month=${month}${mine ? '&user=me' : ''}`, { responseSchema: monthRegister }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

/** A Google Maps link (or "lat, lng") into a pin. */
export function useResolveLink() {
  return useMutation({
    mutationFn: (url: string) => callApi('/hr/places/resolve-link', { method: 'POST', body: { url }, responseSchema: resolvedPin }),
  })
}

export function useCheckOut() {
  const invalidate = useInvalidateAttendance()
  return useMutation({
    mutationFn: (v: { lat?: number; lng?: number }) =>
      callApi('/hr/check-out', { method: 'POST', body: v, responseSchema: idOnly }),
    onSuccess: () => {
      toast.success('Checked out')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

// ── places and rules (owner) ────────────────────────────────────
export function usePlaces() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'places'],
    queryFn: () => callApi('/hr/places', { responseSchema: attendancePlace.array() }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useRules() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'rules'],
    queryFn: () => callApi('/hr/rules', { responseSchema: attendanceRule.array() }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

function useHrMutation<T>(fn: (v: T) => Promise<unknown>, done: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(done)
      void qc.invalidateQueries({ queryKey: ['hr'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export const useSavePlace = () =>
  useHrMutation(
    (v: AttendancePlaceInput & { id?: string }) =>
      v.id
        ? callApi(`/hr/places/${v.id}`, { method: 'PATCH', body: v, responseSchema: attendancePlace })
        : callApi('/hr/places', { method: 'POST', body: v, responseSchema: attendancePlace }),
    'Place saved',
  )

export const useDeletePlace = () =>
  useHrMutation((id: string) => callApi(`/hr/places/${id}`, { method: 'DELETE', responseSchema: z.any() }), 'Place removed')

export const useSaveRule = () =>
  useHrMutation((v: AttendanceRuleInput) => callApi('/hr/rules', { method: 'PUT', body: v, responseSchema: idOnly }), 'Rule saved')

export const useDeleteRule = () =>
  useHrMutation((id: string) => callApi(`/hr/rules/${id}`, { method: 'DELETE', responseSchema: z.any() }), 'Rule removed')
