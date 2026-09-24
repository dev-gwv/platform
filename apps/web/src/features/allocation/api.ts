import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from '@ipc/contracts'
import { bookSlotsBatchResult, teamSlot, teamMember, type BookSlotRequest, type SetSlotDataRequest, type SlotStatus, type SetSlotCostRequest, type UpdateSlotRequest } from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi, ApiError } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const slots = teamSlot.array()
const members = teamMember.array()

export function useSlots() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['allocation'],
    queryFn: () => callApi('/allocation', { responseSchema: slots }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

export function useMembers() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['team', 'members'],
    queryFn: () => callApi('/team/members', { responseSchema: members }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useBookSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BookSlotRequest) =>
      callApi('/allocation', {
        method: 'POST',
        body: input,
        responseSchema: z.object({ id: z.string() }),
      }),
    onSuccess: () => {
      toast.success('Crew booked')
      void qc.invalidateQueries({ queryKey: ['allocation'] })
    },
  })
}

/**
 * Book several at once (bulk assign). Resolves with a result per item rather
 * than throwing on the first clash; the caller reports what went in.
 */
export function useBookSlots() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: BookSlotRequest[]) =>
      callApi('/allocation/batch', {
        method: 'POST',
        body: { items },
        responseSchema: bookSlotsBatchResult,
      }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['allocation'] }),
  })
}

/** Say a booking owes no data (with why), or that it does again. */
export function useSetSlotData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: SetSlotDataRequest & { id: string }) =>
      callApi(`/allocation/${id}/data`, { method: 'POST', body, responseSchema: z.unknown() }),
    onSuccess: (_d, v) => {
      toast.success(v.data_required ? 'Data expected from this booking again' : 'Marked: no data needed')
      void qc.invalidateQueries({ queryKey: ['allocation'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Take someone off a shoot: the seat opens again, the history stays. */
export function useReleaseSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callApi(`/allocation/${id}/status`, { method: 'POST', body: { status: 'released' }, responseSchema: z.unknown() }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['allocation'] }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSetSlotStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: SlotStatus }) =>
      callApi(`/allocation/${id}/status`, { method: 'POST', body: { status }, responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Booking updated')
      void qc.invalidateQueries({ queryKey: ['allocation'] })
    },
  })
}

/** Edit a booking's who/when/what — distinct from cost and status. */
export function useUpdateSlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSlotRequest }) =>
      callApi(`/allocation/${id}`, { method: 'PATCH', body: patch, responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Booking updated')
      void qc.invalidateQueries({ queryKey: ['allocation'] })
    },
  })
}

export function useSetSlotCost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SetSlotCostRequest }) =>
      callApi(`/allocation/${id}/cost`, { method: 'POST', body: patch, responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Cost updated')
      void qc.invalidateQueries({ queryKey: ['allocation'] })
    },
  })
}

export { ApiError }
