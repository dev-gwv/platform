import type { ComponentType, ReactNode } from 'react'
import { Card, CardContent } from './card'
import { cn } from './cn'

/** A locked primitive — dashboard/summary tiles compose this. */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  className,
}: {
  label: string
  value: ReactNode
  icon?: ComponentType<{ className?: string }>
  hint?: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-xl font-semibold tracking-tight">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <span className={cn('rounded-md bg-primary/10 p-2 text-primary')}>
            <Icon className="size-5" />
          </span>
        )}
      </CardContent>
    </Card>
  )
}
