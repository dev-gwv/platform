import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Film } from 'lucide-react'
import type { StepKey } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { useMyDeliverables } from './api'
import { DueChip, KindTile } from './DeliverableCard'
import { StageStepper } from './StageStepper'
import { daysToDue, isLate, stageOf } from './deliverable-stage'
import { STEP_LABEL, STEP_TONE, TONE_CLASSES, namedStage, toneOf } from './stages'
import { useDeliverableStages } from './stages-api'

const OPEN_STEPS: StepKey[] = ['pending', 'in_progress', 'review']

/**
 * A team member's deliverables, on their dashboard: how many are waiting,
 * being edited and in review -- with the studio's own stage names inside
 * each -- what is late, and the next three due. Tapping goes to My Work,
 * where each one opens with its notes and voice notes.
 */
export function MyDeliveryStrip() {
  const { data } = useMyDeliverables()
  const stages = useDeliverableStages()
  const mine = data ?? []
  if (!mine.length) return null

  const late = mine.filter((d) => isLate(d)).length
  const soonest = [...mine]
    .sort((a, b) => (daysToDue(a) ?? 9999) - (daysToDue(b) ?? 9999))
    .slice(0, 3)

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Film className="size-4 text-tone-violet" aria-hidden /> Your deliverables
            {late > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                <AlertTriangle className="size-3" aria-hidden /> {late} late
              </span>
            )}
          </p>
          <Link to="/my-work" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Open My Work <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {OPEN_STEPS.map((step) => {
            const here = mine.filter((d) => stageOf(d.status) === step)
            const tone = TONE_CLASSES[STEP_TONE[step]]
            const named = new Map<string, { label: string; color: string | null | undefined; n: number }>()
            for (const d of here) {
              const s = namedStage(d, stages)
              if (!s) continue
              const at = named.get(s.code) ?? { label: s.label, color: s.color, n: 0 }
              at.n += 1
              named.set(s.code, at)
            }
            return (
              <div key={step} className={cn('relative overflow-hidden rounded-lg border border-border px-3 py-2', here.length === 0 && 'opacity-60')}>
                <span className={cn('absolute inset-x-0 top-0 h-1', tone.solid)} aria-hidden />
                <p className="mt-1 text-2xl font-semibold tabular-nums leading-none">{here.length}</p>
                <p className={cn('mt-1 text-xs font-medium', tone.text)}>{STEP_LABEL[step]}</p>
                {named.size > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {[...named.values()].map((b) => {
                      const t = TONE_CLASSES[toneOf(b.color)]
                      return (
                        <span key={b.label} className={cn('rounded-full px-1.5 py-px text-[10px] font-semibold', t.soft, t.text)}>
                          {b.n} {b.label}
                        </span>
                      )
                    })}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <ul className="mt-3 flex flex-col divide-y divide-border">
          {soonest.map((d) => (
            <li key={d.id}>
              <Link to="/my-work" className="flex items-center gap-3 py-2 hover:bg-muted/40">
                <KindTile title={d.title} status={d.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{d.project_name}</span>
                </span>
                <span className="hidden sm:block">
                  <StageStepper status={d.status} code={d.custom_status_code} />
                </span>
                <DueChip d={d} />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
