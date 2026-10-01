import { useCallback, useState } from 'react'
import { useAuth } from '@/shared/auth/AuthProvider'

/**
 * The travel/rest gap a studio keeps between two bookings of the same
 * person: a shoot that ends at 3 PM does not put them on another at 3 PM.
 * A studio preference kept in this browser (like `data-defaults`), one
 * source of truth for both assign dialogs; never part of a form draft.
 */
export const GAP_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 90, label: '1½ h' },
  { value: 120, label: '2 h' },
]
export const DEFAULT_GAP_MIN = 60

const keyFor = (company: string | undefined) => `booking-gap:${company ?? 'none'}`

export function readGap(company: string | undefined): number {
  try {
    const raw = localStorage.getItem(keyFor(company))
    const n = raw == null ? NaN : Number(raw)
    return GAP_OPTIONS.some((o) => o.value === n) ? n : DEFAULT_GAP_MIN
  } catch {
    return DEFAULT_GAP_MIN
  }
}

export function writeGap(company: string | undefined, minutes: number) {
  try {
    localStorage.setItem(keyFor(company), String(minutes))
  } catch {
    // Private mode or a full store: the default comes back next time.
  }
}

export function useBookingGap(): [number, (minutes: number) => void] {
  const { session } = useAuth()
  const company = session?.company_id
  const [gap, setGapState] = useState(() => readGap(company))
  const setGap = useCallback(
    (minutes: number) => {
      setGapState(minutes)
      writeGap(company, minutes)
    },
    [company],
  )
  return [gap, setGap]
}
