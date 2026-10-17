import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { myOffer, z } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

/** The owner's live offer from the platform (0268), or null. */
export function useMyOffer() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['subscription', 'offer'],
    queryFn: () => callApi('/subscription/offer', { responseSchema: myOffer }),
    enabled: !!session?.is_owner,
    staleTime: 5 * 60_000,
  })
}

/** Seen or asked, once each and best effort: a lost mark never troubles the studio. */
export function markOffer(id: string, kind: 'seen' | 'asked') {
  void callApi(`/subscription/offer/${id}/mark`, { method: 'POST', body: { kind }, responseSchema: z.object({ ok: z.boolean() }) }).catch(() => undefined)
}

/** Marks the offer seen the first time it is on screen. */
export function useMarkOfferSeen(id: string | undefined) {
  useEffect(() => {
    if (id) markOffer(id, 'seen')
  }, [id])
}
