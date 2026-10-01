import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Send } from 'lucide-react'
import { shootListItem, type ProjectDetail } from '@ipc/contracts'
import { callApi } from '@/shared/api/client'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { useSlots } from '@/features/allocation/api'
import { isLive, requirementFill, shootProgress } from '@/features/shoots/assign'
import { useProjectBilling } from './api'
import { journey, type JourneyKey } from './journey'

const shootsList = shootListItem.array()

/**
 * One line under the project's money: Quotation · Invoice · Team · Deliver,
 * ticked as they happen, the next one named with a single button. The owner
 * asked for the studio to be taken from the quotation to the invoice to the
 * team booking; this is the thread that does it, on every project page, and
 * it goes away once the work is delivered.
 */
export function ProjectJourney({
  project,
  onGo,
  onSkipToTeam,
  here,
  onSend,
  className,
}: {
  project: ProjectDetail
  onGo: (key: JourneyKey) => void
  /** Offered while the invoice is next: some studios book the team first. */
  onSkipToTeam?: (() => void) | undefined
  /**
   * The page this bar sits on. On the quotation page, while the quotation is
   * the next step, the bar asks "happy with it?" and moves straight on to the
   * invoice -- sending the link is on offer, not in the way.
   */
  here?: JourneyKey | undefined
  onSend?: (() => void) | undefined
  className?: string
}) {
  const access = useAccess()
  const canBill = access.hasModule('billing')
  const billing = useProjectBilling(project.id)
  // Same key the Shoots tab uses, so this shares its cache.
  const shoots = useQuery({
    queryKey: ['shoots', 'project', project.id],
    queryFn: () => callApi(`/shoots?project_id=${project.id}`, { responseSchema: shootsList }),
    staleTime: 15_000,
  })
  const slots = useSlots()

  if (shoots.isLoading || billing.isLoading || slots.isLoading) return null

  let seatsNeeded = 0
  let seatsFilled = 0
  for (const s of (shoots.data ?? []).filter((x) => x.status !== 'cancelled')) {
    const p = shootProgress(requirementFill(s, (slots.data ?? []).filter((b) => b.shoot_id === s.id && isLive(b))))
    seatsNeeded += p.required
    seatsFilled += p.assigned
  }
  const work = project.deliverables.filter((d) => d.status !== 'cancelled')
  const invoices = billing.data?.invoices ?? null

  const { steps, next } = journey({
    quotationSent: !!project.quotation_issued_at || !!project.quotation_accepted_at,
    invoiced: canBill && invoices ? invoices.some((i) => i.status !== 'cancelled') : null,
    shoots: (shoots.data ?? []).filter((x) => x.status !== 'cancelled').length,
    seatsNeeded,
    seatsFilled,
    deliverables: work.length,
    delivered: work.filter((d) => d.status === 'completed').length,
  })
  if (!next) return null
  const onThisPage = here !== undefined && next.key === here
  // On the quotation, "next" is the invoice: the step after the one in view.
  const after = onThisPage && here === 'quotation' ? steps.find((s) => s.key === 'invoice') : undefined

  return (
    <div
      className={cn(
        'no-print flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4',
        className,
      )}
    >
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm" aria-label="Steps for this project">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground/60" aria-hidden>·</span>}
            <span
              className={cn(
                'inline-flex items-center gap-1',
                s.done ? 'text-success' : s.key === next.key ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
              aria-current={s.key === next.key ? 'step' : undefined}
            >
              {s.done && <Check className="size-3.5" aria-hidden />}
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {onThisPage ? 'Happy with the quotation? Create the invoice next.' : next.hint}
      </p>
      {onThisPage ? (
        <div className="flex items-center gap-2">
          {onSend && (
            <Button size="sm" variant="outline" onClick={onSend}>
              <Send /> Send to client
            </Button>
          )}
          {after ? (
            <Button size="sm" className="ipc-nudge" onClick={() => onGo('invoice')}>
              Create the invoice <ArrowRight />
            </Button>
          ) : (
            // No billing for this person: the team is the step after.
            <Button size="sm" className="ipc-nudge" onClick={() => onGo('team')}>
              Book the team <ArrowRight />
            </Button>
          )}
        </div>
      ) : (
      <div className="flex items-center gap-2">
        {next.key === 'invoice' && onSkipToTeam && (
          <button type="button" onClick={onSkipToTeam} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
            Skip to team booking
          </button>
        )}
        <Button size="sm" onClick={() => onGo(next.key)}>
          {next.action} <ArrowRight />
        </Button>
      </div>
      )}
    </div>
  )
}
