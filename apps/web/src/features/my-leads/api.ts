import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { myLead, myLeadDetail, z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/**
 * The leads given to me (0282) and what I do with them -- write what was
 * said, set the next follow-up, move one -- through /me, so a team member
 * works their own leads without the studio's CRM.
 */
const ok = z.object({ ok: z.boolean() })

export function useMyLeads() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['me', 'leads'],
    queryFn: () => callApi('/me/leads', { responseSchema: myLead.array() }),
    enabled: !!session,
    staleTime: 30_000,
    refetchInterval: 120_000,
  })
}

export function useMyLead(id: string | null) {
  return useQuery({
    queryKey: ['me', 'leads', id],
    queryFn: () => callApi(`/me/leads/${id}`, { responseSchema: myLeadDetail }),
    enabled: !!id,
  })
}

function useMeMutation<T>(fn: (v: T) => Promise<unknown>, done: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(done)
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['crm'] })
    },
    onError: (e: Error) => toast.error(e.message || 'That did not save. Please try again.'),
  })
}

export function useAddMyNote() {
  return useMeMutation(
    ({ id, body }: { id: string; body: string }) => callApi(`/me/leads/${id}/notes`, { method: 'POST', body: { body }, responseSchema: ok }),
    'Note saved',
  )
}

export function useAddMyFollowUp() {
  return useMeMutation(
    ({ id, due_at, subject, body }: { id: string; due_at: string; subject: string; body?: string }) =>
      callApi(`/me/leads/${id}/follow-ups`, { method: 'POST', body: { due_at, subject, ...(body ? { body } : {}) }, responseSchema: ok }),
    'Follow-up set. You will be reminded.',
  )
}

export function useMoveMyFollowUp() {
  return useMeMutation(
    ({ id, due_at }: { id: string; due_at: string }) => callApi(`/me/follow-ups/${id}`, { method: 'PATCH', body: { due_at }, responseSchema: ok }),
    'Moved',
  )
}
