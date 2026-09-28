import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { callQueueItem, callQueueScope, crmActivity, z, type CallQueueScope } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const queueResponse = z.object({ scope: callQueueScope, items: callQueueItem.array() })

/** Today's calls. Keyed under ['crm'] so every lead change refreshes it. */
export function useCallQueue(scope: CallQueueScope) {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['crm', 'call-queue', scope],
    queryFn: () => callApi(`/crm/queue?scope=${scope}`, { responseSchema: queueResponse }),
    enabled: !!session && access.hasModule('crm'),
    staleTime: 20_000,
  })
}

export interface CallLog {
  leadId: string
  outcome: string
  note?: string | undefined
  /** When to call next; null clears it, undefined leaves it alone. */
  nextAt?: string | null | undefined
}

/**
 * How a call went: one activity row (0201 turns the outcome into attempts and
 * "unreachable"), and the next call when one was picked.
 */
export function useLogCall() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: CallLog) => {
      await callApi('/crm/activities', {
        method: 'POST',
        body: {
          lead_id: v.leadId,
          type: 'call',
          direction: 'out',
          outcome: v.outcome,
          started_at: new Date().toISOString(),
          ...(v.note?.trim() ? { body: v.note.trim() } : {}),
        },
        responseSchema: crmActivity,
      })
      if (v.nextAt !== undefined) {
        await callApi(`/crm/leads/${v.leadId}`, {
          method: 'PATCH',
          body: { follow_up_at: v.nextAt },
          responseSchema: z.unknown(),
        })
      }
    },
    onSuccess: () => {
      toast.success('Call logged')
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message || 'We could not log the call.'),
  })
}
