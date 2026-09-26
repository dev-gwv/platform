import { cn } from '@/shared/ui/cn'
import { useMyOverdueCount } from './api'
import { todayISO } from './board'

/**
 * The sidebar's count of my late tasks. Nothing when there are none: a zero
 * badge is noise. Polled once a minute, like the notification bell.
 */
export function TaskOverdueBadge({ collapsed }: { collapsed: boolean }) {
  const { data } = useMyOverdueCount(todayISO())
  const n = data?.count ?? 0
  if (n <= 0) return null
  const label = n > 99 ? '99+' : String(n)
  return (
    <span
      aria-label={`${n} overdue ${n === 1 ? 'task' : 'tasks'}`}
      title={`${n} overdue`}
      className={cn(
        'rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-4 text-destructive-foreground tabular-nums',
        collapsed ? 'absolute right-1 top-1' : 'ml-auto',
      )}
    >
      {label}
    </span>
  )
}
