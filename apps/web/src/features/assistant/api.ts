import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  assistantFeedbackRequest,
  assistantHealth,
  assistantSettings,
  assistantState,
  assistantTestResult,
  z,
  type AssistantFeedbackRequest,
  type SaveAssistantSettingsRequest,
} from '@ipc/contracts'
import { callApi, SLOW_TIMEOUT_MS } from '@/shared/api/client'
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
 * The day's count has moved, so the panel's "N left today" is stale.
 *
 * Asking itself lives in send.ts, outside React: the panel unmounts on every
 * navigation and a mutation that unmounts loses its answer.
 */
export function useAssistantQuotaRefresh() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: STATE })
  }
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

/**
 * "Did this help?" on one answer.
 *
 * Deliberately quiet: no toast, no invalidation, and a failure is swallowed.
 * The panel has already drawn the thank-you from its own state, and telling
 * someone their thumb did not reach us is noise about our problem, not theirs.
 */
export function useAssistantFeedback() {
  return useMutation({
    mutationFn: (body: AssistantFeedbackRequest) =>
      callApi('/assistant/feedback', {
        method: 'POST',
        body: assistantFeedbackRequest.parse(body),
        responseSchema: z.unknown(),
      }),
    onError: () => {},
  })
}

/** How the assistant is doing, for the platform console. */
export function useAssistantHealth() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['assistant', 'health'],
    queryFn: () => callApi('/platform/assistant/health', { responseSchema: assistantHealth }),
    enabled: !!session,
    staleTime: 60_000,
  })
}

/**
 * Ask one real question from the console, to prove the key, the model and the
 * corpus all actually work. Not logged and not counted against anyone's day.
 */
export function useTestAssistant() {
  return useMutation({
    mutationFn: () =>
      callApi('/platform/assistant/test', {
        method: 'POST',
        body: {},
        responseSchema: assistantTestResult,
        timeoutMs: SLOW_TIMEOUT_MS,
      }),
    onError: (e: Error) => toast.error(e.message),
  })
}
