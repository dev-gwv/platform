import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  deliverableStage,
  z,
  type CreateDeliverableStageRequest,
  type DeliverableStage,
  type UpdateDeliverableStageRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const KEY = ['deliverable-stages'] as const
const EMPTY: DeliverableStage[] = []

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
