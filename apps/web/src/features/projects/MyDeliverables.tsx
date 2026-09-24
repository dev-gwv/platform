import { Link } from '@tanstack/react-router'
import { ExternalLink, Film } from 'lucide-react'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusBadge } from '@/shared/ui/status-badge'
import { useMyDeliverables } from '@/features/projects/api'
import { DueChip, NextStageButton } from '@/features/projects/DeliverableRow'
import { STAGE_LABEL, STAGE_TONE, stageOf } from '@/features/projects/deliverable-stage'

/**
 * What the signed-in person is editing, soonest due first -- with the same
 * one button the project page has, so an editor can say "sent to client"
 * and leave the link without needing to edit the whole project.
 * Renders nothing for someone with no deliverables.
 */
export function MyDeliverables() {
  const { data } = useMyDeliverables()
  if (!data?.length) return null
  return (
    <Card className="mt-4">
      <CardContent className="p-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Film className="size-4 text-tone-violet" aria-hidden /> Your deliverables
          <span className="text-xs font-normal text-muted-foreground">{data.length}</span>
        </p>
        <ul className="flex flex-col gap-1.5">
          {data.map((d) => {
            const stage = stageOf(d.status)
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="min-w-[12rem] flex-1">
                  <p className="truncate text-sm font-semibold">{d.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <Link
                      to="/projects/$id"
                      params={{ id: d.project_id }}
                      search={{ tab: 'deliverables' }}
                      className="font-medium text-foreground hover:underline"
                    >
                      {d.project_name}
                    </Link>
                    {d.shoot_name && <span>{d.shoot_name}</span>}
                    <DueChip d={d} />
                    {d.delivery_link && (
                      <a href={d.delivery_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        <ExternalLink className="size-3.5" aria-hidden /> Link
                      </a>
                    )}
                  </div>
                </div>
                <StatusBadge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</StatusBadge>
                <NextStageButton id={d.id} status={d.status} link={d.delivery_link} />
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
