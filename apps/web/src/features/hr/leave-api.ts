import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  attendanceCorrection,
  attendancePolicy,
  companyHoliday,
  leaveRequest,
  z,
  type CreateCorrectionRequest,
  type CreateLeaveRequest,
  type DecideRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const idOnly = z.object({ id: z.string() })
const none = z.unknown()

/** Owners, admins and managers decide leave and corrections (the database agrees). */
export function useCanDecide(): boolean {
  const { session } = useAuth()
  return !!session && (session.is_owner || ['super_admin', 'admin', 'manager'].includes(session.role ?? ''))
}

export function useLeave(scope: 'mine' | 'team', status?: string) {
  const { session } = useAuth()
  const qs = new URLSearchParams({ ...(scope === 'team' ? { scope } : {}), ...(status ? { status } : {}) }).toString()
  return useQuery({
    queryKey: ['hr', 'leave', scope, status ?? 'all'],
    queryFn: () => callApi(`/hr/leave${qs ? `?${qs}` : ''}`, { responseSchema: leaveRequest.array() }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

export function useCorrections(scope: 'mine' | 'team', status?: string) {
  const { session } = useAuth()
  const qs = new URLSearchParams({ ...(scope === 'team' ? { scope } : {}), ...(status ? { status } : {}) }).toString()
  return useQuery({
    queryKey: ['hr', 'corrections', scope, status ?? 'all'],
    queryFn: () => callApi(`/hr/corrections${qs ? `?${qs}` : ''}`, { responseSchema: attendanceCorrection.array() }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

export function useHolidays(year: number) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'holidays', year],
    queryFn: () => callApi(`/hr/holidays?year=${year}`, { responseSchema: companyHoliday.array() }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  })
}

export function usePolicy() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['hr', 'policy'],
    queryFn: () => callApi('/hr/policy', { responseSchema: attendancePolicy }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  })
}

function useHrMutation<T>(fn: (v: T) => Promise<unknown>, done: string, keys: string[][]) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(done)
      for (const k of keys) void qc.invalidateQueries({ queryKey: k })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export const useAskLeave = () =>
  useHrMutation(
    (body: CreateLeaveRequest) => callApi('/hr/leave', { method: 'POST', body, responseSchema: idOnly }),
    'Leave request sent',
    [['hr', 'leave']],
  )

export const useDecideLeave = () =>
  useHrMutation(
    ({ id, ...body }: DecideRequest & { id: string }) =>
      callApi(`/hr/leave/${id}/decide`, { method: 'POST', body, responseSchema: none }),
    'Saved. They have been told.',
    [['hr', 'leave'], ['hr', 'attendance']],
  )

export const useCancelLeave = () =>
  useHrMutation((id: string) => callApi(`/hr/leave/${id}/cancel`, { method: 'POST', responseSchema: none }), 'Leave cancelled', [
    ['hr', 'leave'],
  ])

export const useAskCorrection = () =>
  useHrMutation(
    (body: CreateCorrectionRequest) => callApi('/hr/corrections', { method: 'POST', body, responseSchema: idOnly }),
    'Sent for approval',
    [['hr', 'corrections']],
  )

export const useDecideCorrection = () =>
  useHrMutation(
    ({ id, ...body }: DecideRequest & { id: string }) =>
      callApi(`/hr/corrections/${id}/decide`, { method: 'POST', body, responseSchema: none }),
    'Saved. They have been told.',
    [['hr', 'corrections'], ['hr', 'attendance']],
  )

export const useAddHoliday = () =>
  useHrMutation(
    (body: { holiday_date: string; name: string }) => callApi('/hr/holidays', { method: 'POST', body, responseSchema: companyHoliday }),
    'Holiday added',
    [['hr', 'holidays']],
  )

export const useRemoveHoliday = () =>
  useHrMutation((id: string) => callApi(`/hr/holidays/${id}`, { method: 'DELETE', responseSchema: none }), 'Holiday removed', [
    ['hr', 'holidays'],
  ])

export const useSetWeeklyOff = () =>
  useHrMutation(
    (weekly_off: number[]) => callApi('/hr/policy', { method: 'PATCH', body: { weekly_off }, responseSchema: attendancePolicy }),
    'Weekly off-days saved',
    [['hr', 'policy']],
  )
