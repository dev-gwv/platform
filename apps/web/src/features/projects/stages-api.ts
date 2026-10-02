import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  companyProfile,
  deliverableStage,
  z,
  type CreateDeliverableStageRequest,
  type DeliverableStage,
  type UpdateDeliverableStageRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useCompanyProfile } from '@/features/settings/api'
import type { DeliveryFlow } from './stages'

const KEY = ['deliverable-stages'] as const
const EMPTY: DeliverableStage[] = []

/** Full (hand-ins go to review) or Simple (Delivered as they land), 0234. */
export function useDeliveryFlow(): DeliveryFlow {
  return useCompanyProfile().data?.delivery_flow ?? 'full'
}

/** Switch the studio between Full and Simple delivery. Owner only. */
export function useSetDeliveryFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (delivery_flow: DeliveryFlow) =>
      callApi('/settings/company', { method: 'PATCH', body: { delivery_flow }, responseSchema: companyProfile }),
    onSuccess: (row) => {
      qc.setQueryData(['settings', 'company'], row)
      toast.success(row.delivery_flow === 'simple' ? 'Hand-ins are now delivered as they land.' : 'Hand-ins now go to review first.')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** The studio's named stages. They change rarely, so they are kept a while. */
export function useDeliverableStages() {
  return useDeliverableStagesQuery().data ?? EMPTY
}

export function useDeliverableStagesQuery() {
  const { session } = useAuth()
  return useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/projects/stages', { responseSchema: deliverableStage.array() }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  })
}

function useAfter(message?: string) {
  const qc = useQueryClient()
  return () => {
    if (message) toast.success(message)
    void qc.invalidateQueries({ queryKey: KEY })
    void qc.invalidateQueries({ queryKey: ['projects'] })
  }
}

export function useAddStage() {
  const after = useAfter('Stage added')
  return useMutation({
    mutationFn: (body: CreateDeliverableStageRequest) =>
      callApi('/projects/stages', { method: 'POST', body, responseSchema: deliverableStage }),
    onSuccess: after,
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateStage() {
  const after = useAfter()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateDeliverableStageRequest) =>
      callApi(`/projects/stages/${id}`, { method: 'PATCH', body, responseSchema: deliverableStage }),
    onSuccess: after,
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteStage() {
  const after = useAfter('Stage removed')
  return useMutation({
    mutationFn: (id: string) => callApi(`/projects/stages/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: after,
    onError: (e: Error) => toast.error(e.message),
  })
}
