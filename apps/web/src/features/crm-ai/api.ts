import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  leadReplyReply,
  sequenceDraft,
  z,
  type LeadMessagedRequest,
  type LeadReplyRequest,
  type SequenceDraftRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'

/**
 * AI for leads (owner, 9 Nov). `mine` is a team member's own lead on My
 * leads (/me), otherwise the CRM's. Errors carry the server's sentence
 * ("AI writing is not switched on yet", "used today's 50 writings").
 */
const ok = z.object({ ok: z.boolean() })
const base = (leadId: string, mine: boolean) => (mine ? `/me/leads/${leadId}` : `/crm/leads/${leadId}`)

export function useWriteReply(leadId: string, mine = false) {
  return useMutation({
    mutationFn: (body: LeadReplyRequest) =>
      callApi(`${base(leadId, mine)}/reply`, { method: 'POST', body, responseSchema: leadReplyReply }),
  })
}

/** The reply went out (WhatsApp opened, or copied): kept on the lead's timeline. */
export function useReplySent(leadId: string, mine = false) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LeadMessagedRequest) => callApi(`${base(leadId, mine)}/reply/sent`, { method: 'POST', body, responseSchema: ok }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: mine ? ['me'] : ['crm'] }),
  })
}

/** Sent from the studio's own WhatsApp number (CRM only, while WhatsApp allows it). */
export function useReplySendDirect(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => callApi(`/crm/leads/${leadId}/reply/send`, { method: 'POST', body: { text }, responseSchema: ok }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crm'] }),
  })
}

export function useWriteSequence() {
  return useMutation({
    mutationFn: (body: SequenceDraftRequest) =>
      callApi('/crm/sequences/write', { method: 'POST', body, responseSchema: sequenceDraft }),
  })
}
