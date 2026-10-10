import { askReply, askRequest, type AskRequest } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { addSaid, setPending } from './thread'

/**
 * Asking, outside React.
 *
 * This was a `useMutation` inside `AssistantPanel`, which is rendered inside
 * the Sheet, and the Sheet closes on every navigation. In TanStack Query v5 the
 * callbacks handed to `mutate()` do not fire once the component has unmounted —
 * so walking to another page while an answer was in flight threw the answer
 * away. The question was already in the thread, already counted against the
 * day's allowance and already paid for; it simply never came back, and
 * reopening the panel showed a question with nothing under it.
 *
 * Moving the thread to a module store fixed the conversation surviving. This
 * fixes the answer surviving, which is the same bug one layer down: the request
 * must not live anywhere that can unmount.
 */

/** The one request that can be in the air, so Stop has something to pull. */
let inFlight: AbortController | null = null

/** Pressed Stop, so the abort that follows is not drawn as a failure. */
let stopped = false

export function stopAsking(): void {
  if (!inFlight) return
  stopped = true
  inFlight.abort()
}

export async function askAssistant(
  body: AskRequest,
  opts: { callUrl: string | null; onSettled?: () => void },
): Promise<void> {
  // One at a time. The panel already disables Send while pending, but the
  // store outlives the panel and a second tab's worth of clicks should not
  // start two.
  if (inFlight) return

  stopped = false
  inFlight = new AbortController()
  setPending(true)

  try {
    const r = await callApi('/assistant/ask', {
      method: 'POST',
      body: askRequest.parse(body),
      responseSchema: askReply,
      signal: inFlight.signal,
    })
    addSaid({
      role: 'assistant',
      text: r.answer,
      sources: r.sources,
      callUrl: r.call_url,
      broke: r.status === 'failed',
      logId: r.log_id,
      helpful: null,
    })
  } catch (e) {
    // They pressed Stop. Nothing went wrong, so say nothing: the question stays
    // on screen and Try again is under it.
    if (!stopped) {
      addSaid({
        role: 'assistant',
        text: e instanceof Error ? e.message : 'We could not answer just now.',
        callUrl: opts.callUrl,
        broke: true,
      })
    }
  } finally {
    inFlight = null
    stopped = false
    setPending(false)
    // The day's count has moved whatever happened.
    opts.onSettled?.()
  }
}
