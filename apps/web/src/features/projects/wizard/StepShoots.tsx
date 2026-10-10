import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  MapPin,
  Trash2,
  Users,
  UsersRound,
} from 'lucide-react'
import type { ShootPreset } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Input, Select } from '@/shared/ui/input'
import { DurationField } from '@/shared/ui/duration-field'
import { StatusBadge } from '@/shared/ui/status-badge'
import { scrollIntoView } from '@/shared/ui/motion'
import { ToneChip, TONE_CHIP_STATIC, toneAt } from '@/shared/ui/tone-chip'
import { SavePresetButton } from '@/features/shoots/SavePresetButton'
import { useDeliverableTypeList, useShootTypes } from '@/features/projects/api'
import { useRoleLibrary } from '@/features/team/api'
import { useServices, useShootPresets } from '@/features/shoots/api'
import { requirementOptions, stageOfRequirement } from '@/features/projects/requirements'
import { STAGE_TONE } from '@/features/team/role-stages'
import {
  QUICK_SHOOTS,
  SHOOT_PRESET,
  firstOpenShoot,
  internalWorkFor,
  newInternalWork,
  newShoot,
  nextUnfinishedShoot,
  removeShootAt,
  shootHoursOf,
  shootIssues,
  shootSummary,
  withShoots,
  type ProjectDraft,
  type ShootDraft,
} from '@/features/projects/wizard'
import { RequirementsDialog } from './RequirementsDialog'
import { AddShootMenu, PresetMenu } from './ShootMenus'
import type { Patch } from './wizard-state'
import { Band, Field, SubCard } from './wizard-ui'

/**
 * The busiest step in the wizard, so it opens with the shortcuts rather than a
 * blank row: a chip per common shoot day, a preset that lays down the four a
 * standard wedding books, and the whole searchable list behind Add shoot.
 */
export function ShootsStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const services = useServices()
  const shootPresets = useShootPresets('shoot')
  const shootTypes = useShootTypes()
  const deliverableTypes = useDeliverableTypeList()
  // Library first, hardcoded fallback: QUICK_SHOOTS stays when the catalog is empty.
  const quickShoots = (shootTypes.data ?? []).filter((t) => !t.is_archived).slice(0, 8).map((t) => t.name)
  const quickList = quickShoots.length ? quickShoots : [...QUICK_SHOOTS]
  const listRef = useRef<HTMLDivElement>(null)
  const cardAt = (i: number) => listRef.current?.children[i] ?? null

  // One card open at a time; the rest fold to a line. Arriving on the step
  // opens the first one still missing something.
  const [openShoot, setOpenShoot] = useState<number | null>(() => firstOpenShoot(draft.shoots))

  // The chips sit above a list that can already be several cards long, so a
  // shoot added from up there would otherwise land off the bottom of the
  // screen. A growing list opens the FIRST of the new cards and scrolls to it:
  // people fill top-down, so three chips tapped in a row start on the first.
  const count = useRef(draft.shoots.length)
  useEffect(() => {
    if (draft.shoots.length > count.current) {
      const first = count.current
      setOpenShoot(first)
      scrollIntoView(cardAt(first))
    }
    count.current = draft.shoots.length
  }, [draft.shoots.length])

  // The moment the open card turns green it folds and the next unfinished
  // one opens — the platform walks them down the list. It waits while a
  // picker or dialog is still open, or while they are typing in the card, so
  // nothing folds out from under a half-set time or a venue being typed.
  const shoots = useRef(draft.shoots)
  shoots.current = draft.shoots
  const openShootDraft = openShoot === null ? undefined : draft.shoots[openShoot]
  const openIssues = openShootDraft ? shootIssues(openShootDraft).length : -1
  const last = useRef({ at: openShoot, issues: openIssues })
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const before = last.current
    last.current = { at: openShoot, issues: openIssues }
    if (openShoot === null || openIssues !== 0) setArmed(false)
    else if (before.at === openShoot && before.issues > 0) setArmed(true)
  }, [openShoot, openIssues])
  useEffect(() => {
    if (!armed || openShoot === null) return
    let timer: ReturnType<typeof setTimeout>
    const fold = () => {
      const active = document.activeElement
      const typing =
        !!active && cardAt(openShoot)?.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
      if (typing || document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"], [role="listbox"]')) {
        timer = setTimeout(fold, 400)
        return
      }
      setArmed(false)
      const next = nextUnfinishedShoot(shoots.current, openShoot)
      setOpenShoot(next)
      if (next !== null) scrollIntoView(cardAt(next))
    }
    // A beat first, so the card is seen turning green before it folds.
    timer = setTimeout(fold, 700)
    return () => clearTimeout(timer)
  }, [armed, openShoot])

  const set = (i: number, p: Partial<ShootDraft>) =>
    patch({ shoots: draft.shoots.map((s, idx) => (idx === i ? { ...s, ...p } : s)) })

  const remove = (i: number) => {
    setOpenShoot((o) => (o === null || o === i ? null : o > i ? o - 1 : o))
    patch(removeShootAt(draft, i))
  }

  const add = (names: readonly string[]) => patch({ shoots: withShoots(draft.shoots, names) })
  // An empty name is the "add new shoot type" case with nothing typed yet: a
  // blank row to fill in, which withShoots would otherwise drop.
  const addNamed = (name: string) =>
    patch({ shoots: name ? withShoots(draft.shoots, [name]) : [...draft.shoots, newShoot()] })
  const wedding = withShoots(draft.shoots, SHOOT_PRESET)

  /** A saved day, stamped out whole: its crew and its edit-room list with it. */
  const applyShootPreset = (preset: ShootPreset) => {
    const at = draft.shoots.length
    patch({
      shoots: [
        ...draft.shoots,
        {
          ...newShoot(),
          name: preset.name,
          hours: preset.payload.duration_hours ? String(preset.payload.duration_hours) : '',
          requirements: preset.payload.requirements.map((r) => ({
            name: r.name,
            quantity: String(r.quantity),
          })),
        },
      ],
      deliverables: [
        ...draft.deliverables,
        ...preset.payload.internal_work.map((title) => newInternalWork(at, title, deliverableTypes)),
      ],
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* One list for every requirement input on the step: the browser reads
          it by id, and rendering it per row would repeat it a dozen times. */}
      <datalist id={SERVICE_LIST_ID}>
        {(services.data ?? []).map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold tracking-tight">Add your functions</p>
          <p className="text-sm text-muted-foreground">
            Every function is one shoot day: Haldi, Mehendi, Wedding, Reception. Tap the ones below, or add your own.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddShootMenu
            shoots={draft.shoots}
            onAdd={addNamed}
            extraNames={(shootPresets.data ?? []).map((p) => p.name)}
          />
          <PresetMenu
            label="Apply preset"
            presets={shootPresets.data ?? []}
            onApply={applyShootPreset}
            builtIn={{
              label: `Standard wedding — ${SHOOT_PRESET.join(', ')}`,
              disabled: wedding.length === draft.shoots.length,
              onApply: () => patch({ shoots: wedding }),
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {(shootTypes.data ?? []).length ? 'Your functions' : 'Tap to add'}
        </span>
        {quickList.map((name, i) => {
          const already = draft.shoots.some(
            (s) => s.name.trim().toLowerCase() === name.toLowerCase(),
          )
          return (
            <ToneChip
              key={name}
              tone={toneAt(i)}
              label={name}
              selected={already}
              disabled={already}
              onClick={() => add([name])}
              title={already ? `${name} is already on the schedule` : `Add ${name}`}
            />
          )
        })}
      </div>

      {draft.shoots.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <CalendarDays className="size-5 text-muted-foreground" aria-hidden />
          <p className="mt-1 font-semibold">No functions yet</p>
          <p className="text-sm text-muted-foreground">
            Tap Haldi, Wedding Day, Reception above — one card each. Delivery dates count forward from these.
          </p>
        </div>
      ) : (
        <div ref={listRef} className="flex flex-col gap-2">
          {draft.shoots.map((s, i) => (
            <ShootCard
              key={i}
              index={i}
              shoot={s}
              draft={draft}
              open={openShoot === i}
              onToggle={() => setOpenShoot((o) => (o === i ? null : i))}
              onChange={(p) => set(i, p)}
              onRemove={() => remove(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Shared by every requirement input on the step. */
const SERVICE_LIST_ID = 'ipc-shoot-services'

/**
 * One shoot day, whole: when it is, where it is, who it needs, and what the
 * edit room owes off the back of it.
 *
 * The card tints when something is missing rather than blocking — a studio
 * booking a date off a phone call has the day before it has the crew, and the
 * wizard should take the booking either way. Only a missing title actually
 * stops the step.
 */
/**
 * One shoot day. Open, it is the form; folded, it is one line — green with a
 * summary when the day is complete, red with what is missing when it is not.
 * Blue is the one being edited.
 */
function ShootCard({
  index,
  shoot,
  draft,
  open,
  onToggle,
  onChange,
  onRemove,
}: {
  index: number
  shoot: ShootDraft
  draft: ProjectDraft
  open: boolean
  onToggle: () => void
  onChange: (p: Partial<ShootDraft>) => void
  onRemove: () => void
}) {
  const issues = shootIssues(shoot)
  const ready = issues.length === 0
  const work = internalWorkFor(draft, index)
  const services = useServices()
  const library = useRoleLibrary()
  const options = useMemo(
    () => requirementOptions(services.data ?? [], library.data ?? []),
    [services.data, library.data],
  )
  const name = shoot.name.trim() || `Shoot ${index + 1}`
  return (
    <div
      className={cn(
        'card-enter rounded-lg border transition-[border-color,background-color,box-shadow] duration-300',
        open
          ? 'border-primary/50 bg-card ring-2 ring-primary/15'
          : ready
            ? 'border-success/40 bg-success/[0.04] hover:border-success/60'
            : 'border-border bg-card hover:border-primary/30',
      )}
    >
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
              ready ? 'bg-success text-success-foreground' : 'bg-primary/10 text-primary',
            )}
          >
            {ready ? <Check className="size-3.5" aria-hidden /> : index + 1}
          </span>
          <span className="shrink-0 font-medium">{name}</span>
          {ready ? (
            open ? (
              <StatusBadge tone="success">
                <CheckCircle2 className="mr-1 size-3" aria-hidden />
                Ready
              </StatusBadge>
            ) : (
              <span className="min-w-0 truncate text-sm text-muted-foreground">{shootSummary(shoot)}</span>
            )
          ) : (
            <>
              {/* A phone has room for one chip, not three: say how many. */}
              <StatusBadge tone="warning" className="shrink-0 sm:hidden">
                <AlertCircle className="mr-1 size-3" aria-hidden />
                {issues.length} to fill
              </StatusBadge>
              <span className="hidden min-w-0 flex-wrap gap-1.5 sm:flex">
              {issues.map((issue) => (
                <StatusBadge key={issue} tone="warning">
                  <AlertCircle className="mr-1 size-3" aria-hidden />
                  {issue}
                </StatusBadge>
              ))}
              </span>
            </>
          )}
          <ChevronDown
            className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        {/* Always on the card, folded or open: a studio saves the day it
            just set up as a preset, and that is usually once it is done. */}
        <SavePresetButton
          kind="shoot"
          defaultName={name}
          label="Save as preset"
          disabled={!shoot.name.trim()}
          disabledHint="Name the shoot first"
          payload={{
            requirements: shoot.requirements
              .filter((r) => r.name.trim())
              .map((r) => ({ name: r.name.trim(), quantity: Math.max(1, Number(r.quantity) || 1) })),
            internal_work: work.map((w) => w.item.title.trim()).filter(Boolean),
            duration_hours: shootHoursOf(shoot) || null,
          }}
        />
        {open && (
          <>
            <Button variant="ghost" size="icon" onClick={onRemove}>
              <Trash2 className="text-destructive" />
              <span className="sr-only">Remove {name}</span>
            </Button>
          </>
        )}
      </div>

      {open && (
        <div className="px-4 pb-4">
          {/* The optional fields (venue, map link) sit ahead of the required
              ones: the card folds the moment the last required field --
              the duration -- is set, so nothing optional may come after it. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Shoot title" required>
              <Input
                value={shoot.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Wedding day"
                autoFocus={!shoot.name}
                aria-invalid={!shoot.name.trim()}
              />
            </Field>
            <Field label="Date" icon={CalendarDays}>
              <Input
                type="date"
                value={shoot.shoot_date}
                onChange={(e) => onChange({ shoot_date: e.target.value })}
                aria-invalid={!shoot.shoot_date}
              />
            </Field>
            <Field label="City / Venue" icon={MapPin}>
              <Input
                value={shoot.location}
                onChange={(e) => onChange({ location: e.target.value })}
                placeholder="e.g. Jaipur"
              />
            </Field>
            {/* Whatever the client sent — a Maps link, a short link, or the
                venue's name from WhatsApp. It is stored as given. */}
            <Field label="Map link" icon={MapPin}>
              <Input
                value={shoot.map_link}
                onChange={(e) => onChange({ map_link: e.target.value })}
                placeholder="Paste the map link"
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Guests" icon={UsersRound}>
              <Input
                inputMode="numeric"
                value={shoot.guests ?? ''}
                onChange={(e) => onChange({ guests: e.target.value.replace(/[^\d]/g, '').slice(0, 6) })}
                placeholder="e.g. 400"
              />
            </Field>
            <Field label="Start time" icon={Clock}>
              <Input
                type="time"
                value={shoot.start_time}
                onChange={(e) => onChange({ start_time: e.target.value })}
                aria-invalid={!shoot.start_time}
              />
            </Field>
            <div className="sm:col-span-2">
              {/* The owner: "Duration (अवधि) — 1 hour to 12 hours, and a custom
                  one", so the day's crew hours can be planned from it. */}
              <Field label="Duration (अवधि)" icon={Clock}>
                <DurationField
                  value={shootHoursOf(shoot) || null}
                  onChange={(h) => onChange({ hours: h == null ? '' : String(h) })}
                  aria-invalid={!shootHoursOf(shoot)}
                />
              </Field>
            </div>
            <Field label="Status">
              <Select
                value={shoot.status}
                onChange={(e) => onChange({ status: e.target.value as ShootDraft['status'] })}
              >
                <option value="planned">Planned</option>
                <option value="confirmed">Confirmed</option>
              </Select>
            </Field>
          </div>

          {/* ── who this day needs ── */}
          <SubCard
            icon={Users}
            title="Shoot requirements"
            hint="Pick people or services and set how many of each this day needs."
            actions={
              <RequirementsDialog
                shootName={shoot.name}
                requirements={shoot.requirements}
                onSave={(requirements) => onChange({ requirements })}
              />
            }
          >
            {shoot.requirements.length === 0 ? (
              <Band tone="warning">No requirements yet — tap “Add requirements” to plan the team.</Band>
            ) : (
              // A summary, not an editor: changes happen in the dialog, so the card
              // stays readable when a wedding day needs eight people.
              <div className="flex flex-wrap gap-2">
                {shoot.requirements.map((r, at) => {
                  const tone = STAGE_TONE[stageOfRequirement(r.name, options)]
                  return (
                    <span
                      key={at}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium',
                        TONE_CHIP_STATIC[tone],
                      )}
                    >
                      {r.name.trim() || 'Unnamed'}
                      <span className="rounded-full bg-card/60 px-1.5 text-xs font-semibold tabular-nums">
                        ×{Math.max(1, Number(r.quantity) || 1)}
                      </span>
                    </span>
                  )
                })}
              </div>
            )}
          </SubCard>
        </div>
      )}
    </div>
  )
}
