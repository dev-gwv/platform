import { useState } from 'react'
import { Camera, FolderOpen, Plus } from 'lucide-react'
import type { Deliverable } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { useDeleteDeliverable } from '@/features/projects/api'
import { DeliverableDialog } from '@/features/projects/DeliverableDialog'
import { DeliverableRow } from '@/features/projects/DeliverableRow'
import { deliverableCounts, groupByShoot, type ShootRef } from '@/features/projects/deliverable-stage'

const dateFmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * Everything the project owes, under the shoot it comes from.
 *
 * One list, not two views: the edit that turns into the wedding film sits
 * under the wedding, the album under the whole project. Client or team-only
 * is a small tag on the row rather than a separate list, so moving between
 * them never makes a row jump away.
 */
export function DeliverablesTab({
  projectId,
  deliverables,
  shoots,
  canEdit,
}: {
  projectId: string
  deliverables: readonly Deliverable[]
  shoots: readonly ShootRef[]
  canEdit: boolean
}) {
  const [dialog, setDialog] = useState<{ deliverable?: Deliverable; shootId?: string | null } | null>(null)
  const del = useDeleteDeliverable(projectId)
  const confirm = useConfirm()
  const counts = deliverableCounts(deliverables)
  const groups = groupByShoot(deliverables, shoots)

  async function remove(d: Deliverable) {
    if (await confirm({ title: `Delete "${d.title}"?`, destructive: true, confirmLabel: 'Delete' })) del.mutate(d.id)
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-semibold">
            Delivered {counts.delivered} of {counts.total}
          </span>
          {counts.late > 0 && <span className="ml-2 font-medium text-destructive">· {counts.late} late</span>}
        </p>
        {canEdit && (
          <Button onClick={() => setDialog({})}>
            <Plus /> Add deliverable
          </Button>
        )}
      </div>

      {groups.map((g) => {
        if (!g.shoot && g.items.length === 0 && deliverables.length > 0) return null
        return (
          <Card key={g.shoot?.id ?? 'project'}>
            <CardContent className="p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {g.shoot ? <Camera className="size-4 text-tone-violet" aria-hidden /> : <FolderOpen className="size-4 text-tone-blue" aria-hidden />}
                  {g.shoot ? g.shoot.name : 'Whole project'}
                  {g.shoot?.shoot_date && (
                    <span className="text-xs font-normal text-muted-foreground">{dateFmt(g.shoot.shoot_date)}</span>
                  )}
                </p>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDialog({ shootId: g.shoot?.id ?? null })}
                    aria-label={`Add deliverable to ${g.shoot?.name ?? 'whole project'}`}
                  >
                    <Plus /> Add
                  </Button>
                )}
              </div>
              {g.items.length === 0 ? (
                <p className={cn('rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground')}>
                  Nothing from this {g.shoot ? 'shoot' : 'project'} yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {g.items.map((d) => (
                    <DeliverableRow
                      key={d.id}
                      d={d}
                      canEdit={canEdit}
                      onEdit={() => setDialog({ deliverable: d })}
                      onDelete={() => void remove(d)}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )
      })}

      {dialog && (
        <DeliverableDialog
          key={dialog.deliverable?.id ?? `new-${dialog.shootId ?? ''}`}
          projectId={projectId}
          shoots={shoots}
          deliverable={dialog.deliverable}
          defaultShootId={dialog.shootId}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
