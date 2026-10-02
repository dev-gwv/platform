import { useQuery } from '@tanstack/react-query'
import { myDueItem, myProject } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/** What is coming due, for the chip in the top bar. */
export function useMyDue() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['me', 'due'],
    queryFn: () => callApi('/me/due', { responseSchema: myDueItem.array() }),
    enabled: !!session,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
}

/** One project as someone who works on it sees it. */
export function useMyProject(projectId: string) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['me', 'project', projectId],
    queryFn: () => callApi(`/me/projects/${projectId}`, { responseSchema: myProject }),
    enabled: !!session && !!projectId,
    staleTime: 30_000,
  })
}
