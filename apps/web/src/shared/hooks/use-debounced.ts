import { useEffect, useState } from 'react'

/** `value`, once it has held still for `ms`: a search box that asks the server waits for a pause in typing. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return settled
}
