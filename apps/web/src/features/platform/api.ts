import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z, legacyImportResult, paymentCreditResult, paymentRecovery, platformPlanList, flowStopList, platformPlanCounts, legacyStudioList, platformStudioList, platformUsage, type LegacyStudioInput, type PlatformPlanAction, type PlatformCreateStudioRequest } from '@ipc/contracts'
import { toast } from 'sonner'
import { callApi, SLOW_TIMEOUT_MS } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const ok = z.object({ ok: z.boolean() })
const created = z.object({ id: z.string() })

/** Cross-tenant vendor console reads. Gated on the platform_admins allowlist. */
export function usePlatformStudios() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['platform', 'studios'],
    queryFn: () => callApi('/platform/studios', { responseSchema: platformStudioList }),
    enabled: !!session?.is_platform_admin,
    staleTime: 30_000,
  })
}

export function usePlatformUsage(days = '30', module?: string) {
  const { session } = useAuth()
  const params = new URLSearchParams({ days })
  if (module) params.set('module', module)
  return useQuery({
    queryKey: ['platform', 'usage', params.toString()],
    queryFn: () => callApi(`/platform/usage?${params.toString()}`, { responseSchema: platformUsage }),
    enabled: !!session?.is_platform_admin,
    staleTime: 30_000,
  })
}

const ACTION_MSG: Record<PlatformPlanAction['action'], string> = {
  extend: 'Plan extended',
  expire: 'Plan expired',
  trial: 'Trial granted',
}

/** Vendor plan action on one tenant (extend / expire / grant trial). */
export function usePlatformPlanAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ studioId, ...body }: PlatformPlanAction & { studioId: string }) =>
      callApi(`/platform/studios/${studioId}/plan`, { method: 'POST', body, responseSchema: ok }),
    onSuccess: (_data, vars) => {
      toast.success(ACTION_MSG[vars.action])
      void qc.invalidateQueries({ queryKey: ['platform'] })
    },
  })
}

/** Lovable parity: vendor-provisioned studio. */
export function useCreatePlatformStudio() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PlatformCreateStudioRequest) =>
      callApi('/platform/studios', { method: 'POST', body: input, responseSchema: created }),
    onSuccess: () => {
      toast.success('Studio created')
      void qc.invalidateQueries({ queryKey: ['platform'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create the studio.'),
  })
}

/** The old app's subscribers, imported from its Studio Access export (0218). */
export function useLegacyStudios() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['platform', 'legacy'],
    queryFn: () => callApi('/platform/legacy', { responseSchema: legacyStudioList }),
    enabled: !!session?.is_platform_admin,
    staleTime: 30_000,
  })
}

export function useImportLegacyStudios() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rows: LegacyStudioInput[]) =>
      callApi('/platform/legacy/import', { method: 'POST', body: { rows }, responseSchema: legacyImportResult, timeoutMs: SLOW_TIMEOUT_MS }),
    onSuccess: (r) => {
      toast.success(`${r.imported} added, ${r.updated} updated${r.carried ? ` · ${r.carried} already on the new app got their time` : ''}.`)
      void qc.invalidateQueries({ queryKey: ['platform'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/** Access to the end of a chosen day (0220): the old board's Extend 30 / 90 / 180 days and Custom expiry. */
export function useSetAccessUntil() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ studioId, until }: { studioId: string; until: string }) =>
      callApi(`/platform/studios/${studioId}/plan`, { method: 'POST', body: { action: 'until', until }, responseSchema: ok }),
    onSuccess: (_d, v) => {
      toast.success(`Access now runs until ${new Date(`${v.until}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`)
      void qc.invalidateQueries({ queryKey: ['platform'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change access.'),
  })
}

/** The whole plan catalogue (both audiences), for "Assign plan". */
export function usePlatformPlans(enabled = true) {
  return useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => callApi('/platform/plans', { responseSchema: platformPlanList }),
    enabled,
    staleTime: 5 * 60_000,
  })
}

/** Where people stop, per screen a new studio learns. */
export function useFlowStops(days: string) {
  return useQuery({
    queryKey: ['platform', 'usage', 'stuck', days],
    queryFn: () => callApi(`/platform/usage/stuck?days=${encodeURIComponent(days)}`, { responseSchema: flowStopList }),
    staleTime: 60_000,
  })
}

/** Paying studios and studios on a free trial, for Platform → Plans. */
export function usePlatformPlanCounts() {
  return useQuery({
    queryKey: ['platform', 'plans', 'counts'],
    queryFn: () => callApi('/platform/plans/counts', { responseSchema: platformPlanCounts }),
  })
}

/** On sale or off; a studio already on the plan keeps it. */
export function useSetPlanOnSale() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, onSale }: { key: string; name: string; onSale: boolean }) =>
      callApi(`/platform/plans/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body: { on_sale: onSale },
        responseSchema: z.object({ ok: z.boolean() }),
      }),
    onSuccess: (_r, v) => {
      toast.success(v.onSale ? `${v.name} is on sale` : `${v.name} is off sale. Studios on it keep it.`)
      void qc.invalidateQueries({ queryKey: ['platform', 'plans'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change the plan.'),
  })
}

export function useAssignPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ studioId, planKey }: { studioId: string; planKey: string }) =>
      callApi(`/platform/studios/${studioId}/assign-plan`, {
        method: 'POST',
        body: { plan_key: planKey },
        responseSchema: z.object({ ok: z.boolean(), until: z.string() }),
      }),
    onSuccess: (r) => {
      toast.success(`Plan given · access until ${new Date(r.until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`)
      void qc.invalidateQueries({ queryKey: ['platform'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not assign the plan.'),
  })
}

/** Orders Razorpay charged that never gave a plan, and payments for orders we do not know. */
export function usePaymentRecovery() {
  return useQuery({
    queryKey: ['platform', 'payments', 'recovery'],
    queryFn: () => callApi('/platform/payments/recovery', { responseSchema: paymentRecovery }),
    staleTime: 30_000,
  })
}

export function useCreditPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      callApi(`/platform/payments/${orderId}/credit`, { method: 'POST', responseSchema: paymentCreditResult }),
    onSuccess: (r) => {
      toast.success(r.duplicate ? 'Already credited earlier' : 'Credited · the studio has its plan')
      void qc.invalidateQueries({ queryKey: ['platform'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not credit the order.'),
  })
}
