import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  clientOccasion,
  detailsLinkIssued,
  projectDetailsStatus,
  projectWishes,
  z,
  type SaveOccasionRequest,
  type UpdateOccasionRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'

/** The client's dates and what the project's Wishes tab needs (0243). */
export function useProjectWishes(projectId: string) {
  return useQuery({
    queryKey: ['wishes', 'project', projectId],
    queryFn: () => callApi(`/wishes/project/${projectId}`, { responseSchema: projectWishes }),
  })
}

/** One client's dates, for Edit client. */
export function useClientOccasions(clientId: string | undefined) {
  return useQuery({
    queryKey: ['wishes', 'client', clientId],
    queryFn: () => callApi(`/wishes/client/${clientId}`, { responseSchema: clientOccasion.array() }),
    enabled: !!clientId,
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['wishes'] })
}

export function useAddOccasion() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (body: SaveOccasionRequest) => callApi('/wishes/occasions', { method: 'POST', body, responseSchema: clientOccasion }),
    onSuccess: () => void done(),
  })
}

export function useUpdateOccasion() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateOccasionRequest & { id: string }) =>
      callApi(`/wishes/occasions/${id}`, { method: 'PATCH', body, responseSchema: clientOccasion }),
    onSuccess: () => void done(),
  })
}

export function useDeleteOccasion() {
  const done = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => callApi(`/wishes/occasions/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    onSuccess: () => void done(),
  })
}

// ── the details form a client fills (0244) ─────────────────────────

/** The project's details link and the client's events still to add. */
export function useDetailsStatus(projectId: string, enabled = true) {
  return useQuery({
    queryKey: ['client-details', 'project', projectId],
    queryFn: () => callApi(`/client-details/projects/${projectId}`, { responseSchema: projectDetailsStatus }),
    enabled,
  })
}

/** A fresh link for the project (the old one stops working). */
export function useIssueDetailsLink(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => callApi(`/client-details/projects/${projectId}`, { method: 'POST', responseSchema: detailsLinkIssued }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-details', 'project', projectId] }),
  })
}

/** The studio's own form: one link and QR for anyone who has booked. */
export function useStudioDetailsForm() {
  return useQuery({
    queryKey: ['client-details', 'studio'],
    queryFn: () => callApi('/client-details/studio', { responseSchema: detailsLinkIssued }),
  })
}

export function useNewStudioDetailsForm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => callApi('/client-details/studio/new', { method: 'POST', responseSchema: detailsLinkIssued }),
    onSuccess: (d) => qc.setQueryData(['client-details', 'studio'], d),
  })
}
