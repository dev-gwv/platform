import type { ReactNode } from 'react'
import { cn } from '../ui/cn'
import { WatchHow } from '@/features/help/WatchHow'

/** Locked primitive — every page's title/actions bar. */
export function PageHeader({
  title,
  description,
  actions,
  className,
  watch = true,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  /** False where the page already shows its how-to video, so there is one link. */
  watch?: boolean
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 pb-3', className)}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {watch && <WatchHow />}
        {actions}
      </div>
    </div>
  )
}
