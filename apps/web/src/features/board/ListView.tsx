import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRightLeft, Check, UserPlus } from 'lucide-react'
import type { BoardDeliverable, DeliverableStage, StepKey } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { cn } from '@/shared/ui/cn'
import { RowMenu } from '@/shared/ui/row-menu'
import { DueChip, KindTile } from '@/features/projects/DeliverableCard'
import { GiveWorkDialog } from '@/features/projects/GiveWorkDialog'
import { isLate, stageOf } from '@/features/projects/deliverable-stage'
import { TONE_CLASSES, stageName, stageTone } from '@/features/projects/stages'
import { asDeliverable } from './as-deliverable'
import { laneOf, sortForList, type Lane } from './board-model'
import { useBoardMove } from './api'

/**
 * The board as one list, late first and then by due date: what, for which
 * project, where it stands, who has it and by when. Each row moves to another
 * stage from its menu, and a row with nobody on it says "Give to…" (the same
 * Give work dialog as the cards). Tick rows for the bulk bar.
 */
export function ListView({
  items,
  stages,
  lanes,
  canEdit,
  me,
  selected,
  onToggle,
  onOpen,
}: {
  items: readonly BoardDeliverable[]
  stages: readonly DeliverableStage[]
  lanes: readonly Lane[]
  canEdit: boolean
  me: string | null
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  onOpen: (id: string) => void
}) {
  const rows = useMemo(() => sortForList(items), [items])
  const move = useBoardMove()
  const [giving, setGiving] = useState<BoardDeliverable | null>(null)

  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches these filters.</p>

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <ul className="divide-y divide-border">
        {rows.map((d) => {
          const late = isLate(d)
          const tone = TONE_CLASSES[stageTone(d, stages)]
          const done = stageOf(d.status) === 'completed'
          const here = laneOf(d, lanes)
          const canMove = canEdit || (!!me && d.assignee_id === me)
          const ticked = selected.has(d.id)
          return (
            <li key={d.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5', late && 'bg-destructive/[0.03]', ticked && 'bg-primary/5')}>
              {canEdit && (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={ticked}
                  aria-label={`Select ${d.title}`}
                  onClick={() => onToggle(d.id)}
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                    ticked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card',
                  )}
                >
                  {ticked && <Check className="size-3" aria-hidden />}
                </button>
              )}
              <KindTile title={d.title} status={d.status} />
              <button type="button" onClick={() => onOpen(d.id)} className="min-w-[12rem] flex-1 text-left">
                <span className="block text-sm font-semibold hover:text-primary">{d.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  <Link to="/projects/$id" params={{ id: d.project_id }} search={{ tab: 'deliverables' }} className="hover:text-primary hover:underline">
                    {d.project_name}
                  </Link>
                  {d.shoot_name ? ` · ${d.shoot_name}` : ''}
                </span>
              </button>
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', tone.soft, tone.text)}>
                <span className={cn('size-1.5 rounded-full', tone.solid)} aria-hidden />
                {stageName(d, stages)}
              </span>
              {d.assignee_name ? (
                <span className="inline-flex w-36 min-w-0 items-center gap-1.5 text-xs font-medium text-foreground/80">
                  <Avatar name={d.assignee_name} size="sm" /> <span className="truncate">{d.assignee_name}</span>
                </span>
              ) : !done && canEdit ? (
                <button
                  type="button"
                  onClick={() => setGiving(d)}
                  className="inline-flex w-36 items-center gap-1 rounded-full border border-dashed border-warning/70 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning hover:bg-warning/20"
                >
                  <UserPlus className="size-3.5" aria-hidden /> Give to…
                </button>
              ) : (
                <span className="w-36 text-xs text-muted-foreground">{done ? '' : 'Nobody yet'}</span>
              )}
              <span className="w-28">
                <DueChip d={d} />
              </span>
              {canMove && (
                <RowMenu
                  label={`Move ${d.title}`}
                  items={lanes
                    .filter((l) => l.key !== here?.key && (canEdit || l.team_allowed))
                    .map((l) => ({
                      label: `Move to ${l.label}`,
                      icon: <ArrowRightLeft className="size-4" aria-hidden />,
                      onSelect: () => move.mutate({ id: d.id, status: l.status as StepKey, custom_status_code: l.code }),
                    }))}
                />
              )}
            </li>
          )
        })}
      </ul>
      {giving && <GiveWorkDialog deliverables={[asDeliverable(giving)]} onClose={() => setGiving(null)} />}
    </div>
  )
}
