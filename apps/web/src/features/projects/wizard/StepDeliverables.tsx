import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, CalendarDays, ChevronDown, Package, Plus, Save, Sparkles, Trash2, X } from 'lucide-react'
import { DUE_BASIS_OPTIONS } from '@ipc/domain'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { Input, Select } from '@/shared/ui/input'
import { StatusBadge } from '@/shared/ui/status-badge'
import { Switch } from '@/shared/ui/switch'
import { ToneChip, toneAt } from '@/shared/ui/tone-chip'
import { useINR } from '@/shared/money/MoneyMask'
import {
  useDeleteDeliverableSet,
  useDeliverableSets,
  useDeliverableTypeList,
  useSaveDeliverableSet,
} from '@/features/projects/api'
import {
  BUILT_IN_SETS,
  dueSummary,
  estimatedDateFor,
  learnedDeliverables,
  money,
  newClientDeliverable,
  quickDeliverables,
  rememberDueDays,
  withDeliverables,
  type DeliverableDraft,
  type ProjectDraft,
} from '@/features/projects/wizard'
import { countLabel, type Patch } from './wizard-state'
import { Band, Field, useDismiss } from './wizard-ui'

const dayFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const prettyDate = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00`))

/** How many quick-add chips show before "+N more": two lines on a laptop. */
const QUICK_LIMIT = 12

/**
 * What the client is promised, as one short list.
 *
 * Each line is folded to a sentence — the title, when it is due, and an
 * Add-on tag if it is charged on top — and opens in place to edit. One is
 * open at a time, so a wedding's six deliverables fit on a laptop screen
 * without scrolling. Add-ons live in the same list: turning "Charged on top"
 * on tags the line instead of moving it to another section.
 *
 * The team's own work (culling, sorting, reels) is not asked for here. It
 * comes in with the shoot presets, is still created with each shoot, and is
 * edited on the project page where the people doing it are assigned.
 */
export function DeliverablesStep({ draft, patch }: { draft: ProjectDraft; patch: Patch }) {
  const deliverableTypes = useDeliverableTypeList()
  const [openRow, setOpenRow] = useState<number | null>(null)
  const [flash, setFlash] = useState<ReadonlySet<number>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    if (flash.size === 0) return
    const t = setTimeout(() => setFlash(new Set()), 1000)
    return () => clearTimeout(t)
  }, [flash])

  const quick = useMemo(() => quickDeliverables(learnedDeliverables()), [])
  const shown = showAll ? quick : quick.slice(0, QUICK_LIMIT)
  const rows = draft.deliverables
    .map((item, at) => ({ at, item }))
    .filter(({ item }) => item.visibility_scope === 'client')
  const team = draft.deliverables.length - rows.length

  /** Chips and sets add folded lines, with a green wash on what just arrived. */
  const add = (items: Parameters<typeof withDeliverables>[1]) => {
    const before = draft.deliverables.length
    const next = withDeliverables(draft.deliverables, items, deliverableTypes)
    if (next === draft.deliverables) return
    patch({ deliverables: next })
    setFlash(new Set(Array.from({ length: next.length - before }, (_, k) => before + k)))
  }
  /** A blank line opens straight away: it needs a title before it is anything. */
  const addBlank = () => {
    setOpenRow(draft.deliverables.length)
    patch({ deliverables: [...draft.deliverables, newClientDeliverable()] })
  }
  const remove = (i: number) => {
    setOpenRow((o) => (o === null || o === i ? null : o > i ? o - 1 : o))
    setFlash(new Set())
    patch({ deliverables: draft.deliverables.filter((_, at) => at !== i) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3.5" aria-hidden />
          Quick add
        </span>
        <div className="ml-auto flex items-center gap-2">
          <SetMenu draft={draft} onLoad={add} />
          <Button size="sm" variant="outline" onClick={addBlank}>
            <Plus /> Add row
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {shown.map(({ title, learned }, i) => {
          const already = draft.deliverables.some(
            (d) => d.title.trim().toLowerCase() === title.toLowerCase(),
          )
          return (
            <ToneChip
              key={title}
              // What this studio has used before stands out in one colour;
              // the generic list cycles through the rest.
              tone={learned ? 'rose' : toneAt(i + 1)}
              label={title}
              selected={already}
              disabled={already}
              onClick={() => add([{ title }])}
              title={
                already
                  ? `${title} is already on the list`
                  : learned
                    ? `${title} — you've used this before`
                    : `Add ${title}`
              }
            />
          )
        })}
        {quick.length > QUICK_LIMIT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="rounded-full px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {showAll ? 'Show less' : `+${quick.length - QUICK_LIMIT} more`}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <Band>No deliverables yet. Tap a chip above, or load one of your sets.</Band>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ at, item }) => (
            <DeliverableRow
              key={at}
              at={at}
              item={item}
              draft={draft}
              patch={patch}
              open={openRow === at}
              flash={flash.has(at)}
              onToggle={() => setOpenRow((o) => (o === at ? null : at))}
              onRemove={() => remove(at)}
            />
          ))}
        </div>
      )}

      {team > 0 && (
        <p className="text-xs text-muted-foreground">
          Team work: {countLabel(team, 'item')} from your presets — edit them on the project page.
        </p>
      )}
    </div>
  )
}

/**
 * Packages a studio sells again and again, one tap away: the built-in
 * wedding sets, the studio's own, and "save this list" for next time. In a
 * menu so the step's heading carries only the quick-add chips.
 */
function SetMenu({
  draft,
  onLoad,
}: {
  draft: ProjectDraft
  onLoad: (items: Parameters<typeof withDeliverables>[1]) => void
}) {
  const sets = useDeliverableSets()
  const saveSet = useSaveDeliverableSet()
  const deleteSet = useDeleteDeliverableSet()
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useDismiss(root, open, () => setOpen(false))

  const saveable = draft.deliverables
    .filter((d) => d.visibility_scope === 'client' && d.title.trim())
    .map((d) => ({
      title: d.title.trim(),
      is_additional_charge: d.is_additional_charge,
      additional_charge_amount: money(d.additional_charge_amount),
      show_on_quotation: d.show_on_quotation,
    }))

  const load = (items: Parameters<typeof withDeliverables>[1]) => {
    onLoad(items)
    setOpen(false)
  }
  const save = () => {
    if (!name.trim()) return
    saveSet.mutate(
      { name: name.trim(), items: saveable },
      {
        onSuccess: () => {
          setNaming(false)
          setOpen(false)
        },
      },
    )
  }

  const item = 'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted'
  return (
    <div ref={root} className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setNaming(false)
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bookmark /> Load a set <ChevronDown />
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Deliverable sets"
          className="ipc-menu absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-border bg-card p-1.5 shadow-lg"
        >
          {BUILT_IN_SETS.map((s) => (
            <button key={s.name} type="button" role="menuitem" onClick={() => load(s.titles.map((title) => ({ title })))} className={item}>
              {s.name}
              <span className="block truncate text-xs text-muted-foreground">{s.titles.join(', ')}</span>
            </button>
          ))}
          {(sets.data ?? []).map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <button type="button" role="menuitem" onClick={() => load(s.items)} className={cn(item, 'min-w-0 flex-1')}>
                {s.name}
                <span className="block truncate text-xs text-muted-foreground">
                  {s.items.map((i) => i.title).join(', ')}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => deleteSet.mutate(s.id)}
                disabled={deleteSet.isPending}
              >
                <Trash2 />
                <span className="sr-only">Delete set {s.name}</span>
              </Button>
            </div>
          ))}
          <div className="my-1 border-t border-border" />
          {naming ? (
            <div className="flex items-center gap-2 p-1">
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save()
                }}
                placeholder="Name this set"
                aria-label="Set name"
              />
              <Button size="sm" onClick={save} disabled={!name.trim() || saveSet.isPending}>
                Save
              </Button>
            </div>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={saveable.length === 0}
              title={saveable.length === 0 ? 'Add a deliverable first' : undefined}
              onClick={() => {
                setName('')
                setNaming(true)
              }}
              className={cn(item, 'flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent')}
            >
              <Save className="size-4" aria-hidden /> Save this list as a set…
            </button>
          )}
          <p className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">Sets are shared with your whole team.</p>
        </div>
      )}
    </div>
  )
}

/**
 * One deliverable: a single line until it is opened, then edited in place.
 *
 * The lead time is remembered per title on this device as it is typed, so the
 * next project that quotes a "Photo Album" starts from the turnaround this
 * studio actually works to instead of an empty box.
 */
function DeliverableRow({
  at,
  item,
  draft,
  patch,
  open,
  flash,
  onToggle,
  onRemove,
}: {
  at: number
  item: DeliverableDraft
  draft: ProjectDraft
  patch: Patch
  open: boolean
  flash: boolean
  onToggle: () => void
  onRemove: () => void
}) {
  const inr = useINR()
  const set = (p: Partial<DeliverableDraft>) =>
    patch({ deliverables: draft.deliverables.map((d, i) => (i === at ? { ...d, ...p } : d)) })
  const due = estimatedDateFor(draft, item)
  const amount = money(item.additional_charge_amount)
  const title = item.title.trim() || 'Untitled deliverable'

  return (
    <div
      className={cn(
        'card-enter rounded-lg border transition-[border-color,box-shadow] duration-200',
        open ? 'border-primary/50 bg-card ring-2 ring-primary/15' : 'border-border bg-card hover:border-primary/30',
        flash && 'ipc-row-flash',
      )}
    >
      <div className="flex items-center gap-1 pr-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Package className={cn('size-4 shrink-0', open ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
          <span className={cn('shrink-0 text-sm font-medium', !item.title.trim() && 'text-muted-foreground')}>
            {title}
          </span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {dueSummary(item)}
            {due && item.due_basis !== 'custom' ? ` · due ${prettyDate(due)}` : ''}
          </span>
          {item.is_additional_charge && (
            <StatusBadge tone={amount > 0 ? 'info' : 'warning'} className="shrink-0">
              {amount > 0 ? `Add-on ${inr(amount)}` : 'Add-on · amount needed'}
            </StatusBadge>
          )}
          <ChevronDown
            className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
        <Button variant="ghost" size="icon" className="size-8" onClick={onRemove}>
          <X />
          <span className="sr-only">Remove {title}</span>
        </Button>
      </div>

      {open && (
        <div className="border-t border-border p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]">
            <Field label="Title" required>
              <Input
                value={item.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="Wedding album"
                autoFocus={!item.title}
              />
            </Field>
            {/* The client's clock, which is the one the quotation prints. */}
            <Field label="Delivery days">
              <Input
                inputMode="numeric"
                value={item.due_days}
                onChange={(e) => set({ due_days: e.target.value })}
                onBlur={(e) => rememberDueDays(item.title, e.target.value)}
                placeholder="45"
              />
            </Field>
            <Field label="Counted from">
              <Select
                value={item.due_basis}
                onChange={(e) => set({ due_basis: e.target.value as DeliverableDraft['due_basis'] })}
              >
                {DUE_BASIS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {(item.due_basis === 'custom' || item.due_basis === 'custom_after') && (
            <div className="mt-3 sm:w-1/2">
              <Field label={item.due_basis === 'custom_after' ? 'Count days from' : 'Delivery date'}>
                <Input
                  type="date"
                  value={item.custom_date}
                  onChange={(e) => set({ custom_date: e.target.value })}
                />
              </Field>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
            <Switch
              className="w-auto"
              checked={item.is_additional_charge}
              onChange={(v) => set({ is_additional_charge: v })}
              label="Charged on top of the package"
            />
            {item.is_additional_charge && (
              <Field label="Amount (₹)" required>
                <Input
                  inputMode="numeric"
                  value={item.additional_charge_amount}
                  onChange={(e) => set({ additional_charge_amount: e.target.value })}
                  placeholder="15000"
                  className="w-36"
                />
              </Field>
            )}
            <p className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden />
              {due ? (
                <>
                  Estimated delivery <span className="font-medium text-foreground">{prettyDate(due)}</span>
                </>
              ) : (
                'The date shows once the shoot it counts from has a date.'
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
