import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { designCreated, designDeleted, designDetail, designSaved, designSummary, type CreateDesignRequest, type UpdateDesignRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'

/** Quotation Designer (0295): the studio's designs. */
const KEY = ['designs'] as const

export function useDesigns() {
  return useQuery({ queryKey: KEY, queryFn: () => callApi('/designs', { responseSchema: designSummary.array() }) })
}

export function useDesign(id: string) {
  return useQuery({
    queryKey: [...KEY, id],
    queryFn: () => callApi(`/designs/${id}`, { responseSchema: designDetail }),
    // The editor owns the document once open; a refetch would overwrite typing.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useCreateDesign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateDesignRequest) => callApi('/designs', { method: 'POST', body, responseSchema: designCreated }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY, exact: true }),
  })
}

export function useSaveDesign(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateDesignRequest) =>
      callApi(`/designs/${id}`, { method: 'PATCH', body, responseSchema: designSaved }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY, exact: true }),
  })
}

export function useDuplicateDesign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/designs/${id}/duplicate`, { method: 'POST', responseSchema: designCreated }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY, exact: true }),
  })
}

export function useDeleteDesign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => callApi(`/designs/${id}`, { method: 'DELETE', responseSchema: designDeleted }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY, exact: true }),
  })
}
