import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { z, authToken, sessionState, type SessionState } from '@ipc/contracts'
import { callApi, ApiError, markCookieSession, hasStoredSession, rotateTokens, setAuthLostHandler } from '../api/client'
import { clearThread } from '@/features/assistant/thread'
import { clearToken, getRefreshToken, getToken, onSessionChange, setTokens } from './token'
import { MOCK_ENABLED } from '../dev/mock-flag'
import { setSentryUser } from '@/shared/error/sentry'

const ok = z.object({ ok: z.boolean() })

interface AuthValue {
  session: SessionState | null
  loading: boolean
  /**
   * Set when the session could not be established for a reason that is NOT
   * "signed out": the API was unreachable, rate-limited, or failing. The
   * stored tokens are kept so a retry can succeed without a fresh sign-in.
   */
  bootError: string | null
  /**
   * Signed in, but the login has no studio yet: a Google sign-up that never
   * named one. The route guard sends them to /complete-setup, not /login --
   * sending them to sign in again only brought them back here.
   */
  noStudio: boolean
  /** Re-read the session; resolves to it (null when signed out). */
  refresh: () => Promise<SessionState | null>
  /** Re-run the boot after a bootError. */
  retry: () => Promise<void>
  signOut: () => Promise<void>
  signOutEverywhere: () => Promise<void>
  /**
   * Open another studio this login belongs to (`session.studios`). Reloads
   * into its dashboard: every cached row, and every page's local state,
   * belongs to the studio being left.
   */
  switchStudio: (profileId: string) => Promise<void>
}

const AuthCtx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [noStudio, setNoStudio] = useState(false)
  const qc = useQueryClient()

  /**
   * End the local session. The query cache holds one tenant's rows, so it must
   * go with it — otherwise the next account signed in on this machine is served
   * the previous studio's data straight from cache.
   */
  const endSession = useCallback(() => {
    clearToken()
    markCookieSession(false)
    setSession(null)
    setNoStudio(false)
    qc.clear()
    // The help assistant's thread is held at module scope so it survives the
    // panel closing, which means qc.clear() does not reach it -- and two people
    // sharing a laptop must not read each other's questions.
    clearThread()
  }, [qc])

  // A refused refresh means the session is gone server-side; drop it here too so
  // the route guard bounces to /login instead of leaving a shell that errors.
  useEffect(() => {
    setAuthLostHandler(() => endSession())
    return () => setAuthLostHandler(null)
  }, [endSession])

  const refresh = useCallback(async () => {
    if (MOCK_ENABLED) {
      const { mockSession } = await import('../dev/mock')
      setSession(mockSession)
      return mockSession
    }
    // A new tab has no access token (it is per tab); a refresh from the stored
    // token or the HttpOnly cookie mints one before anything is asked.
    if (!getToken() && !(await rotateTokens())) {
      // Still holding a session means the refresh was not refused -- the
      // server did not answer. Say so, with Retry, rather than sign them out.
      if (hasStoredSession()) throw new Error('We could not reach the server. Check your connection and try again.')
      setSession(null)
      setNoStudio(false)
      return null
    }
    try {
      const s = await callApi('/auth/session', { responseSchema: sessionState })
      setSession(s)
      setNoStudio(false)
      // Every later event carries who and which studio. Set here rather than
      // at sign-in so a returning session (page reload, token refresh) is
      // identified too, not just a fresh login.
      setSentryUser(s)
      return s
    } catch (e) {
      // Network/5xx should NOT log out - keep session for retry; only 401/403 mean gone.
      const status = e instanceof ApiError ? e.status : undefined
      if (status === 401 || status === 403) {
        setSession(null)
        // The one 403 that is not "signed out": a real login with no studio.
        setNoStudio(status === 403 && e instanceof ApiError && /no studio/i.test(e.message))
        return null
      }
      throw e
    }
  }, [])

  /**
   * Establish the session once. A thrown refresh used to leave `loading` true
   * forever — one 429 from a shared office address and the app sat on
   * "Loading…" with no way out. Now the failure is surfaced with a retry.
   */
  const boot = useCallback(async () => {
    setLoading(true)
    setBootError(null)
    try {
      await refresh()
    } catch (e) {
      setBootError(e instanceof Error ? e.message : 'We could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [refresh])

  useEffect(() => {
    void boot()
    // A sign-in or sign-out in another tab is felt here without a reload.
    return onSessionChange(() => void boot())
  }, [boot])

  const signOut = useCallback(async () => {
    // Stop attributing anything that happens next to the person who left.
    setSentryUser(null)
    const refresh_token = getRefreshToken()
    // Drop the session first: sign-out must feel instant and must not hinge on
    // the network. The server call revokes the family behind us — from the
    // body token here, or from the HttpOnly cookie it holds in cookie mode.
    endSession()
    if (!MOCK_ENABLED) {
      await callApi('/auth/logout', {
        method: 'POST',
        body: refresh_token ? { refresh_token } : {},
        responseSchema: ok,
      }).catch(() => null)
    }
  }, [endSession])

  /**
   * Sign out on every device, this one included. The server call is the whole
   * point here, so a failure propagates — the caller must not tell the user
   * their other devices are dead when nothing was revoked.
   */
  const signOutEverywhere = useCallback(async () => {
    if (MOCK_ENABLED) {
      endSession()
      return
    }
    await callApi('/auth/logout-all', { method: 'POST', responseSchema: ok })
    endSession()
  }, [endSession])

  const switchStudio = useCallback(
    async (profileId: string) => {
      if (MOCK_ENABLED) return
      const refresh_token = getRefreshToken()
      const pair = await callApi('/auth/switch', {
        method: 'POST',
        body: { profile_id: profileId, ...(refresh_token ? { refresh_token } : {}) },
        responseSchema: authToken,
      })
      setTokens(pair)
      markCookieSession(!pair.refresh_token)
      qc.clear()
      window.location.assign('/dashboard')
    },
    [qc],
  )

  return (
    <AuthCtx
      value={{ session, loading, bootError, noStudio, refresh, retry: boot, signOut, signOutEverywhere, switchStudio }}
    >
      {children}
    </AuthCtx>
  )
}

export function useAuth(): AuthValue {
  const v = use(AuthCtx)
  if (!v) throw new Error('useAuth must be used within <AuthProvider>')
  return v
}
