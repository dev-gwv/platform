import { projectDetail } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'

/** One project's page data; the same key and fetch for the page and its preload. */
export const projectQuery = (id: string) => ({
  queryKey: ['projects', id] as const,
  queryFn: () => callApi(`/projects/${id}`, { responseSchema: projectDetail }),
})
