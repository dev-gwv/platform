import { cn } from './cn'
import { useIsMobile } from '../hooks/use-mobile'

/**
 * A placeholder shaped like the thing that is coming.
 *
 * A centred spinner tells you to wait but not what for, and the page jumps
 * when the content lands. Skeletons hold the layout still and read as "nearly
 * there" — which is why the wait feels shorter even when it isn't.
 */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn('ipc-skeleton block rounded-md bg-muted', className)} />
}

/** Rows shaped like a table body, with the same padding the real rows use. */
function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number
  columns?: number
  className?: string | undefined
}) {
  return (
    <div
      className={cn('overflow-hidden rounded-lg border border-border', className)}
      role="status"
      aria-label="Loading"
    >
      <div className="flex gap-4 border-b border-border bg-muted/50 px-4 py-2">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn('h-3.5', c === 0 ? 'flex-[2]' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Stacked cards — the mobile shape of most of these lists. */
export function SkeletonCards({ count = 3, className }: { count?: number; className?: string | undefined }) {
  return (
    <div className={cn('flex flex-col gap-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-border p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/** The tile row that sits above most tables. */
export function SkeletonTiles({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-4', className)}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-6 w-12" />
        </div>
      ))}
    </div>
  )
}

/**
 * The placeholder for a list that renders as a table on a wide screen and as
 * cards on a narrow one.
 *
 * The skeleton has to make the same choice the real content will, or it
 * promises a table and then delivers cards — which is the jump skeletons exist
 * to prevent.
 */
export function SkeletonList({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  const isMobile = useIsMobile()
  return isMobile ? (
    <SkeletonCards count={Math.min(rows, 4)} className={className} />
  ) : (
    <SkeletonTable rows={rows} columns={columns} className={className} />
  )
}
