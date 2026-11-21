/**
 * The `state` that ties "Connect with Facebook" to the tab that started it
 * (audit, 21 Nov). Without it, anyone could send a studio owner a link that
 * lands back here with their own Facebook `?code=`, and the studio would quietly
 * import the sender's Pages. A random value is kept in this tab's
 * sessionStorage on the way out; a code that comes back without the same
 * value is never exchanged.
 */
const KEY = 'meta-oauth-state'

/** A fresh random state, remembered in this tab. */
export function rememberOauthState(random: () => string = () => crypto.randomUUID()): string {
  const state = random()
  try {
    sessionStorage.setItem(KEY, state)
  } catch {
    // Storage blocked: the code that comes back will be refused, and the card says why.
  }
  return state
}

/** Reads and forgets this tab's state: one use only. */
export function takeOauthState(): string | null {
  try {
    const v = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return v
  } catch {
    return null
  }
}

/** The Connect link with our state on it. */
export function withOauthState(connectUrl: string, state: string): string {
  const url = new URL(connectUrl)
  url.searchParams.set('state', state)
  return url.toString()
}

/** Whether a returned state is the one this tab sent. */
export function oauthStateMatches(returned: string | null, kept: string | null): boolean {
  return !!returned && !!kept && returned === kept
}
