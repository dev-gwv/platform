import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { toast } from 'sonner'
import type { BoardDeliverable, DeliverableStage } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogFooter } from '@/shared/ui/dialog'
import { cn } from '@/shared/ui/cn'
import { TONE_CLASSES, wantsLinkAt } from '@/features/projects/stages'
import { todayIso } from '@/features/projects/deliverable-stage'
import { BoardCard, CardFace } from './BoardCard'
import { laneOf, lanesFor, sortInLane, type Lane } from './board-model'
import { useBoardMove } from './api'

/** What to say in a lane with nothing in it. */
function emptyLine(lane: Lane): string {
  if (lane.code === 'changes_requested') return 'Nothing sent back'
  switch (lane.status) {
    case 'pending':
      return 'Nothing waiting to start'
    case 'in_progress':
      return lane.code ? 'Nothing here' : 'No one is editing right now'
    case 'review':
      return 'Nothing waiting here'
    case 'completed':
      return 'Nothing delivered this fortnight'
  }
}

/** Pointer first (precise on a wide board), rectangles as a fallback for touch. */
export const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : rectIntersection(args)
}

export function useBoardSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // A press-and-hold on a phone, so a swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )
}

interface ViewProps {
  items: BoardDeliverable[]
  stages: readonly DeliverableStage[]
  canEdit: boolean
  me: string | null
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  onOpen: (id: string) => void
}

/**
 * The studio's stages as lanes, left to right, with every deliverable in
 * flight. Drag a card to move it; lanes where a link goes to the client ask
 * for it on the way in.
 */
export function StagesView({ items, stages, canEdit, me, selected, onToggle, onOpen }: ViewProps) {
  const lanes = useMemo(() => lanesFor(stages), [stages])
  const today = todayIso()
  const byLane = useMemo(() => {
    const m = new Map<string, BoardDeliverable[]>(lanes.map((l) => [l.key, []]))
    for (const d of items) {
      const lane = laneOf(d, lanes)
      if (lane) m.get(lane.key)!.push(d)
    }
    for (const l of lanes) m.set(l.key, sortInLane(m.get(l.key)!, l))
    return m
  }, [items, lanes])

  const move = useBoardMove()
  const sensors = useBoardSensors()
  const [active, setActive] = useState<BoardDeliverable | null>(null)
  const [asking, setAsking] = useState<{ d: BoardDeliverable; lane: Lane } | null>(null)
  const [link, setLink] = useState('')

  const go = (d: BoardDeliverable, lane: Lane, delivery_link?: string | null) =>
    move.mutate({ id: d.id, status: lane.status, custom_status_code: lane.code, ...(delivery_link !== undefined ? { delivery_link } : {}) })

  function onDragStart(e: DragStartEvent) {
    setActive((e.active.data.current?.d as BoardDeliverable | undefined) ?? null)
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null)
    const d = e.active.data.current?.d as BoardDeliverable | undefined
    const overKey = e.over ? String(e.over.id) : null
    if (!d || !overKey?.startsWith('lane:')) return
    const lane = lanes.find((l) => `lane:${l.key}` === overKey)
    if (!lane || laneOf(d, lanes)?.key === lane.key) return
    if (!canEdit && !lane.team_allowed) {
      toast.error(`A manager moves work to ${lane.label}.`)
      return
    }
    if (wantsLinkAt(lane)) {
      setLink(d.delivery_link ?? '')
      setAsking({ d, lane })
      return
    }
    go(d, lane)
  }

  const cardProps = { stages, canEdit, me }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={collide} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
          <div className="flex min-w-max items-start snap-x snap-mandatory gap-3 sm:snap-none">
            {lanes.map((lane) => {
              const cards = byLane.get(lane.key) ?? []
              const late = cards.filter((c) => lane.status !== 'completed' && !!c.estimated_date && c.estimated_date < today).length
              return (
                <LaneColumn key={lane.key} lane={lane} count={cards.length} late={late}>
                  {cards.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">{emptyLine(lane)}</p>
                  ) : (
                    cards.map((d) => (
                      <BoardCard
                        key={d.id}
                        d={d}
                        {...cardProps}
                        ticked={selected.has(d.id)}
                        onToggle={() => onToggle(d.id)}
                        onOpen={() => onOpen(d.id)}
                      />
                    ))
                  )}
                </LaneColumn>
              )
            })}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {active && <CardFace d={active} {...cardProps} canMove ticked={false} onToggle={() => {}} onOpen={() => {}} lifted />}
        </DragOverlay>
      </DndContext>

      <Dialog open={!!asking} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent
          title={asking ? `Move to ${asking.lane.label}` : ''}
          description="Paste the link that went to the client, if there is one. It stays on the deliverable."
          className="max-w-md"
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!asking) return
              go(asking.d, asking.lane, link.trim() || null)
              setAsking(null)
            }}
          >
            <Input
              autoFocus
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://drive.google.com/…"
              aria-label="Link sent to client"
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAsking(null)}>
                Cancel
              </Button>
              <Button type="submit">{asking?.lane.status === 'completed' ? 'Mark delivered' : `Move to ${asking?.lane.label ?? ''}`}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LaneColumn({ lane, count, late, children }: { lane: Lane; count: number; late: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${lane.key}` })
  const tone = TONE_CLASSES[lane.tone]
  return (
    <section
      ref={setNodeRef}
      aria-label={`${lane.label}: ${count}`}
      className={cn(
        'flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl border bg-muted/40 transition-colors sm:w-72',
        isOver ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border',
      )}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className={cn('size-2.5 shrink-0 rounded-full', tone.solid)} aria-hidden />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{lane.label}</h3>
        {late > 0 && <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">{late} late</span>}
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', tone.soft, tone.text)}>{count}</span>
      </header>
      <div className="flex max-h-[calc(100vh-19rem)] min-h-32 flex-col gap-2 overflow-y-auto px-2 pb-2">{children}</div>
    </section>
  )
}
