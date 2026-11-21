import type { QueryClient } from '@tanstack/react-query'
import { trimToFirstPage } from '@/shared/api/reset-pages'

/**
 * After a task changed: every task read is asked for again, but a paged list
 * (the open tasks, a hundred at a time) only for its first page -- someone
 * who pressed Show more five times paid six requests on every save. The
 * board's columns are one request whatever was shown under them.
 */
export function refreshTasks(qc: QueryClient) {
  trimToFirstPage(qc, ['tasks', 'open'])
  return qc.invalidateQueries({ queryKey: ['tasks'] })
}
