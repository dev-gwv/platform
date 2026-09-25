import type { ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'
import { Check, MessageSquare, Mic } from 'lucide-react'
import type { BoardDeliverable, DeliverableStage } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { Avatar } from '@/shared/ui/avatar'
import { DueChip, KindTile, NextStageButton, activityText } from '@/features/projects/DeliverableCard'
import { isLate, stageOf } from '@/features/projects/deliverable-stage'
import { TONE_CLASSES, stageName, stageTone } from '@/features/projects/stages'

/** Clicks on a control stay with the control; anywhere else opens the card. */
const fromControl = (e: { target: EventTarget }) =>
  !!(e.target as HTMLElement).closest('button, a, select, input, label, form, [role="checkbox"]')

export interface CardProps {
  d: BoardDeliverable
  stages: readonly DeliverableStage[]
  /** Show where it stands (the People view); lanes already say it. */
  showStage?: boolean
  /** Show who is on it (the Stages view); a person's column already says it. */
  showEditor?: boolean
  canEdit: boolean
  me: string | null
  ticked: boolean
  onToggle: () => void
  onOpen: () => void
}

/**
 * One deliverable on the board: what, for whom, who is on it, by when -- and
 * the one button that moves it on. Drag it to another lane or person; tap it
 * for the whole story.
 */
export function BoardCard(props: CardProps) {
  const { d, canEdit, me } = props
  const canMove = canEdit || (!!me && d.assignee_id === me)
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: d.id,
    disabled: !canMove,
    data: { d },
  })
  // The card inside is the one focusable button; the wrapper only carries the
  // drag. (Keyboard users move a card from its panel's "Move to" list.)
  const { role: _role, tabIndex: _tab, ...dragAttrs } = attributes
  return (
    <div ref={setNodeRef} {...dragAttrs} {...listeners} className={cn('touch-manipulation', isDragging && 'opacity-40')}>
      <CardFace {...props} canMove={canMove} />
    </div>
  )
}

/** The card itself, also drawn under the pointer while it is dragged. */
export function CardFace({
  d,
  stages,
  showStage = false,
  showEditor = true,
  canEdit,
  canMove,
  ticked,
  onToggle,
  onOpen,
  lifted = false,
}: CardProps & { canMove: boolean; lifted?: boolean }) {
  const step = stageOf(d.status)
  const late = isLate(d)
  const tone = TONE_CLASSES[stageTone(d, stages)]
  const activity = activityText(d, stages)
  const texts = d.notes_count - d.voice_count

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${d.title}`}
      onClick={(e) => !fromControl(e) && onOpen()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onOpen())}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border border-l-4 border-border bg-card p-3 text-left shadow-sm transition-shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        late ? 'border-l-destructive bg-destructive/[0.03]' : tone.border,
        ticked && 'ring-2 ring-primary/60',
        lifted ? 'rotate-1 shadow-xl' : 'hover:shadow-md',
      )}
    >
      <div className="flex items-start gap-2">
        {canEdit && (
          <button
            type="button"
            role="checkbox"
            aria-checked={ticked}
            aria-label={`Select ${d.title}`}
            onClick={onToggle}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
              ticked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card opacity-60 group-hover:opacity-100',
            )}
          >
            {ticked && <Check className="size-3" aria-hidden />}
          </button>
        )}
        <KindTile title={d.title} status={d.status} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold leading-snug">{d.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <Link
              to="/projects/$id"
              params={{ id: d.project_id }}
              search={{ tab: 'deliverables' }}
              className="font-medium text-foreground/80 hover:text-primary hover:underline"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {d.project_name}
            </Link>
            {d.shoot_name ? ` · ${d.shoot_name}` : ''}
          </p>
        </div>
      </div>

      {showStage && step !== 'cancelled' && (
        <span className={cn('inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', tone.soft, tone.text)}>
          <span className={cn('size-1.5 rounded-full', tone.solid)} aria-hidden />
          {stageName(d, stages)}
        </span>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {showEditor &&
          (d.assignee_name ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground/80">
              <Avatar name={d.assignee_name} size="sm" /> <span className="truncate">{d.assignee_name}</span>
            </span>
          ) : step !== 'completed' ? (
            <span className="rounded-full bg-tone-amber-soft px-2 py-0.5 text-[11px] font-semibold text-tone-amber">Unassigned</span>
          ) : null)}
        <DueChip d={d} />
        {d.voice_count > 0 && <Tally icon={<Mic className="size-3" aria-hidden />} n={d.voice_count} label="voice note" />}
        {texts > 0 && <Tally icon={<MessageSquare className="size-3" aria-hidden />} n={texts} label="note" />}
      </div>

      {activity && <p className="line-clamp-1 text-[11px] text-muted-foreground">{activity}</p>}

      {canMove && step !== 'completed' && step !== 'cancelled' && (
        <div onPointerDown={(e) => e.stopPropagation()} className="flex">
          <NextStageButton id={d.id} status={d.status} code={d.custom_status_code} link={d.delivery_link} canEdit={canEdit} />
        </div>
      )}
    </div>
  )
}

function Tally({ icon, n, label }: { icon: ReactNode; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80" title={`${n} ${label}${n === 1 ? '' : 's'}`}>
      {icon}
      {n}
    </span>
  )
}
