import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  clientOccasion,
  projectWishes,
  upcomingWish,
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

/** The studio's dates coming round in the next `days`. */
export function useUpcomingWishes(days = 30, enabled = true) {
  return useQuery({
    queryKey: ['wishes', 'upcoming', days],
    queryFn: () => callApi(`/wishes/upcoming?days=${days}`, { responseSchema: upcomingWish.array() }),
    enabled,
    staleTime: 5 * 60_000,
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
