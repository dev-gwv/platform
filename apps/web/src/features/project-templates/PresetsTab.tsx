import { useNavigate } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import type { ShootPreset, ShootPresetKind } from '@ipc/contracts'
import { useAccess } from '@/shared/auth/useAccess'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { useConfirm } from '@/shared/ui/confirm'
import { SkeletonCards } from '@/shared/ui/skeleton'
import { EmptyState, ErrorState } from '@/shared/ui/states'
import { useDeleteShootPreset, useShootPresets } from '@/features/shoots/api'

const COPY: Record<ShootPresetKind, { intro: string; emptyTitle: string; empty: string; kept: string }> = {
  shoot: {
    intro: 'A saved shoot day: the crew it needs and the team work after it. Apply one when you add a shoot.',
    emptyTitle: 'No shoot presets yet',
    empty: 'In Create Project, set up a shoot the way you like it and tap “Save as preset”. It will show here.',
    kept: 'Shoots already set up from it stay as they are.',
  },
  internal_work: {
    intro: 'A saved list of team work for a shoot — editing, sorting, reels. Apply one on the Deliverables step.',
    emptyTitle: 'No work presets yet',
    empty: 'In Create Project, add team work under a shoot on the Deliverables step and tap “Save preset”. It will show here.',
    kept: 'Team work already added from it stays as it is.',
  },
}

/**
 * The presets saved from the new-project wizard, one kind at a time: what
 * each one lays down, and a way to get rid of the ones nobody uses. Saving
 * stays in the wizard, where the shape being saved is on screen.
 */
export function PresetsTab({ kind }: { kind: ShootPresetKind }) {
  const q = useShootPresets(kind)
  const remove = useDeleteShootPreset()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const access = useAccess()
  const copy = COPY[kind]
  const presets = q.data ?? []

  if (q.isLoading) return <SkeletonCards count={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (presets.length === 0) {
    return (
      <EmptyState
        title={copy.emptyTitle}
        description={copy.empty}
        action={
          access.hasAction('projects', 'create') ? (
            <Button onClick={() => void navigate({ to: '/projects/new' })}>
              <Plus /> Create a project
            </Button>
          ) : undefined
        }
      />
    )
  }

  const onDelete = async (p: ShootPreset) => {
    if (await confirm({ title: `Delete “${p.name}”?`, description: copy.kept, confirmLabel: 'Delete', destructive: true }))
      remove.mutate(p.id)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{copy.intro}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {presets.map((p) => (
          <PresetCard
            key={p.id}
            preset={p}
            onDelete={access.hasAction('projects', 'edit') ? () => void onDelete(p) : undefined}
            deleting={remove.isPending && remove.variables === p.id}
          />
        ))}
      </div>
    </div>
  )
}

/** One preset: its name, and what applying it adds. */
function PresetCard({
  preset,
  onDelete,
  deleting,
}: {
  preset: ShootPreset
  onDelete: (() => void) | undefined
  deleting: boolean
}) {
  const crew = preset.payload.requirements
  const work = preset.payload.internal_work
  const isShoot = preset.kind === 'shoot'

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 break-words font-semibold">{preset.name}</h3>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1 -mt-1 size-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              disabled={deleting}
            >
              <Trash2 />
              <span className="sr-only">Delete {preset.name}</span>
            </Button>
          )}
        </div>

        {isShoot && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Crew</p>
            {crew.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {crew.map((r, i) => (
                  <li key={`${r.name}-${i}`} className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium">
                    {r.name} <span className="tabular-nums text-muted-foreground">×{r.quantity}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">None saved.</p>
            )}
          </div>
        )}

        {(!isShoot || work.length > 0) && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Team work</p>
            {work.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {work.map((title, i) => (
                  <li key={`${title}-${i}`} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                    {title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">None saved.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
