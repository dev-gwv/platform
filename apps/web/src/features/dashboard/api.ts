import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { myFollowUp, z } from '@ipc/contracts'
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

export function useFollowUpDone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/me/follow-ups/${id}/done`, { method: 'POST', responseSchema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => {
      toast.success('Done')
      void qc.invalidateQueries({ queryKey: ['me', 'follow-ups'] })
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
