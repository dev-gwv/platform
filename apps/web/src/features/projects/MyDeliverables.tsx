import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Film, MessageSquare, Mic, Upload } from 'lucide-react'
import type { Deliverable, MyDeliverable } from '@ipc/contracts'
import { Card, CardContent } from '@/shared/ui/card'
import { cn } from '@/shared/ui/cn'
import { useAccess } from '@/shared/auth/useAccess'
import { useAuth } from '@/shared/auth/AuthProvider'
import { useMyDeliverables } from '@/features/projects/api'
import { DueChip, KindTile, MoveToMenu, NextStageButton } from '@/features/projects/DeliverableCard'
import { SubmitWorkDialog } from '@/features/work/SubmitWorkDialog'
import { Button } from '@/shared/ui/button'
import { DeliverableDrawer } from '@/features/projects/DeliverableDrawer'
import { StageStepper, STAGE_STYLE } from '@/features/projects/StageStepper'
import { isLate, stageOf } from '@/features/projects/deliverable-stage'

/** An item on my list, in the shape the panel reads. I am its editor. */
function asDeliverable(d: MyDeliverable, me: { id: string | null; name: string | null }): Deliverable {
  return {
    id: d.id,
    project_id: d.project_id,
    title: d.title,
    description: d.description ?? null,
    list_key: 'primary',
    is_additional_charge: false,
    additional_charge_amount: 0,
    visibility_scope: d.visibility_scope,
    show_on_quotation: d.visibility_scope === 'client',
    estimated_date: d.estimated_date ?? null,
    start_rule: 'whole_project',
    status: d.status,
    shoot_name: d.shoot_name ?? null,
    assignee_id: me.id,
    assignee_name: me.name,
    delivery_link: d.delivery_link ?? null,
    custom_status_code: d.custom_status_code ?? null,
    notes_count: d.notes_count,
    voice_count: d.voice_count,
  }
}

/**
 * What the signed-in person is editing, soonest due first. Each one shows
 * where it stands and how many notes are waiting; tapping it opens the same
 * panel the project page has, so an editor can listen to a voice note, reply
 * with one, and say "sent to client" -- without editing the whole project.
 * Renders nothing for someone with no deliverables.
 */
export function MyDeliverables() {
  const { data } = useMyDeliverables()
  const { session } = useAuth()
  const canOpenProjects = useAccess().hasModule('projects')
  const [openId, setOpenId] = useState<string | null>(null)
  const [openAction, setOpenAction] = useState<'voice' | null>(null)
  if (!data?.length) return null
  const me = { id: session?.user_id ?? null, name: session?.display_name ?? null }
  const open = data.find((d) => d.id === openId)

  return (
    <Card className="mt-4">
      <CardContent className="p-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Film className="size-4 text-tone-violet" aria-hidden /> Your deliverables
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{data.length}</span>
        </p>
        <ul className="flex flex-col gap-2">
          {data.map((d) => {
            const stage = stageOf(d.status)
            return (
              <li
                key={d.id}
                className={cn(
                  'flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-l-4 border-border bg-card px-3 py-2.5 transition-shadow hover:shadow-md',
                  isLate(d) ? 'border-l-destructive' : STAGE_STYLE[stage].border,
                )}
                onClick={() => setOpenId(d.id)}
              >
                <KindTile title={d.title} status={d.status} />
                <div className="min-w-[12rem] flex-1">
                  <p className="truncate text-sm font-semibold">{d.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                    {/* An editor may not be able to open projects; then it is just a name. */}
                    {canOpenProjects ? (
                      <Link to="/projects/$id" params={{ id: d.project_id }} search={{ tab: 'deliverables' }} className="font-medium text-foreground hover:underline">
                        {d.project_name}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{d.project_name}</span>
                    )}
                    {d.shoot_name && <span>{d.shoot_name}</span>}
                    <DueChip d={d} />
                    {d.voice_count > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-tone-blue-soft px-2 py-0.5 font-medium text-tone-blue">
                        <Mic className="size-3" aria-hidden /> {d.voice_count}
                      </span>
                    )}
                    {d.notes_count - d.voice_count > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-medium">
                        <MessageSquare className="size-3" aria-hidden /> {d.notes_count - d.voice_count}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                    <MoveToMenu d={d} canEdit={false}>
                      <StageStepper status={d.status} code={d.custom_status_code} />
                    </MoveToMenu>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <SubmitWorkDialog
                    deliverableId={d.id}
                    projectId={d.project_id}
                    trigger={
                      <Button size="sm" variant="ghost">
                        <Upload /> Submit work
                      </Button>
                    }
                  />
                  <NextStageButton id={d.id} status={d.status} code={d.custom_status_code} link={d.delivery_link} canEdit={false} />
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
      <DeliverableDrawer
        deliverable={open ? asDeliverable(open, me) : null}
        canEdit={false}
        action={openAction}
        onClose={() => {
          setOpenId(null)
          setOpenAction(null)
        }}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />
    </Card>
  )
}
