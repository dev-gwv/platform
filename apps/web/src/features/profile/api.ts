import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { myProfile, teamProfileGap, type UpdateMyProfileRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

export const PROFILE_KEY = ['settings', 'profile'] as const

export function useMyProfile() {
  const { session } = useAuth()
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => callApi('/settings/profile', { responseSchema: myProfile }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

export function useSaveMyProfile() {
  const qc = useQueryClient()
  const { refresh } = useAuth()
  return useMutation({
    mutationFn: (body: UpdateMyProfileRequest) =>
      callApi('/settings/profile', { method: 'PATCH', body, responseSchema: myProfile }),
    onSuccess: (p) => {
      qc.setQueryData(PROFILE_KEY, p)
      void qc.invalidateQueries({ queryKey: ['team', 'profile-gaps'] })
      void refresh()
      toast.success(p.completeness.percent === 100 ? 'Profile complete. Thank you!' : 'Saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Owner: everyone's profile gaps (field names only). */
export function useTeamProfileGaps() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['team', 'profile-gaps'],
    queryFn: () => callApi('/team/profile-gaps', { responseSchema: teamProfileGap.array() }),
    enabled: !!session?.is_owner,
    staleTime: 60_000,
  })
}
