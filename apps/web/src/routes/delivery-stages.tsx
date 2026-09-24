import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Plus, Trash2, Users } from 'lucide-react'
import type { DeliverableStage, StepKey } from '@ipc/contracts'
import { AuthedPage } from '@/shared/layout/AuthedPage'
import { PageHeader } from '@/shared/layout/page-header'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { SkeletonList } from '@/shared/ui/skeleton'
import { ErrorState } from '@/shared/ui/states'
import { useConfirm } from '@/shared/ui/confirm'
import { cn } from '@/shared/ui/cn'
import { STAGE_ORDER } from '@/features/projects/deliverable-stage'
import { STEP_LABEL, STEP_TONE, TONES, TONE_CLASSES, stagesIn, toneOf, type StageTone } from '@/features/projects/stages'
import { useAddStage, useDeleteStage, useDeliverableStagesQuery, useUpdateStage } from '@/features/projects/stages-api'

export function DeliveryStagesPage() {
  return (
    <AuthedPage module="projects">
      <Stages />
    </AuthedPage>
  )
}

const STEP_HINT: Record<StepKey, string> = {
  pending: 'Before anyone starts.',
  in_progress: 'While the editor works: "Colour grading", "Sound mix", "Changes requested".',
  review: 'Between the edit and the delivery: with a manager, approved, with the client.',
  completed: 'Handed over. Most studios need nothing here.',
}

/**
 * The studio's own stages. Every deliverable walks four steps -- To do,
 * Editing, Review, Delivered -- and inside each a studio can name where
 * things really are. The one-tap button walks through them in this order;
 * the colour shows on the card, the panel and the pipeline.
 */
function Stages() {
  const q = useDeliverableStagesQuery()
  const canEdit = useAccess().hasAction('projects', 'edit')
  const stages = q.data ?? []

  return (
    <>
      <PageHeader
        title="Delivery stages"
        description="Name the stages your work really goes through. The one-tap button on each deliverable walks them in this order."
      />
      {q.isLoading ? (
        <SkeletonList rows={4} />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(STAGE_ORDER as readonly StepKey[]).map((step) => (
            <StepCard key={step} step={step} stages={stagesIn(stages, step)} canEdit={canEdit} />
          ))}
        </div>
      )}
    </>
  )
}

function StepCard({ step, stages, canEdit }: { step: StepKey; stages: DeliverableStage[]; canEdit: boolean }) {
  const add = useAddStage()
  const [label, setLabel] = useState('')
  const [color, setColor] = useState<StageTone>(STEP_TONE[step])
  const tone = TONE_CLASSES[STEP_TONE[step]]

  return (
    <Card className="overflow-hidden">
      <div className={cn('h-1', tone.solid)} aria-hidden />
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={cn('text-base font-semibold', tone.text)}>{STEP_LABEL[step]}</h2>
          <span className="text-xs text-muted-foreground">{stages.length ? `${stages.length} named` : 'No named stages'}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{STEP_HINT[step]}</p>

        <ul className="mt-3 flex flex-col gap-1.5">
          {stages.map((s, i) => (
            <StageRow key={s.id} s={s} canEdit={canEdit} above={stages[i - 1]} below={stages[i + 1]} />
          ))}
        </ul>

        {canEdit && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (label.trim().length < 2) return
              add.mutate({ label: label.trim(), stage: step, color, team_allowed: true }, { onSuccess: () => setLabel('') })
            }}
          >
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={step === 'in_progress' ? 'e.g. Colour grading' : step === 'review' ? 'e.g. With family' : 'Add a stage'}
              aria-label={`New stage in ${STEP_LABEL[step]}`}
              className="h-8 min-w-0 flex-1"
            />
            <ColourDots value={color} onChange={setColor} />
            <Button type="submit" size="sm" disabled={add.isPending || label.trim().length < 2}>
              <Plus /> Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function StageRow({
  s,
  canEdit,
  above,
  below,
}: {
  s: DeliverableStage
  canEdit: boolean
  above: DeliverableStage | undefined
  below: DeliverableStage | undefined
}) {
  const update = useUpdateStage()
  const del = useDeleteStage()
  const confirm = useConfirm()
  const [label, setLabel] = useState(s.label)
  const tone = toneOf(s.color, STEP_TONE[s.stage])
  const t = TONE_CLASSES[tone]

  /** Swap places with a neighbour; sort orders are spaced so this never collides. */
  const swap = (other: DeliverableStage) => {
    const mine = s.sort_order === other.sort_order ? other.sort_order + 1 : other.sort_order
    update.mutate({ id: s.id, sort_order: mine })
    update.mutate({ id: other.id, sort_order: s.sort_order })
  }

  if (!canEdit) {
    return (
      <li className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
        <span className={cn('size-2.5 rounded-full', t.solid)} aria-hidden />
        <span className="flex-1 font-medium">{s.label}</span>
        {s.team_allowed && <Users className="size-3.5 text-muted-foreground" aria-label="Team can pick this" />}
      </li>
    )
  }

  return (
    <li className={cn('flex flex-wrap items-center gap-2 rounded-lg border border-border px-2 py-1.5', t.soft)}>
      <div className="flex flex-col">
        <button type="button" disabled={!above} onClick={() => above && swap(above)} className="rounded p-0.5 text-muted-foreground hover:bg-card disabled:opacity-30" aria-label={`Move ${s.label} up`}>
          <ArrowUp className="size-3.5" />
        </button>
        <button type="button" disabled={!below} onClick={() => below && swap(below)} className="rounded p-0.5 text-muted-foreground hover:bg-card disabled:opacity-30" aria-label={`Move ${s.label} down`}>
          <ArrowDown className="size-3.5" />
        </button>
      </div>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          const next = label.trim()
          if (next.length >= 2 && next !== s.label) update.mutate({ id: s.id, label: next })
          else setLabel(s.label)
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        aria-label={`Name of ${s.label}`}
        className={cn('h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm font-semibold focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', t.text)}
      />
      <ColourDots value={tone} onChange={(c) => update.mutate({ id: s.id, color: c })} />
      <span title="Editors can move their own work to this stage">
        <Switch
          checked={s.team_allowed}
          onChange={(v) => update.mutate({ id: s.id, team_allowed: v })}
          label="Team"
          className="w-auto [&_span.block]:text-xs [&_span.block]:text-muted-foreground"
        />
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${s.label}`}
        onClick={async () => {
          if (
            await confirm({
              title: `Remove "${s.label}"?`,
              description: `Work on it stays in ${STEP_LABEL[s.stage]}, just without this name.`,
              destructive: true,
              confirmLabel: 'Remove',
            })
          )
            del.mutate(s.id)
        }}
      >
        <Trash2 />
      </Button>
    </li>
  )
}

function ColourDots({ value, onChange }: { value: StageTone; onChange: (t: StageTone) => void }) {
  return (
    <span className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
      {TONES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          aria-label={t}
          onClick={() => onChange(t)}
          className={cn('flex size-5 items-center justify-center rounded-full', TONE_CLASSES[t].solid, value === t && 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-card')}
        >
          {value === t && <Check className="size-3 text-white" strokeWidth={3} />}
        </button>
      ))}
    </span>
  )
}
