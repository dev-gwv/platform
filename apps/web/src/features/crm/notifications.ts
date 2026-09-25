import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  notification,
  runGeneratorResponse,
  z,
  type NotificationGeneratorKey,
  type NotificationSeverity,
} from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'

const list = notification.array()

export interface NotificationFilters {
  unreadOnly?: boolean
  includeDismissed?: boolean
  severity?: NotificationSeverity | ''
  typePrefix?: string
  dateFrom?: string
  dateTo?: string
  /** Newest first, at most this many. The server's own default is fifty. */
  limit?: number
}

function toQuery(f: NotificationFilters): string {
  const p = new URLSearchParams()
  if (f.unreadOnly) p.set('unread_only', '1')
  if (f.includeDismissed) p.set('include_dismissed', '1')
  if (f.severity) p.set('severity', f.severity)
  if (f.typePrefix) p.set('type_prefix', f.typePrefix)
  if (f.dateFrom) p.set('date_from', new Date(f.dateFrom).toISOString())
  if (f.dateTo) p.set('date_to', new Date(f.dateTo).toISOString())
  if (f.limit) p.set('limit', String(f.limit))
  const s = p.toString()
  return s ? `?${s}` : ''
}

/**
 * The list, for the Alerts page and the bell's panel. The panel asks for the
 * latest ten only while it is open; the badge beside it never reads this —
 * it has its own count (below).
 *
 * Filters are part of the key, so the panel's ten and a filtered Alerts view
 * never overwrite each other's cache, and marking one read (which invalidates
 * everything under ['notifications']) refreshes whichever is on screen.
 */
export function useNotifications(filters: NotificationFilters = {}) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['notifications', filters],
    queryFn: () => callApi(`/notifications${toQuery(filters)}`, { responseSchema: list }),
    enabled: !!session,
    staleTime: 15_000,
  })
}

/**
 * Unread, counted in SQL.
 *
 * The bell used to count the rows it had: the list is capped at fifty, so a
 * studio with more unread alerts than that saw a badge that stopped counting
 * — and a badge is the one thing on the screen whose entire job is to be the
 * true number. `/notifications/unread-count` has existed alongside it,
 * calling unread_notifications_count(), and nothing called it.
 *
 * It also stops the header fetching fifty rows on every page just to show a
 * digit.
 *
 * Polled once a minute. The shell stays mounted across pages and window
 * focus does not refetch in this app, so without it a reminder that came due
 * mid-morning showed no badge until a reload. One count query a minute, and
 * only while the tab is in front (react-query pauses the poll behind it).
 */
export function useUnreadCount() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () =>
      callApi('/notifications/unread-count', {
        responseSchema: z.object({ unread_count: z.coerce.number().int() }),
      }),
    enabled: !!session,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/** Counts whatever list it is handed — still used where the rows are all there. */
export const unreadCount = (rows: { read_at?: string | null }[] | undefined) =>
  (rows ?? []).filter((n) => !n.read_at).length

/**
 * Generic in both directions: the argument so `read-all` can take none, and the
 * result so a generator run keeps its typed response instead of `unknown`.
 */
function useNotificationMutation<TArg, TResult>(fn: (arg: TArg) => Promise<TResult>) {
  const qc = useQueryClient()
  return useMutation<TResult, Error, TArg>({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export const useMarkNotificationRead = () =>
  useNotificationMutation((id: string) =>
    callApi(`/notifications/${id}/read`, { method: 'POST', responseSchema: z.any() }),
  )

/** Dismiss hides it without deleting it — "include dismissed" brings it back. */
export const useDismissNotification = () =>
  useNotificationMutation((id: string) =>
    callApi(`/notifications/${id}/dismiss`, { method: 'POST', responseSchema: z.any() }),
  )

export const useMarkAllNotificationsRead = () =>
  useNotificationMutation<void, unknown>(() =>
    callApi('/notifications/read-all', { method: 'POST', responseSchema: z.any() }),
  )

export interface RunGeneratorArgs {
  key: NotificationGeneratorKey
  dry_run: boolean
  date_from?: string | undefined
  date_to?: string | undefined
}

export const useRunGenerator = () =>
  useNotificationMutation((args: RunGeneratorArgs) =>
    callApi('/notifications/generators/run', {
      method: 'POST',
      body: args,
      responseSchema: runGeneratorResponse,
    }),
  )
