import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { subscriptionStatus } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { cn } from '@/shared/ui/cn'

/**
 * "Free trial · 23 days left" in the top bar, for the owner, so the end of
 * the 30 days (0210) is never a surprise. Amber in the last week, red once it
 * has passed; a paid plan shows nothing until its last fortnight.
 */
export function TrialChip() {
  const { session } = useAuth()
  const owner = !!session?.is_owner
  const q = useQuery({
    queryKey: ['subscription', 'status'],
    queryFn: () => callApi('/subscription/status', { responseSchema: subscriptionStatus }),
    enabled: owner,
    staleTime: 10 * 60_000,
  })
  const s = q.data
  if (!owner || !s || s.days_left == null) return null
  const trial = s.plan_source === 'trial'
  if (!trial && s.days_left > 14) return null
  const left = s.days_left
  const text =
    left < 0 ? (trial ? 'Trial ended' : 'Plan ended') : `${trial ? 'Free trial' : 'Plan'} · ${left} day${left === 1 ? '' : 's'} left`
  return (
    <Link
      to="/settings/subscription"
      className={cn(
        'hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold sm:inline-flex',
        left < 0
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : left <= 7
            ? 'border-tone-amber/50 bg-tone-amber-soft text-tone-amber'
            : 'border-tone-blue/30 bg-tone-blue-soft text-tone-blue',
      )}
      title="See your plan and when it ends"
    >
      <Clock className="size-3.5" /> {text}
    </Link>
  )
}
