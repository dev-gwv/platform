import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dashboardSummary, myFollowUp, z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/** CRM follow-ups given to me -- calls to make, for staff without the CRM too. */
export function useMyFollowUps() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['me', 'follow-ups'],
    queryFn: () => callApi('/me/follow-ups', { responseSchema: myFollowUp.array() }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

/**
 * The numbers behind Home's leads and shoots tiles, in one light answer
 * (`GET /dashboard/summary`) instead of the whole call queue, the week's
 * shoots and every booking. Asked again each time Home opens; the last answer
 * shows meanwhile.
 */
export function useDashboardSummary(enabled = true) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => callApi('/dashboard/summary', { responseSchema: dashboardSummary }),
    enabled: enabled && !!session,
    staleTime: 30_000,
    refetchOnMount: 'always',
  })
}

export function useFollowUpDone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/me/follow-ups/${id}/done`, { method: 'POST', responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Done')
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
