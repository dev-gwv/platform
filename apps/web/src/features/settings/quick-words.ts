import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { quickHintKey, userHints, type UserHints } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useHints } from '@/features/team/hints-api'
import { useCanAddLookup } from './useCanAddLookup'
import { useCreateCustomLookup } from './api'

/**
 * Every word someone adds in a picker is kept (owner, 26 Oct: "it should show
 * in the suggestions next time ... otherwise they will have to add it
 * manually all the time at all the places"). Whoever may grow the studio's
 * list adds it there, for everyone; anyone else gets it on their own quick
 * list (users.hints `q_<category>`, PUT /auth/quick-words), offered to them
 * in every picker of that list from then on.
 */
export function usePersonalWords(category: string): string[] {
  const hints = useHints()
  const raw = (hints.data as Record<string, unknown> | undefined)?.[quickHintKey(category)]
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

/** Add a word to the studio list when allowed, else to the person's own list. Resolves with the word. */
export function useAddLookupWord(category: string): (label: string, color?: string | null) => Promise<string> {
  const canAdd = useCanAddLookup(category)
  const create = useCreateCustomLookup()
  const qc = useQueryClient()
  const personal = useMutation({
    mutationFn: (word: string) => callApi('/auth/quick-words', { method: 'PUT', body: { category, word }, responseSchema: userHints }),
    onSuccess: (hints: UserHints) => qc.setQueryData(['me', 'hints'], hints),
  })
  return useCallback(
    async (label: string, color?: string | null) => {
      const word = label.trim()
      if (!word) return label
      if (canAdd) await create.mutateAsync({ category, value: word, ...(color ? { color } : {}) })
      // Never let a failed save of a personal word stop the pick itself.
      else await personal.mutateAsync(word).catch(() => undefined)
      return word
    },
    [canAdd, category, create, personal],
  )
}
