import type { QueryClient } from '@tanstack/react-query'

/**
 * The app's one query cache, for code that runs outside React -- a route's
 * loader that starts a page's data on hover, alongside its file (speed audit,
 * 11 Nov). main.tsx sets it before the router renders.
 */
let client: QueryClient | null = null

export const setQueryClient = (c: QueryClient) => {
  client = c
}
export const getQueryClient = () => client
