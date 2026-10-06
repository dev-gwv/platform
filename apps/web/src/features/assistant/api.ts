import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  askReply,
  askRequest,
  assistantSettings,
  assistantState,
  z,
  type AskReply,
  type AskRequest,
  type SaveAssistantSettingsRequest,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const STATE = ['assistant', 'state'] as const
const SETTINGS = ['assistant', 'settings'] as const

/**
 * Whether to draw the assistant at all, and how much of today's allowance is
 * left. Read once per load and cached: it decides whether a header button
 * exists, so it must not make the header flicker on every navigation.
 */
export function useAssistantState() {
  const { session } = useAuth()
  return useQuery({
    queryKey: STATE,
    queryFn: () => callApi('/assistant/state', { responseSchema: assistantState }),
    enabled: !!session,
    staleTime: 5 * 60_000,
    // A studio that cannot reach this should get a header without a button,
    // not a header with a button that fails when pressed.
    retry: 1,
  })
}

/**
 * Ask a question.
 *
 * SLOW_TIMEOUT_MS is deliberately not used: a help answer that takes two
 * minutes is no use to someone standing in front of a client, and the ordinary
 * 30 s is already well past what a provider needs for a prompt this size.
 *
 * Nothing is invalidated on success except the day's count, because the
 * conversation lives in the panel's own state. Asking is not a write to
 * anything the rest of the app shows.
 */
export function useAsk() {
  const qc = useQueryClient()
  return useMutation<AskReply, Error, AskRequest>({
    mutationFn: (body) =>
      callApi('/assistant/ask', { method: 'POST', body: askRequest.parse(body), responseSchema: askReply }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STATE })
    },
    // No toast: the panel shows what went wrong in the conversation itself,
    // where the question is, and a toast on top of that says it twice.
  })
}

export function useAssistantSettings() {
  const { session } = useAuth()
  return useQuery({
    queryKey: SETTINGS,
    queryFn: () => callApi('/platform/assistant', { responseSchema: assistantSettings }),
    enabled: !!session,
  })
}

export function useSaveAssistantSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveAssistantSettingsRequest) =>
      callApi('/platform/assistant', { method: 'PUT', body, responseSchema: z.unknown() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS })
      // The switch and the call link both live on the studio's side of this
      // setting, so the panel's view of itself is now stale.
      void qc.invalidateQueries({ queryKey: STATE })
      toast.success('Saved.')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
