import { useQuery } from '@tanstack/react-query'
import { memberScorecard, memberScorecardHistory, scorecardTeamRow, z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const teamResponse = z.object({ from: z.string(), to: z.string(), items: scorecardTeamRow.array() })

/** Everyone's month, best first (owners and managers). */
export function useTeamPerformance(month: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['performance', 'team', month ?? 'now'],
    queryFn: () => callApi(`/performance${month ? `?month=${month}` : ''}`, { responseSchema: teamResponse }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

/** One person's last six months: yourself (no id) or a member. */
export function usePerformanceHistory(userId: string | null) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['performance', 'history', userId ?? 'me'],
    queryFn: () => callApi(userId ? `/performance/members/${userId}` : '/performance/me', { responseSchema: memberScorecardHistory }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

/** This month, for the dashboard. */
export function useMyMonth() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['performance', 'me', 'month'],
    queryFn: () => callApi('/performance/me/month', { responseSchema: memberScorecard }),
    enabled: !!session,
    staleTime: 60_000,
  })
}
