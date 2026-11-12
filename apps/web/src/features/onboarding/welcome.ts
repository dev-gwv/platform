import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { welcomeResult } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useHints } from '@/features/team/hints-api'

/** Per person: signing out and in as someone else in the same tab asks for them too. */
const asked = new Set<string>()

/**
 * Once per person, after sign-in: ask the server for the welcome in the bell
 * ("Welcome! Set up Studio AutoPilot in 6 short videos", or a team member's
 * own videos). The server decides whether it is due and writes the `welcome`
 * note either way, so this asks once per person, never once per device.
 */
export function useWelcomeOnce() {
  const { session } = useAuth()
  const hints = useHints()
  const qc = useQueryClient()
  const uid = session?.user_id ?? null
  const due = !!uid && hints.isSuccess && !hints.data.welcome
  useEffect(() => {
    if (!due || !uid || asked.has(uid)) return
    asked.add(uid)
    void callApi('/auth/welcome', { method: 'POST', responseSchema: welcomeResult })
      .then((r) => {
        void qc.invalidateQueries({ queryKey: ['me', 'hints'] })
        if (r.sent) void qc.invalidateQueries({ queryKey: ['notifications'] })
      })
      .catch(() => {
        // Not worth interrupting anyone for; it is asked again on the next load.
        asked.delete(uid)
      })
  }, [due, uid, qc])
}
