import { useEffect, useState } from 'react'
import { Camera, FolderOpen, Plus } from 'lucide-react'
import type { Deliverable } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { useConfirm } from '@/shared/ui/confirm'
import { useAddDeliverable, useDeleteDeliverable } from '@/features/projects/api'
import { DeliverableDialog } from '@/features/projects/DeliverableDialog'
import { DeliverableCard } from '@/features/projects/DeliverableCard'
import { DeliverableDrawer } from '@/features/projects/DeliverableDrawer'
import { DeliveryPipeline, type PipelineFilter } from '@/features/projects/DeliveryPipeline'
import { STAGE_LABEL, groupByShoot, isLate, stageOf, type ShootRef } from '@/features/projects/deliverable-stage'

/**
 * One tap adds the usual thing to an empty group. Anything else goes through
 * "+ Add", where any title can be typed.
 */
const SHOOT_SUGGESTIONS = ['Edited Photos', 'Teaser', 'Highlight Film', 'Reel / Short Video']
const PROJECT_SUGGESTIONS = ['Photo Album', 'Full Wedding Film', 'Raw Photos', 'Instagram Reels Pack']

const dateFmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

/** ?d=<id> opens one deliverable's panel -- where a notification lands. */
const wantedFromUrl = () => new URLSearchParams(window.location.search).get('d')

function setUrlDeliverable(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('d', id)
  else url.searchParams.delete('d')
  window.history.replaceState(window.history.state, '', url)
}

const matches = (d: Deliverable, f: PipelineFilter) =>
  !f || (f === 'late' ? isLate(d) : stageOf(d.status) === f)

/**
 * The project's delivery board.
 *
 * On top, the pipeline: how many things are at each stage, how far along the
 * whole is, what is due next and what is late -- each stage a filter. Below,
 * one card per deliverable under the shoot it comes from. Tap a card for its
 * panel: the brief, the link, and the notes and voice notes with the editor.
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
  const [filter, setFilter] = useState<PipelineFilter>(null)
  const [openId, setOpenId] = useState<string | null>(wantedFromUrl)
  const del = useDeleteDeliverable(projectId)
  const add = useAddDeliverable(projectId)
  const confirm = useConfirm()
  const groups = groupByShoot(deliverables, shoots)
  const open = deliverables.find((d) => d.id === openId) ?? null

  useEffect(() => setUrlDeliverable(openId), [openId])

  async function remove(d: Deliverable) {
    if (await confirm({ title: `Delete "${d.title}"?`, description: 'Its notes and voice notes go with it.', destructive: true, confirmLabel: 'Delete' })) {
      if (openId === d.id) setOpenId(null)
      del.mutate(d.id)
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {deliverables.length > 0 ? (
        <DeliveryPipeline deliverables={deliverables} filter={filter} onFilter={setFilter} />
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center">
          <p className="text-sm font-semibold">Nothing owed yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add what you promised the client — the album, the film, the reels — and track each one to delivery.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {filter ? (
            <>
              Showing <span className="font-semibold text-foreground">{filter === 'late' ? 'late' : STAGE_LABEL[filter]}</span> ·{' '}
              <button type="button" onClick={() => setFilter(null)} className="font-medium text-primary hover:underline">
                show all
              </button>
            </>
          ) : (
            'Grouped by the shoot each one comes from'
          )}
        </p>
        {canEdit && (
          <Button onClick={() => setDialog({})}>
            <Plus /> Add deliverable
          </Button>
        )}
      </div>

      {groups.map((g) => {
        const items = g.items.filter((d) => matches(d, filter))
        // With a filter on, a group with nothing matching simply steps aside.
        if (filter && items.length === 0) return null
        if (!g.shoot && g.items.length === 0 && deliverables.length > 0) return null
        return (
          <section key={g.shoot?.id ?? 'project'} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span className={g.shoot ? 'flex size-6 items-center justify-center rounded-md bg-tone-violet-soft text-tone-violet' : 'flex size-6 items-center justify-center rounded-md bg-tone-blue-soft text-tone-blue'}>
                  {g.shoot ? <Camera className="size-3.5" aria-hidden /> : <FolderOpen className="size-3.5" aria-hidden />}
                </span>
                {g.shoot ? g.shoot.name : 'Whole project'}
                {g.shoot?.shoot_date && <span className="text-xs font-normal text-muted-foreground">{dateFmt(g.shoot.shoot_date)}</span>}
                {g.items.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{g.items.length}</span>}
              </h3>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => setDialog({ shootId: g.shoot?.id ?? null })} aria-label={`Add deliverable to ${g.shoot?.name ?? 'whole project'}`}>
                  <Plus /> Add
                </Button>
              )}
            </div>
            {g.items.length === 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-border bg-card px-3 py-3 text-xs text-muted-foreground">
                <span className="mr-1">Nothing from this {g.shoot ? 'shoot' : 'project'} yet.</span>
                {canEdit &&
                  (g.shoot ? SHOOT_SUGGESTIONS : PROJECT_SUGGESTIONS).map((title) => (
                    <button
                      key={title}
                      type="button"
                      disabled={add.isPending}
                      onClick={() =>
                        add.mutate({
                          title,
                          list_key: 'primary',
                          start_rule: 'whole_project',
                          visibility_scope: 'client',
                          show_on_quotation: true,
                          is_additional_charge: false,
                          additional_charge_amount: 0,
                          shoot_id: g.shoot?.id ?? null,
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-tone-violet/30 bg-tone-violet-soft px-2.5 py-0.5 font-medium text-tone-violet hover:bg-tone-violet/15"
                    >
                      <Plus className="size-3" aria-hidden /> {title}
                    </button>
                  ))}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((d) => (
                  <DeliverableCard
                    key={d.id}
                    d={d}
                    canEdit={canEdit}
                    onOpen={() => setOpenId(d.id)}
                    onEdit={() => setDialog({ deliverable: d })}
                    onDelete={() => void remove(d)}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}

      <DeliverableDrawer
        deliverable={open}
        canEdit={canEdit}
        onClose={() => setOpenId(null)}
        onEdit={(d) => setDialog({ deliverable: d })}
        onDelete={(d) => void remove(d)}
      />

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
