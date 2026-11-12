import { History } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { TASK_WINDOW_DAYS, type useOlderDoneTasks } from './api'

/**
 * Under a list of finished work: the pages show the last 30 days' done tasks,
 * and this brings the older ones in, fifty at a time. A bordered button, so it
 * reads as one.
 */
export function ShowOlderDone({ older, className }: { older: ReturnType<typeof useOlderDoneTasks>; className?: string }) {
  if (!older.hasMore && older.rows.length === 0) {
    return <p className={className ?? 'mt-3 text-center text-xs text-muted-foreground'}>Nothing finished before the last {TASK_WINDOW_DAYS} days.</p>
  }
  if (!older.hasMore) return null
  return (
    <div className={className ?? 'mt-3 flex justify-center'}>
      <Button type="button" variant="outline" size="sm" disabled={older.loading} onClick={older.more}>
        <History /> {older.loading ? 'Loading…' : older.rows.length ? 'Show more older done tasks' : 'Show older done tasks'}
      </Button>
    </div>
  )
}
