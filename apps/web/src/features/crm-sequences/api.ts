import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  branding,
  entitlementsResponse,
  leadSequence,
  sequence,
  sequenceSend,
  z,
  type BrandingInput,
  type EntitlementKey,
  type SequenceInput,
  type SequencePatch,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAccess } from '@/shared/auth/useAccess'

/** Everything here is keyed under ['crm'] so a lead change refreshes it too. */
const K = {
  list: ['crm', 'sequences'] as const,
  sends: ['crm', 'sequence-sends'] as const,
  lead: (id: string) => ['crm', 'lead-sequence', id] as const,
}

function useCrmEnabled() {
  const { session } = useAuth()
  const access = useAccess()
  return !!session && access.hasModule('crm')
}

function useDone(message?: string) {
  const qc = useQueryClient()
  return {
    onSuccess: () => {
      if (message) toast.success(message)
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message || 'That did not work. Please try again.'),
  }
}

export function useSequences() {
  const enabled = useCrmEnabled()
  return useQuery({
    queryKey: K.list,
    queryFn: () => callApi('/crm/sequences', { responseSchema: sequence.array() }),
    enabled,
    staleTime: 30_000,
  })
}

export function useSaveSequence() {
  return useMutation({
    mutationFn: ({ id, input }: { id?: string | undefined; input: SequenceInput }) =>
      id
        ? callApi(`/crm/sequences/${id}`, { method: 'PUT', body: input, responseSchema: z.unknown() })
        : callApi('/crm/sequences', { method: 'POST', body: input, responseSchema: z.object({ id: z.string() }) }),
    ...useDone('Sequence saved'),
  })
}

export function usePatchSequence() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SequencePatch }) =>
      callApi(`/crm/sequences/${id}`, { method: 'PATCH', body: patch, responseSchema: z.unknown() }),
    ...useDone(),
  })
}

export function useDeleteSequence() {
  return useMutation({
    mutationFn: (id: string) => callApi(`/crm/sequences/${id}`, { method: 'DELETE', responseSchema: z.unknown() }),
    ...useDone('Sequence deleted'),
  })
}

export function useAddStarters() {
  return useMutation({
    mutationFn: () => callApi('/crm/sequences/starters', { method: 'POST', responseSchema: z.object({ added: z.number() }) }),
    ...useDone('Starter sequences added'),
  })
}

export function useStartSequence() {
  return useMutation({
    mutationFn: ({ id, leadIds }: { id: string; leadIds: string[] }) =>
      callApi(`/crm/sequences/${id}/enroll`, {
        method: 'POST',
        body: { lead_ids: leadIds },
        responseSchema: z.object({ started: z.number(), skipped: z.number() }),
      }),
    ...useDone('Sequence started'),
  })
}

export function useStopSequence() {
  return useMutation({
    mutationFn: (leadId: string) => callApi(`/crm/leads/${leadId}/cadence`, { method: 'DELETE', responseSchema: z.unknown() }),
    ...useDone('Sequence stopped'),
  })
}

/** "Send now": messages written and waiting for someone to send them. */
export function useSendNow() {
  const enabled = useCrmEnabled()
  return useQuery({
    queryKey: K.sends,
    queryFn: () => callApi('/crm/sequences/sends', { responseSchema: z.object({ items: sequenceSend.array() }) }),
    enabled,
    staleTime: 20_000,
  })
}

export function useMarkSent() {
  return useMutation({
    mutationFn: (id: string) => callApi(`/crm/sequences/sends/${id}/done`, { method: 'POST', responseSchema: z.unknown() }),
    ...useDone(),
  })
}

export function useSkipSend() {
  return useMutation({
    mutationFn: (id: string) => callApi(`/crm/sequences/sends/${id}/skip`, { method: 'POST', responseSchema: z.unknown() }),
    ...useDone('Skipped'),
  })
}

export function useLeadSequence(leadId: string) {
  const enabled = useCrmEnabled()
  return useQuery({
    queryKey: K.lead(leadId),
    queryFn: () => callApi(`/crm/leads/${leadId}/sequence`, { responseSchema: leadSequence }),
    enabled,
    staleTime: 20_000,
  })
}

// ── Higher-tier switches and branding ────────────────────────
function useFeatures() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['features'],
    queryFn: () => callApi('/features', { responseSchema: entitlementsResponse }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  })
}

export function useHasFeature(key: EntitlementKey): boolean {
  return useFeatures().data?.keys.includes(key) ?? false
}

export function useBranding() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['features', 'branding'],
    queryFn: () => callApi('/features/branding', { responseSchema: branding }),
    enabled: !!session,
  })
}

export function useSaveBranding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BrandingInput) => callApi('/features/branding', { method: 'PUT', body: input, responseSchema: z.unknown() }),
    onSuccess: () => {
      toast.success('Saved')
      void qc.invalidateQueries({ queryKey: ['features'] })
    },
    onError: (e: Error) => toast.error(e.message || 'We could not save this.'),
  })
}

export function useStudioFeatures(studioId: string | null) {
  return useQuery({
    queryKey: ['platform', 'features', studioId],
    queryFn: () => callApi(`/platform/studios/${studioId}/features`, { responseSchema: entitlementsResponse }),
    enabled: !!studioId,
  })
}

export function useSetStudioFeature(studioId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { key: EntitlementKey; enabled: boolean }) =>
      callApi(`/platform/studios/${studioId}/features`, { method: 'PUT', body: v, responseSchema: entitlementsResponse }),
    onSuccess: (data) => qc.setQueryData(['platform', 'features', studioId], data),
    onError: (e: Error) => toast.error(e.message || 'We could not change this.'),
  })
}
