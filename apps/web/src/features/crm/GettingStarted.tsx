import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Rocket } from 'lucide-react'
import { leadSourceRow, type CrmLead } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { callApi } from '@/shared/api/client'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useDistribution, useTemplates } from './api'
import { allDone, remaining, startSteps } from './getting-started'

const sources = leadSourceRow.array()

/**
 * The four or five things that make leads arrive and answer themselves.
 *
 * It disappears on its own once they are done -- every step is read from data
 * the page already has, never from a "dismissed" flag, so it cannot sit there
 * telling a studio to do something it did last month. Collapsible for the
 * week in between, and the count on the pill is the honest one.
 */
export function GettingStarted({ leads }: { leads: readonly CrmLead[] }) {
  const { session } = useAuth()
  const [open, setOpen] = useState(true)
  const templates = useTemplates()
  const rota = useDistribution()
  const srcs = useQuery({
    queryKey: ['crm', 'sources'],
    queryFn: () => callApi('/crm/sources', { responseSchema: sources }),
    enabled: !!session,
    staleTime: 60_000,
  })

  // Until the three lists have answered, every step would read as "not done"
  // and the card would flash a full checklist at a studio that finished weeks
  // ago. Better to show nothing for a moment.
  if (templates.isLoading || rota.isLoading || srcs.isLoading) return null

  const steps = startSteps({
    leads,
    sourceCount: (srcs.data ?? []).length,
    templateCount: (templates.data ?? []).length,
    rotaCount: (rota.data ?? []).length,
  })
  if (allDone(steps)) return null

  const left = remaining(steps)

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Rocket className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold tracking-tight text-primary">Get leads running</p>
            <p className="text-sm text-muted-foreground">
              Set these up once and enquiries arrive, get answered and come back to you on the day you promised.
            </p>
          </div>
          <StatusBadge tone="info" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {left} {left === 1 ? 'item' : 'items'} remaining
          </StatusBadge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Hide the checklist' : 'Show the checklist'}
          >
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        </div>

        {open && (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {steps.map((s) => (
              <li key={s.key}>
                <Link
                  to={s.to}
                  search={(s.search ?? {}) as never}
                  className={cn(
                    'flex h-full gap-3 rounded-lg border p-3 transition-colors',
                    s.done
                      ? 'border-border bg-card/60'
                      : 'border-border bg-card hover:border-primary/40 hover:bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold',
                      s.done ? 'border-success bg-success text-success-foreground' : 'border-input',
                    )}
                    aria-hidden
                  >
                    {s.done ? '✓' : ''}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block text-[11px] font-semibold uppercase tracking-[0.06em]',
                        s.done ? 'text-muted-foreground line-through' : 'text-foreground',
                      )}
                    >
                      {s.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{s.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
