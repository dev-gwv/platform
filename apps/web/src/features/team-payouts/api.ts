import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'
import {
  teamPayoutList,
  payoutSettlementList,
  createPayoutSettlementResponse,
  z,
  type CreateTeamPayoutRequest,
  type UpdateTeamPayoutRequest,
  type CreatePayoutSettlementRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

const created = z.object({ id: z.string().uuid() })
/** Mutation responses whose body the UI discards; unknown keeps `any` out of the app. */
const anySchema = z.unknown()

export function useTeamPayouts(filters?: { user_id?: string; status?: string }) {
  const { session } = useAuth()
  const access = useAccess()
  const params = new URLSearchParams()
  if (filters?.user_id) params.set('user_id', filters.user_id)
  if (filters?.status) params.set('status', filters.status)
  const qs = params.toString()

  return useQuery({
    queryKey: ['team-payouts', filters?.user_id ?? '', filters?.status ?? 'all'],
    queryFn: () => callApi(`/team-payouts${qs ? `?${qs}` : ''}`, { responseSchema: teamPayoutList }),
    enabled: !!session && access.hasModule('team_payouts'),
    staleTime: 15_000,
  })
}

function useTeamPayoutMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>, message: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message)
      void qc.invalidateQueries({ queryKey: ['team-payouts'] })
    },
  })
}

export function useCreateTeamPayout() {
  return useTeamPayoutMutation(
    (body: CreateTeamPayoutRequest) =>
      callApi('/team-payouts', { method: 'POST', body, responseSchema: created }),
    'Payout created',
  )
}

export function useUpdateTeamPayout() {
  return useTeamPayoutMutation(
    ({ id, patch }: { id: string; patch: UpdateTeamPayoutRequest }) =>
      callApi(`/team-payouts/${id}`, { method: 'PATCH', body: patch, responseSchema: anySchema }),
    'Payout updated',
  )
}

export function useUpdatePayoutStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      callApi(`/team-payouts/${id}/status`, {
        method: 'PATCH',
        body: { status },
        responseSchema: anySchema,
      }),
    onSuccess: () => {
      toast.success('Status updated')
      void qc.invalidateQueries({ queryKey: ['team-payouts'] })
    },
  })
}

export function useDeleteTeamPayout() {
  return useTeamPayoutMutation(
    (id: string) => callApi(`/team-payouts/${id}`, { method: 'DELETE', responseSchema: anySchema }),
    'Payout deleted',
  )
}

// ── Shoot-derived tracker: a cash ledger against booked slots ──────
// Kept alongside the manual payouts above -- separate query key, since it
// reads and writes nothing the manual list touches.
export function usePayoutSettlements(slotIds: readonly string[]) {
  const { session } = useAuth()
  const access = useAccess()
  // One read of the studio's settlements, narrowed here: a list of every slot
  // id in the query string grew past what a URL can carry (thousands of
  // bookings), and the server returns the whole studio when given none.
  const wanted = useMemo(() => new Set(slotIds), [slotIds])
  return useQuery({
    queryKey: ['team-payouts', 'settlements', 'all'],
    queryFn: () => callApi('/team-payouts/settlements', { responseSchema: payoutSettlementList }),
    enabled: !!session && access.hasModule('team_payouts') && slotIds.length > 0,
    staleTime: 15_000,
    select: (data) => ({
      ...data,
      entries: data.entries.filter((e) => wanted.has(e.slot_id)),
      aggregates: data.aggregates.filter((a) => wanted.has(a.slot_id)),
    }),
  })
}

export function useCreatePayoutSettlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreatePayoutSettlementRequest) =>
      callApi('/team-payouts/settlements', { method: 'POST', body, responseSchema: createPayoutSettlementResponse }),
    onSuccess: () => {
      toast.success('Settlement recorded')
      void qc.invalidateQueries({ queryKey: ['team-payouts', 'settlements'] })
    },
  })
}
