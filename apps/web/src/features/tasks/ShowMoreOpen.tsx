import { ChevronDown } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { showingLine } from './open-pages'

/**
 * Under a page of open tasks: "Showing 100 of 1,158" and a bordered Show more
 * that brings the next hundred. Says nothing once every open task is here.
 */
export function ShowMoreOpen({
  shown,
  total,
  hasMore,
  loading,
  onMore,
}: {
  shown: number
  total: number
  hasMore: boolean
  loading: boolean
  onMore: () => void
}) {
  if (!hasMore) return null
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
      <span className="text-xs text-muted-foreground tabular-nums">{showingLine(shown, total)} open tasks</span>
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onMore}>
        <ChevronDown /> {loading ? 'Loading…' : 'Show more'}
      </Button>
    </div>
  )
}
