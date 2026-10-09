import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Rocket, X } from 'lucide-react'
import { gettingStarted } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { useHints, useSetHint } from '@/features/team/hints-api'
import { showGettingStarted, startCountLine, startSteps } from './getting-started'

/**
 * Getting started: a new studio's first five things after setup. Each step
 * ticks itself from the data; the next one is amber with its one button. Goes
 * away at 5 of 5, after 60 days, or on Close (per person, through users.hints).
 */
/** Whether the card is up, so Home shows one onboarding card at a time. */
export function useGettingStartedShowing(): boolean {
  const { session } = useAuth()
  const q = useQuery({
    queryKey: ['settings', 'getting-started'],
    queryFn: () => callApi('/settings/getting-started', { responseSchema: gettingStarted }),
    enabled: !!session,
    staleTime: 30_000,
  })
  const hints = useHints()
  if (hints.isPending || q.isPending) return true
  return showGettingStarted(q.data, !!hints.data?.getting_started?.closed)
}

export function GettingStartedCard() {
  const { session } = useAuth()
  const q = useQuery({
    queryKey: ['settings', 'getting-started'],
    queryFn: () => callApi('/settings/getting-started', { responseSchema: gettingStarted }),
    enabled: !!session,
    staleTime: 30_000,
  })
  const hints = useHints()
  const setHint = useSetHint()
  const closed = !!hints.data?.getting_started?.closed
  if (hints.isPending || !showGettingStarted(q.data, closed)) return null

  const steps = startSteps(q.data!)
  const next = steps.find((s) => !s.done)
  const done = steps.filter((s) => s.done).length
  return (
    <Card className="mt-4 border-primary/30">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Rocket className="size-4" aria-hidden />
            </span>
            <div>
              <p className="font-semibold">Getting started</p>
              <p className="text-xs text-muted-foreground">{startCountLine(steps)}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close Getting started"
            onClick={() => setHint.mutate({ key: 'getting_started', value: { shown: 0, closed: true } })}
          >
            <X />
          </Button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ol className="mt-3 flex flex-col gap-1.5">
          {steps.map((s) => {
            const isNext = s === next
            return (
              <li
                key={s.key}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                  s.done && 'border-success/30 bg-success/10 text-muted-foreground',
                  isNext && 'border-dashed border-tone-amber bg-tone-amber-soft',
                  !s.done && !isNext && 'border-border',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border',
                    s.done ? 'border-success bg-success text-success-foreground' : 'border-input',
                  )}
                >
                  {s.done && <Check className="size-3" />}
                </span>
                <span className={cn('flex-1', s.done && 'line-through')}>{s.title}</span>
                {isNext && (
                  <Button asChild size="sm">
                    <Link to={s.to} search={s.search as never}>
                      {s.action} <ArrowRight />
                    </Link>
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
