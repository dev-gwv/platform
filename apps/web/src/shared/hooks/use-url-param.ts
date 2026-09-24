import { useCallback, useState } from 'react'

/**
 * A piece of page state kept in the address bar, so a filtered list can be
 * linked to ("this project's invoices"), refreshed, and come back on Back.
 * The default value is left out of the address to keep links short.
 */
export function useUrlParam(key: string, fallback = ''): [string, (value: string) => void] {
  const [value, setValue] = useState(() => new URLSearchParams(window.location.search).get(key) ?? fallback)
  const set = useCallback(
    (next: string) => {
      setValue(next)
      const url = new URL(window.location.href)
      if (!next || next === fallback) url.searchParams.delete(key)
      else url.searchParams.set(key, next)
      window.history.replaceState(window.history.state, '', url)
    },
    [key, fallback],
  )
  return [value, set]
}
