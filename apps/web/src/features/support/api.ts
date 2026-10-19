import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supportRequestList, type SupportKind } from '@ipc/contracts'
import { callApi, uploadFile } from '@/shared/api/client'

/** Support requests (0271): the person's own, and the studio's for owners and admins. */
const KEY = ['support', 'requests'] as const

export function useSupportRequests(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/support/requests', { responseSchema: supportRequestList }),
    enabled,
    staleTime: 30_000,
    // A team reply comes from the Sheet within minutes; look again now and then while the page is open.
    refetchInterval: 120_000,
  })
}

export interface NewSupportRequest {
  kind: SupportKind
  body: string
  urgent: boolean
  screenshots: Blob[]
  context?: string
}

/** Screenshots go up first as the person's own private files, then the request pointing at them. */
export function useCreateSupportRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewSupportRequest) => {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      const file_ids: string[] = []
      for (const [i, blob] of input.screenshots.entries()) {
        const type = blob.type || 'image/png'
        const ext = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png'
        file_ids.push((await uploadFile(new File([blob], `problem-${stamp}-${i + 1}.${ext}`, { type }))).id)
      }
      return callApi('/support/requests', {
        method: 'POST',
        body: {
          kind: input.kind,
          body: input.body.trim(),
          urgent: input.urgent,
          file_ids,
          page_url: window.location.pathname + window.location.search,
          ...(input.context ? { context: input.context.slice(0, 8000) } : {}),
        },
        responseSchema: supportRequestList,
      })
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useReplySupportRequest(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => callApi(`/support/requests/${id}/messages`, { method: 'POST', body: { body }, responseSchema: supportRequestList }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
      toast.success('Sent. The team will see it.')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useResolveSupportRequest(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => callApi(`/support/requests/${id}/resolve`, { method: 'POST', body: {}, responseSchema: supportRequestList }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
      toast.success('Glad that is sorted. The request is closed.')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
