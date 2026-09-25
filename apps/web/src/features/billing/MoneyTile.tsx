import type { ComponentType, ReactNode } from 'react'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'

const TONES = {
  green: 'bg-tone-green-soft text-tone-green',
  amber: 'bg-tone-amber-soft text-tone-amber',
  blue: 'bg-tone-blue-soft text-tone-blue',
  violet: 'bg-tone-violet-soft text-tone-violet',
  rose: 'bg-tone-rose-soft text-tone-rose',
} as const

/**
 * The money tiles at the top of Billing: a coloured round icon, the figure
 * big and bold, and what it is underneath. Read across a desk, the colour
 * says which kind of money before the words do.
 */
export function MoneyTile({
  icon: Icon,
  tone,
  value,
  label,
  hint,
  onClick,
  active,
}: {
  icon: ComponentType<{ className?: string }>
  tone: keyof typeof TONES
  value: ReactNode
  label: string
  hint?: ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const body = (
    <CardContent className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
      <span className={cn('hidden size-11 shrink-0 items-center justify-center rounded-full sm:flex', TONES[tone])}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-lg font-bold tabular-nums leading-tight sm:text-2xl">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{label}</p>
        {hint && <p className="hidden text-xs text-muted-foreground sm:block">{hint}</p>}
      </div>
    </CardContent>
  )
  return (
    <Card className={cn('rounded-2xl', active && 'ring-2 ring-primary', onClick && 'transition-shadow hover:shadow-md')}>
      {onClick ? (
        <button type="button" onClick={onClick} className="w-full text-left">
          {body}
        </button>
      ) : (
        body
      )}
    </Card>
  )
}
