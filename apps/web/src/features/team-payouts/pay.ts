import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { crewOwed, crewPayouts, crewPayoutsPage, myPayouts, projectPayoutRow, slotPayStatus, type PaySlotRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

/** Where a payout stands, in the studio's words. */
type PayState = 'no_amount' | 'due' | 'part' | 'paid'

export function payState(amount: number, paid: number): PayState {
  if (paid > 0 && paid + 0.001 >= amount) return 'paid'
  if (paid > 0) return 'part'
  return amount > 0 ? 'due' : 'no_amount'
}

export const PAY_STATE_LABEL: Record<PayState, string> = {
  no_amount: 'No payout set',
  due: 'Not paid',
  part: 'Part paid',
  paid: 'Paid',
}

/** Who may see and record payouts: the Team payouts module. */
export function useCanPay() {
  return useAccess().hasModule('team_payouts')
}

export function useProjectPayouts(projectId: string) {
  const { session } = useAuth()
  const can = useCanPay()
  return useQuery({
    queryKey: ['payouts', 'project', projectId],
    queryFn: () => callApi(`/team-payouts/project/${projectId}`, { responseSchema: projectPayoutRow.array() }),
    enabled: !!session && can && !!projectId,
    staleTime: 15_000,
  })
}

export function useSlotPayStatus(slotId: string | null | undefined, enabled = true) {
  const { session } = useAuth()
  const can = useCanPay()
  return useQuery({
    queryKey: ['payouts', 'slot', slotId],
    queryFn: () => callApi(`/team-payouts/slot/${slotId}`, { responseSchema: slotPayStatus }),
    enabled: !!session && can && !!slotId && enabled,
    staleTime: 10_000,
  })
}

export function usePaySlot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slotId, body }: { slotId: string; body: PaySlotRequest }) =>
      callApi(`/team-payouts/slot/${slotId}/pay`, { method: 'POST', body, responseSchema: slotPayStatus }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['payouts'] })
      void qc.invalidateQueries({ queryKey: ['team-payouts'] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'We could not save the payout.'),
  })
}

export function useMyPayouts() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['payouts', 'mine'],
    queryFn: () => callApi('/me/payouts', { responseSchema: myPayouts }),
    enabled: !!session,
    staleTime: 30_000,
  })
}

/** Every booking's money for Team payouts (Owed now / Upcoming / All); one person's with userId. */
export function useCrewPayouts(userId?: string | null) {
  const { session } = useAuth()
  const can = useCanPay()
  return useQuery({
    queryKey: ['payouts', 'crew', userId ?? 'all'],
    queryFn: () =>
      callApi(`/team-payouts/shoots${userId ? `?user_id=${userId}` : ''}`, { responseSchema: crewPayouts }),
    enabled: !!session && can,
    staleTime: 15_000,
  })
}

/**
 * Team payouts a page at a time (GET /team-payouts/shoots/page): the view and
 * filters run on the server, `limit` rows come back. A longer page keeps the
 * shorter one on screen while it comes; another view or filter starts clean.
 */
export function useCrewPayoutsPage(q: { view: string; q?: string; project_id?: string; from?: string; to?: string }, limit: number) {
  const { session } = useAuth()
  const can = useCanPay()
  const params = new URLSearchParams({ view: q.view, limit: String(limit) })
  for (const k of ['q', 'project_id', 'from', 'to'] as const) {
    const v = q[k]?.trim()
    if (v) params.set(k, v)
  }
  const filterKey = [q.view, q.q?.trim() ?? '', q.project_id ?? '', q.from ?? '', q.to ?? '']
  return useQuery({
    queryKey: ['payouts', 'crew', 'page', ...filterKey, limit],
    queryFn: () => callApi(`/team-payouts/shoots/page?${params.toString()}`, { responseSchema: crewPayoutsPage }),
    enabled: !!session && can,
    staleTime: 15_000,
    placeholderData: (prev, prevQuery) => {
      const k = prevQuery?.queryKey
      return k && filterKey.every((v, i) => k[3 + i] === v) ? prev : undefined
    },
  })
}

/** What the studio owes its crew for shoots already done (dashboard). */
export function useCrewOwed(enabled = true) {
  const { session } = useAuth()
  const can = useCanPay()
  return useQuery({
    queryKey: ['payouts', 'owed'],
    queryFn: () => callApi('/team-payouts/owed', { responseSchema: crewOwed }),
    enabled: !!session && can && enabled,
    staleTime: 30_000,
  })
}
