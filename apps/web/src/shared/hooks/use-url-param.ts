import { useCallback } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'

/** A value from a search string; the router may have parsed `?page=2` into a number, so it is read from the raw string. */
export function readParam(searchStr: string, key: string, fallback = ''): string {
  return new URLSearchParams(searchStr).get(key) ?? fallback
}

/** The next search object: the default value is left out of the address to keep links short. */
export function nextSearch(prev: Record<string, unknown>, key: string, next: string, fallback = ''): Record<string, unknown> {
  const out = { ...prev }
  if (!next || next === fallback) delete out[key]
  else out[key] = next
  return out
}

/**
 * A piece of page state kept in the address bar, so a filtered list can be
 * linked to ("this project's invoices"), refreshed, and come back on Back.
 *
 * It reads the router's location, not a copy taken when the page first drew:
 * a link to the same page with a different `?tab=` (a notification, the due
 * chip, a journey button) used to change the address and nothing on screen
 * until a reload.
 */
export function useUrlParam(key: string, fallback = ''): [string, (value: string) => void] {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  const navigate = useNavigate()
  const value = readParam(searchStr, key, fallback)
  const set = useCallback(
    (next: string) => {
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => nextSearch(prev, key, next, fallback),
        replace: true,
      } as never)
    },
    [key, fallback, navigate],
  )
  return [value, set]
}
