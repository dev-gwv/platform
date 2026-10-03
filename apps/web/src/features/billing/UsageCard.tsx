import { useQuery } from '@tanstack/react-query'
import { planUsage } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { usageBars } from './usage'

export function usePlanUsage(enabled = true) {
  return useQuery({
    queryKey: ['subscription', 'usage'],
    queryFn: () => callApi('/subscription/usage', { responseSchema: planUsage }),
    enabled,
    staleTime: 5 * 60_000,
  })
}

const BAR = { calm: 'bg-tone-green', near: 'bg-tone-amber', full: 'bg-destructive' } as const

/**
 * What the plan allows and what is used, one bar each (0241). Nothing at all
 * on a trial or an unlimited plan -- there is nothing to watch.
 */
export function UsageCard({ className }: { className?: string }) {
  const usage = usePlanUsage()
  const bars = usageBars(usage.data)
  if (bars.length === 0) return null
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{usage.data?.plan_name} plan</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {bars.map((b) => (
            <li key={b.key} className="flex flex-col gap-1">
              <span className={cn('text-sm', b.tone === 'full' && 'font-medium text-destructive')}>{b.line}</span>
              <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className={cn('block h-full rounded-full', BAR[b.tone])} style={{ width: `${Math.max(4, b.share * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
