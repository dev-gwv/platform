import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { subscriptionStatus } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAccess } from '@/shared/auth/useAccess'
import { cn } from '@/shared/ui/cn'
import { planLine } from './plan-line'

/**
 * The studio's plan, pinned at the foot of the sidebar: which plan, how long
 * is left, and an Upgrade button. The owner: the "Upgrade your plan" option
 * "should come on the left so that they can see", not as the last of sixteen
 * settings tabs. Amber in the last week, red once it has run out.
 */
export function PlanCard({ collapsed }: { collapsed: boolean }) {
  const access = useAccess()
  const allowed = access.hasModule('settings_subscription')
  const q = useQuery({
    queryKey: ['subscription', 'status'],
    queryFn: () => callApi('/subscription/status', { responseSchema: subscriptionStatus }),
    enabled: allowed,
    staleTime: 10 * 60_000,
  })
  if (!allowed) return null
  const s = q.data
  const trial = s?.plan_source === 'trial'
  const left = s?.days_left ?? null
  const ended = left != null && left < 0
  const soon = left != null && left >= 0 && left <= 7
  const title = !s ? 'Your plan' : trial ? 'Free trial' : (s.plan_name ?? 'Your plan')
  const line = planLine(left, s?.access_until)
  const cta = trial || ended || !s?.plan_name ? 'Upgrade' : 'Manage'

  if (collapsed) {
    return (
      <Link
        to="/settings/subscription"
        title={`${title} \u00b7 ${line}`}
        className="relative mx-auto flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <Sparkles className="size-4" aria-hidden />
        <span className="sr-only">{title}</span>
        {(ended || soon) && (
          <span
            className={cn(
              'absolute right-2 top-2 size-2 rounded-full',
              ended ? 'bg-destructive' : 'bg-tone-amber',
            )}
          />
        )}
      </Link>
    )
  }

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        ended
          ? 'border-destructive/40 bg-destructive/10'
          : soon
            ? 'border-tone-amber/50 bg-tone-amber-soft'
            : 'border-tone-blue/30 bg-tone-blue-soft',
      )}
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-tone-amber" aria-hidden /> {title}
      </p>
      <p className={cn('mt-0.5 text-xs', ended ? 'text-destructive' : 'text-muted-foreground')}>
        {line}
      </p>
      <Link
        to="/settings/subscription"
        className="mt-2 flex h-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {cta}
      </Link>
      {/* The other door: an IPC Diamond member proves it and gets 30 days and member prices (0214). */}
      {s?.member_tier === 'outsider' && trial && (
        <Link
          to="/settings/subscription"
          hash="diamond"
          className="mt-1.5 block text-center text-xs font-medium text-tone-violet hover:underline"
        >
          IPC Diamond member?
        </Link>
      )}
    </div>
  )
}
