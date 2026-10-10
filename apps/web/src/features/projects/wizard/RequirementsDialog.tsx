import { useMemo, useState } from 'react'
import { Check, Plus, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/shared/ui/dialog'
import { cn } from '@/shared/ui/cn'
import { Input } from '@/shared/ui/input'
import { QuantityStepper, ToneChip, TONE_DOT, TONE_TEXT } from '@/shared/ui/tone-chip'
import { useRoleLibrary } from '@/features/team/api'
import { useRememberService, useServices } from '@/features/shoots/api'
import {
  groupRequirementOptions,
  requirementOptions,
  stageOfRequirement,
} from '@/features/projects/requirements'
import { STAGE_TONE } from '@/features/team/role-stages'
import type { ShootRequirementDraft } from '@/features/projects/wizard'

/**
 * Picking the crew a shoot needs.
 *
 * Everything a shoot can ask for, grouped by when in the job it happens —
 * pre-production, on the day, post-production — with a colour per group, so
 * the eye finds "the people on the floor" before it reads a single name. The
 * studio's own requirements come first in each group; library defaults after.
 *
 * What is picked sits beside the suggestions (above them on a phone), each
 * with a visible − / + so the quantity can't be missed. Tapping a chip that is
 * already picked adds one more, and the chip shows its count, so "two candid
 * photographers" is two taps without looking anywhere else.
 *
 * The draft is local until Save, so half-tapped chips do not leak into the
 * project when somebody backs out.
 */
export function RequirementsDialog({
  shootName,
  requirements,
  onSave,
}: {
  shootName: string
  requirements: ShootRequirementDraft[]
  onSave: (next: ShootRequirementDraft[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ShootRequirementDraft[]>(requirements)
  const [custom, setCustom] = useState('')
  const services = useServices()
  const library = useRoleLibrary()
  const remember = useRememberService()

  const options = useMemo(
    () => requirementOptions(services.data ?? [], library.data ?? []),
    [services.data, library.data],
  )
  const groups = useMemo(() => groupRequirementOptions(options), [options])

  const indexOf = (name: string) =>
    draft.findIndex((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase())
  const qty = (r: ShootRequirementDraft) => Math.max(1, Number(r.quantity) || 1)

  /** Add it, or — if it is already picked — one more of it. */
  const bump = (name: string) => {
    const clean = name.trim()
    if (!clean) return
    const at = indexOf(clean)
    if (at >= 0) {
      setDraft((d) => d.map((r, i) => (i === at ? { ...r, quantity: String(Math.min(99, qty(r) + 1)) } : r)))
    } else {
      setDraft((d) => [...d, { name: clean, quantity: '1' }])
    }
  }

  const addCustom = () => {
    const clean = custom.trim()
    if (!clean) return
    const known = options.some((o) => o.name.toLowerCase() === clean.toLowerCase())
    bump(clean)
    // Learned now, not when the project is saved: the next shoot on this very
    // project should already offer it.
    if (!known) remember.mutate(clean)
    setCustom('')
  }

  const setQuantity = (at: number, n: number) =>
    setDraft((d) => d.map((r, i) => (i === at ? { ...r, quantity: String(n) } : r)))

  const people = draft.reduce((sum, r) => sum + qty(r), 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setDraft(requirements)
          setCustom('')
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <SlidersHorizontal /> {requirements.length ? 'Edit requirements' : 'Add requirements'}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-4xl"
        title="Shoot requirements"
        description={`Who does “${shootName || 'this shoot'}” need? Tap to add — tap again for one more.`}
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_21rem]">
          {/* ── what is picked: first on a phone, alongside on a wider screen ── */}
          <section
            aria-label="Selected for this shoot"
            className="order-first rounded-lg border border-primary/25 bg-primary/5 p-3 md:order-last md:self-start"
          >
            <p className="mb-2 flex items-baseline justify-between text-sm font-semibold text-primary">
              Selected for this shoot
              <span className="text-xs font-medium text-muted-foreground">
                {people} {people === 1 ? 'person' : 'people'}
              </span>
            </p>
            {draft.length === 0 ? (
              <p className="rounded-md border border-dashed border-warning/40 bg-warning/10 px-3 py-3 text-center text-sm text-warning">
                Nothing picked yet. Tap who this shoot needs.
              </p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto md:max-h-[50vh]">
                {draft.map((r, at) => {
                  const tone = STAGE_TONE[stageOfRequirement(r.name, options)]
                  return (
                    <li key={at} className="flex items-center gap-2 rounded-md bg-card px-2 py-1.5">
                      <span className={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
                      <span className="min-w-0 flex-1 break-words text-sm font-medium leading-tight">{r.name}</span>
                      <QuantityStepper value={qty(r)} onChange={(n) => setQuantity(at, n)} label={r.name} />
                      <button
                        type="button"
                        onClick={() => setDraft((d) => d.filter((_, i) => i !== at))}
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <X className="size-3.5" aria-hidden />
                        <span className="sr-only">Remove {r.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* ── what can be picked ── */}
          <div className="flex min-w-0 flex-col gap-4 md:max-h-[60vh] md:overflow-y-auto md:pr-1">
            <div className="flex items-center gap-2">
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  addCustom()
                }}
                placeholder="Someone not listed? e.g. Highlight Editor"
                aria-label="Add your own requirement"
              />
              <Button variant="outline" onClick={addCustom} disabled={!custom.trim()}>
                <Plus /> Add
              </Button>
            </div>

            {groups.map((g) => (
              <div key={g.stage}>
                <p className={cn('mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider', TONE_TEXT[g.tone])}>
                  <span className={cn('size-2 rounded-full', TONE_DOT[g.tone])} aria-hidden />
                  {g.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {g.options.map((o) => {
                    const at = indexOf(o.name)
                    return (
                      <ToneChip
                        key={o.name}
                        tone={g.tone}
                        label={o.name}
                        selected={at >= 0}
                        count={at >= 0 ? qty(draft[at]!) : undefined}
                        onClick={() => bump(o.name)}
                        title={at >= 0 ? `Add one more ${o.name}` : `Add ${o.name}`}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={() => {
              onSave(draft.filter((r) => r.name.trim()))
              setOpen(false)
            }}
          >
            <Check /> Save {draft.length > 0 ? `${people} ${people === 1 ? 'person' : 'people'}` : 'requirements'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
