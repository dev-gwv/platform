import { useSyncExternalStore } from 'react'
import type { AssistantLang } from '@ipc/contracts'
import { useHints } from '@/features/team/hints-api'
import { snapshot, subscribe } from './thread'

/**
 * The language the assistant answers in: picked in this visit, else saved on
 * the person's row, else null -- and null is the panel's cue to ask.
 *
 * One hook so the panel and the help bubble around it can never disagree.
 * `waiting` is true while the saved choice is still loading, so nobody who
 * already picked sees the question flash past on every load.
 */
export function useAssistantLang(): { lang: AssistantLang | null; waiting: boolean } {
  const picked = useSyncExternalStore(subscribe, () => snapshot().lang, () => null)
  const hints = useHints()
  return { lang: picked ?? hints.data?.assistant_lang?.lang ?? null, waiting: !picked && hints.isPending }
}
