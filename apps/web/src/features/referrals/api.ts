import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  referralCampaign,
  referralCampaignList,
  referralSubmissionList,
  z,
  type CreateReferralCampaignRequest,
  type ReferralCampaignStatus,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const created = z.object({ id: z.string().uuid() })
/** Mutation responses whose body the UI discards; unknown keeps `any` out of the app. */
const anySchema = z.unknown()

export function useReferralCampaigns() {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['referrals', 'campaigns'],
    queryFn: () => callApi('/referrals/campaigns', { responseSchema: referralCampaignList }),
    enabled: !!session && access.hasModule('referrals'),
    staleTime: 15_000,
  })
}

/**
 * This project's own campaign. Someone who may edit referrals gets it made on
 * first open (one per project, the same call every time); anyone else sees it
 * only if it already exists.
 */
export function useProjectCampaign(projectId: string, canEdit: boolean) {
  const { session } = useAuth()
  const access = useAccess()
  const list = useReferralCampaigns()
  const made = useQuery({
    queryKey: ['referrals', 'project', projectId],
    queryFn: () =>
      callApi('/referrals/campaigns/for-project', { method: 'POST', body: { project_id: projectId }, responseSchema: referralCampaign }),
    enabled: !!session && canEdit && access.hasModule('referrals'),
    staleTime: 60_000,
  })
  if (canEdit) return { data: made.data ?? null, isLoading: made.isLoading, isError: made.isError, refetch: made.refetch }
  return {
    data: (list.data?.campaigns ?? []).find((c) => c.project_id === projectId) ?? null,
    isLoading: list.isLoading,
    isError: list.isError,
    refetch: list.refetch,
  }
}

export function useReferralSubmissions(campaignId?: string) {
  const { session } = useAuth()
  const access = useAccess()
  const base = new URLSearchParams()
  if (campaignId) base.set('campaign_id', campaignId)
  const qs = base.toString()

  return useInfiniteQuery({
    queryKey: ['referrals', 'submissions', campaignId ?? 'all'],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(qs)
      if (pageParam) params.set('cursor', pageParam)
      const suffix = params.toString()
      return callApi(`/referrals/submissions${suffix ? `?${suffix}` : ''}`, { responseSchema: referralSubmissionList })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!session && access.hasModule('referrals'),
    staleTime: 15_000,
  })
}

function useReferralMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>, message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['referrals'] })
    },
  })
}

export function useSaveReferralCampaign() {
  return useReferralMutation(
    ({ id, body }: { id?: string | undefined; body: CreateReferralCampaignRequest }) =>
      callApi(id ? `/referrals/${id}` : '/referrals/campaigns', {
        method: id ? 'PATCH' : 'POST',
        body,
        responseSchema: id ? anySchema : created,
      }),
    'Campaign saved',
  )
}

export function useUpdateReferralCampaignStatus() {
  return useReferralMutation(
    ({ id, status }: { id: string; status: ReferralCampaignStatus }) =>
      callApi(`/referrals/${id}/status`, { method: 'PATCH', body: { status }, responseSchema: anySchema }),
    'Campaign status updated',
  )
}

export function useDeleteReferralCampaign() {
  return useReferralMutation(
    (id: string) => callApi(`/referrals/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Campaign deleted',
  )
}

/** Every referral whose reward is at one stage: "due" (to give) or "given". */
export function useRewardSubmissions(reward: 'due' | 'given') {
  const { session } = useAuth()
  const access = useAccess()
  return useQuery({
    queryKey: ['referrals', 'rewards', reward],
    queryFn: () => callApi(`/referrals/submissions?reward_status=${reward}&limit=200`, { responseSchema: referralSubmissionList }),
    enabled: !!session && access.hasModule('referrals'),
    staleTime: 15_000,
  })
}

export function useUpdateSubmissionStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, reward_status, reward_amount }: { id: string; status?: string; reward_status?: string; reward_amount?: number }) =>
      callApi(`/referrals/submissions/${id}/status`, {
        method: 'PATCH',
        body: {
          ...(status ? { status } : {}),
          ...(reward_status ? { reward_status } : {}),
          ...(reward_amount != null ? { reward_amount } : {}),
        },
        responseSchema: anySchema,
      }),
    onSuccess: () => {
      toast.success('Status updated')
      void qc.invalidateQueries({ queryKey: ['referrals'] })
    },
  })
}
