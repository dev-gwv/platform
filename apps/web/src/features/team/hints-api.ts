import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { userHints, type HintKey, type HintNote, type LearnNote, type UserHints } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const KEY = ['me', 'hints'] as const

/** The signed-in person's one-time notes (0216). */
export function useHints() {
  const { session } = useAuth()
  return useQuery({
    queryKey: KEY,
    queryFn: () => callApi('/auth/hints', { responseSchema: userHints }),
    enabled: !!session,
    staleTime: 5 * 60_000,
  })
}

export function useSetHint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: HintKey; value: HintNote | LearnNote | null }) =>
      callApi(`/auth/hints/${key}`, { method: 'PUT', body: { value }, responseSchema: userHints }),
    onMutate: ({ key, value }) => {
      // The count moves the moment the note shows, not after the round trip.
      const prev = qc.getQueryData<UserHints>(KEY)
      qc.setQueryData<UserHints>(KEY, { ...(prev ?? {}), [key]: value ?? undefined })
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(KEY, ctx.prev),
    onSuccess: (hints) => qc.setQueryData(KEY, hints),
  })
}
