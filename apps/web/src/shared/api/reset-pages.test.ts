import { describe, expect, it } from 'vitest'
import { InfiniteQueryObserver, QueryClient, type InfiniteData } from '@tanstack/react-query'
import { firstPageOnly, resetToFirstPage, trimToFirstPage } from './reset-pages'

type Page = { n: number }

/** A paged query on screen with three pages loaded, and a count of the requests it makes. */
async function threePages(qc: QueryClient, key: unknown[]) {
  const seen = { calls: 0 }
  const obs = new InfiniteQueryObserver(qc, {
    queryKey: key,
    queryFn: async ({ pageParam }: { pageParam: number }): Promise<Page> => {
      seen.calls++
      return { n: pageParam }
    },
    initialPageParam: 0,
    getNextPageParam: (last: Page) => last.n + 1,
  })
  const stop = obs.subscribe(() => {})
  await obs.refetch()
  await obs.fetchNextPage()
  await obs.fetchNextPage()
  expect(qc.getQueryData<InfiniteData<Page>>(key)!.pages).toHaveLength(3)
  seen.calls = 0
  return { seen, stop }
}

describe('reloads after a change are capped at one page', () => {
  it('firstPageOnly cuts infinite data and leaves everything else alone', () => {
    const data = { pages: [1, 2, 3], pageParams: [null, 'a', 'b'] }
    expect(firstPageOnly(data)).toEqual({ pages: [1], pageParams: [null] })
    const one = { pages: [1], pageParams: [null] }
    expect(firstPageOnly(one)).toBe(one)
    const plain = { columns: [] }
    expect(firstPageOnly(plain)).toBe(plain)
    expect(firstPageOnly(undefined)).toBeUndefined()
    expect(firstPageOnly([1, 2])).toEqual([1, 2])
  })

  it('a plain invalidation refetches every page, one after another', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { seen, stop } = await threePages(qc, ['tasks', 'open', 'x'])
    await qc.invalidateQueries({ queryKey: ['tasks', 'open'] })
    expect(seen.calls).toBe(3)
    stop()
  })

  it('resetToFirstPage asks for the first page only', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { seen, stop } = await threePages(qc, ['tasks', 'open', 'x'])
    await resetToFirstPage(qc, ['tasks', 'open'])
    expect(seen.calls).toBe(1)
    expect(qc.getQueryData<InfiniteData<Page>>(['tasks', 'open', 'x'])!.pages).toEqual([{ n: 0 }])
    stop()
  })

  it('trimToFirstPage touches only the keys under it', () => {
    const qc = new QueryClient()
    qc.setQueryData(['crm', 'leads', 'card', 'pages', 'a'], { pages: [1, 2], pageParams: [null, 'c'] })
    qc.setQueryData(['crm', 'leads', 'full'], [1, 2])
    qc.setQueryData(['tasks', 'open', 'b'], { pages: [1, 2], pageParams: [null, 'c'] })
    trimToFirstPage(qc, ['crm', 'leads', 'card', 'pages'])
    expect(qc.getQueryData(['crm', 'leads', 'card', 'pages', 'a'])).toEqual({ pages: [1], pageParams: [null] })
    expect(qc.getQueryData(['crm', 'leads', 'full'])).toEqual([1, 2])
    expect(qc.getQueryData(['tasks', 'open', 'b'])).toEqual({ pages: [1, 2], pageParams: [null, 'c'] })
  })
})
