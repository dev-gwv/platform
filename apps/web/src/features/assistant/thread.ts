import type { AssistantSource } from '@ipc/contracts'

/**
 * The open conversation, held outside React.
 *
 * It used to be `useState` inside `AssistantPanel`, and `AssistantPanel` is
 * rendered inside the Sheet -- so Radix unmounted it the moment the panel
 * closed, and the panel closes on every navigation. The result was that
 * following the link in an answer destroyed the conversation that produced it,
 * which is the one thing the assistant exists to do. A store at module scope
 * cannot be unmounted, so the thread survives both.
 *
 * What it deliberately does NOT do is reach storage. Gone on reload is the
 * chosen lifetime: a help conversation is worth resuming while you are working
 * and worth nothing tomorrow, and keeping it would mean a record of a studio's
 * questions on their device for no one to read. `assistant_log` already holds
 * what the platform needs.
 */

export interface Said {
  role: 'user' | 'assistant'
  text: string
  sources?: readonly AssistantSource[]
  callUrl?: string | null
  /** A failure we could not answer through; drawn differently. */
  broke?: boolean
  /** The log row, so "did this help?" can mark the right answer. */
  logId?: string | null
  /** What they said about it, once they have. */
  helpful?: boolean | null
}

export interface Thread {
  said: readonly Said[]
  draft: string
  /**
   * A question is in the air. Here rather than in the panel because the request
   * outlives the panel: see send.ts.
   */
  pending: boolean
}

const EMPTY: Thread = { said: [], draft: '', pending: false }

let current: Thread = EMPTY
const listeners = new Set<() => void>()

const emit = () => {
  for (const l of listeners) l()
}

/** For useSyncExternalStore. */
export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

/**
 * Must return the same object until something changes, or useSyncExternalStore
 * re-renders for ever.
 */
export const snapshot = (): Thread => current

export function setDraft(draft: string): void {
  if (current.draft === draft) return
  current = { ...current, draft }
  emit()
}

export function addSaid(said: Said): void {
  current = { ...current, said: [...current.said, said] }
  emit()
}

export function setPending(pending: boolean): void {
  if (current.pending === pending) return
  current = { ...current, pending }
  emit()
}

/** Marks the latest answer, for the thumbs. */
export function markHelpful(index: number, helpful: boolean): void {
  const next = current.said.map((s, i) => (i === index ? { ...s, helpful } : s))
  current = { ...current, said: next }
  emit()
}

/**
 * Take back the last turn, so Try again re-asks instead of stacking a second
 * copy of the question under the first failure.
 */
export function dropLastSaid(): void {
  if (current.said.length === 0) return
  current = { ...current, said: current.said.slice(0, -1) }
  emit()
}

/** The last thing the studio asked, for Try again. */
export function lastQuestion(): string | null {
  for (let i = current.said.length - 1; i >= 0; i -= 1) {
    const s = current.said[i]
    if (s?.role === 'user') return s.text
  }
  return null
}

/** Start again, and on sign-out. */
export function clearThread(): void {
  if (current === EMPTY) return
  current = EMPTY
  emit()
}
