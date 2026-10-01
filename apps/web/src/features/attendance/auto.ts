import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { MyAttendanceToday } from '@ipc/contracts'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useAttendanceMe, useCheckIn } from './api'

/**
 * The app marks attendance by itself (0206). On open, when the tab comes
 * back into view, and every five minutes while it stays open, a person who
 * is tracked and not yet marked today has their location read once and sent;
 * the server decides against their rule. Outside the radius nothing is
 * marked and the reason -- "1.2 km from Studio" -- is kept for the Today card.
 *
 * No background tracking: nothing runs while the app is closed.
 */
export type AutoState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'marked'; at: string }
  | { kind: 'outside'; message: string; at: string }
  | { kind: 'denied'; at: string }
  | { kind: 'unavailable'; at: string }
  | { kind: 'failed'; message: string; at: string }

const KEY = ['hr', 'attendance', 'auto'] as const
const EVERY_MS = 5 * 60_000

/**
 * Read once, precisely, and give up after 15 s rather than hang. `fresh` for
 * a tap: someone who has just walked in must not be judged by where the
 * phone was a minute ago.
 */
export function readPosition(fresh = false): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(Object.assign(new Error('unavailable'), { code: -1 }))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: fresh ? 0 : 60_000 })
  })
}

/** Whether today still needs a mark for this person. */
export function needsMark(me: MyAttendanceToday | undefined): boolean {
  if (!me) return false
  // A studio that has not set attendance up tracks nobody (0223): no mark,
  // and no location prompt either.
  if (!me.configured || me.mode === 'off' || me.day_off || me.on_leave) return false
  return !me.today?.check_in_at
}

/** The last automatic attempt, shared with the Today card. */
export function useAutoState(): AutoState {
  const { data } = useQuery<AutoState>({ queryKey: KEY, queryFn: () => ({ kind: 'idle' }), staleTime: Infinity, gcTime: Infinity })
  return data ?? { kind: 'idle' }
}

/** Try now: used by the card's Try again, and by the automatic runs. */
export function useMarkNow() {
  const qc = useQueryClient()
  const checkIn = useCheckIn()
  const set = (s: AutoState) => qc.setQueryData(KEY, s)
  return async (auto: boolean): Promise<void> => {
    const at = new Date().toISOString()
    set({ kind: 'checking' })
    let pos: GeolocationPosition
    try {
      pos = await readPosition(!auto)
    } catch (e) {
      const code = (e as { code?: number }).code
      set(code === 1 ? { kind: 'denied', at } : { kind: 'unavailable', at })
      return
    }
    try {
      await checkIn.mutateAsync({ lat: pos.coords.latitude, lng: pos.coords.longitude, auto })
      set({ kind: 'marked', at })
      toast.success(`Marked present · ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`)
    } catch (e) {
      const message = (e as Error).message || 'We could not mark you.'
      set(message.startsWith("You're") ? { kind: 'outside', message, at } : { kind: 'failed', message, at })
    }
  }
}

/** Mounted once in the app shell. Renders nothing. */
export function AutoAttendance() {
  const { session } = useAuth()
  // The owner runs the studio; the absent sweep never marks them either.
  const tracked = !!session && session.role !== 'super_admin' && session.role !== 'platform_admin'
  const me = useAttendanceMe()
  const markNow = useMarkNow()
  const state = useAutoState()
  const busy = useRef(false)
  const due = tracked && needsMark(me.data)

  useEffect(() => {
    if (!due) return
    const run = () => {
      if (busy.current || document.visibilityState !== 'visible') return
      busy.current = true
      void markNow(true).finally(() => {
        busy.current = false
      })
    }
    // Once on open; a refused location stays refused until they act on it.
    if (state.kind === 'idle') run()
    const timer = window.setInterval(() => {
      if (state.kind !== 'denied') run()
    }, EVERY_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && state.kind !== 'denied') run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // markNow is rebuilt every render; the run is keyed on what matters.
  }, [due, state.kind])

  return null
}
