import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  myStudioReferrals,
  platformStudioReferrals,
  z,
  type SaveStudioRefTermsRequest,
  type SettleStudioReferralRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'

export function useMyStudioReferrals() {
  return useQuery({
    queryKey: ['studio-referrals', 'mine'],
    queryFn: () => callApi('/studio-referrals', { responseSchema: myStudioReferrals }),
  })
}

export function usePlatformStudioReferrals() {
  return useQuery({
    queryKey: ['studio-referrals', 'platform'],
    queryFn: () => callApi('/platform/studio-referrals', { responseSchema: platformStudioReferrals }),
  })
}

export function useSaveStudioRefTerms() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveStudioRefTermsRequest) =>
      callApi('/platform/studio-referrals/terms', { method: 'PUT', body, responseSchema: z.unknown() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['studio-referrals'] })
      toast.success('Saved. Studios see these terms now.')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useSettleStudioReferral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: SettleStudioReferralRequest & { id: string }) =>
      callApi(`/platform/studio-referrals/${id}`, { method: 'POST', body, responseSchema: z.unknown() }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['studio-referrals'] }),
    onError: (e: Error) => toast.error(e.message),
  })
}
