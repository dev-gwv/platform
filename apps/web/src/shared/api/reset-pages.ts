import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Cap what reloads after a change (speed audit, 21 Nov). An invalidated
 * infinite query refetches every page it holds, one after another: someone
 * who pressed Show more five times paid six requests on every save. Cutting
 * the cached pages back to the first before invalidating makes it one; the
 * rows further down come back when Show more is pressed again.
 */

/** Infinite data cut to its first page; anything else comes back as it was. */
export function firstPageOnly<T>(data: T): T {
  if (!data || typeof data !== 'object') return data
  const d = data as unknown as Partial<InfiniteData<unknown, unknown>>
  if (!Array.isArray(d.pages) || !Array.isArray(d.pageParams)) return data
  if (d.pages.length <= 1) return data
  return { ...d, pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) } as T
}

/** Cut every cached paged query under `queryKey` back to its first page, without asking again. */
export function trimToFirstPage(qc: QueryClient, queryKey: QueryKey) {
  for (const [key, data] of qc.getQueriesData<unknown>({ queryKey })) {
    const next = firstPageOnly(data)
    if (next !== data) qc.setQueryData(key, next)
  }
}

/** Trim the paged queries under `queryKey` to their first page, then invalidate them: one request each. */
export function resetToFirstPage(qc: QueryClient, queryKey: QueryKey) {
  trimToFirstPage(qc, queryKey)
  return qc.invalidateQueries({ queryKey })
}
