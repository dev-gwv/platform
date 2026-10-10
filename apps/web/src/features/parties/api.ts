import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { party, type CreatePartyRequest, type UpdatePartyRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/** Vendors, freelancers, and other parties an expense is paid to or received from. */
export function useParties(filters?: { search?: string | undefined; kind?: string | undefined; active?: string | undefined }) {
  const { session } = useAuth()
  const params = new URLSearchParams()
  if (filters?.search?.trim()) params.set('search', filters.search.trim())
  if (filters?.kind) params.set('kind', filters.kind)
  if (filters?.active) params.set('active', filters.active)
  const qs = params.toString()
  return useQuery({
    queryKey: ['parties', qs],
    queryFn: () => callApi(`/parties${qs ? `?${qs}` : ''}`, { responseSchema: party.array() }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useCreateParty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePartyRequest) => callApi('/parties', { method: 'POST', body: input, responseSchema: party }),
    onSuccess: () => {
      toast.success('Party added')
      void qc.invalidateQueries({ queryKey: ['parties'] })
    },
  })
}

export function useUpdateParty() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePartyRequest }) =>
      callApi(`/parties/${id}`, { method: 'PATCH', body: patch, responseSchema: party }),
    onSuccess: () => {
      toast.success('Party updated')
      void qc.invalidateQueries({ queryKey: ['parties'] })
    },
  })
}
