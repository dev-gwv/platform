import { useMemo, useRef, useState } from 'react'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import type { ProductionStage } from '@ipc/contracts'
import { roleKind } from '@/shared/kinds'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/ui/cn'
import { ROLE_ICON } from '@/shared/ui/icon-tile'
import { ToneChip, TONE_DOT, TONE_TEXT } from '@/shared/ui/tone-chip'
import type { PickableRole } from './bulk'
import { canOfferNew, chosenSummary, exactRole, filterRoles } from './role-picker'
import { STAGE_LABEL, STAGE_ORDER, STAGE_TONE, stageOf } from './role-stages'

/**
 * The one way to pick job roles, wherever a person is added or edited.
 *
 * The owner's complaint: the roles were folded behind a small "Change"
 * button, drawn as a grid of radio cards, and "+ Add new role" was grey text
 * nobody found. So this is always open, the box has a border you can see
 * (amber until something is picked, green after), the roles are coloured
 * chips grouped by the part of the job they belong to, and the way to add a
 * role the studio does not have yet is the first thing on it: type the name
 * in the search box, or press the solid "+ Add new role" button.
 *
 * Keys are the caller's: a role id, or `lib:<code>` for a library default the
 * studio has not taken yet. `onPick` lets "Add one person" turn a default into
 * a real role the moment it is tapped, while bulk add keeps the library key
 * and creates it on send.
 */
export function JobRolePicker({
  pickable,
  chosen,
  onChange,
  onPick,
  onCreate,
  compact = false,
}: {
  pickable: readonly PickableRole[]
  chosen: readonly string[]
  onChange: (keys: string[]) => void
  /** Turn a tapped role into the key to store; defaults to its own key. */
  onPick?: ((role: PickableRole) => Promise<string>) | undefined
  /** Save a new role and resolve with its key. Omit for someone who may not add roles. */
  onCreate?: ((name: string, stage: ProductionStage) => Promise<string>) | undefined
  /** Tighter spacing, for inside a dialog. */
  compact?: boolean | undefined
}) {
  const [q, setQ] = useState('')
  const [stage, setStage] = useState<ProductionStage | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const shown = useMemo(() => filterRoles(pickable, q), [pickable, q])
  const exact = exactRole(pickable, q)
  const offerNew = !!onCreate && canOfferNew(pickable, q)
  const newName = q.trim().replace(/\s+/g, ' ')
  // The stage the name implies ("… Editor" is post-production) unless a pill was pressed.
  const newStage = stage ?? stageOf({ type_name: newName, stage: null })

  const byKey = useMemo(() => new Map(pickable.map((r) => [r.key, r])), [pickable])
  const chosenNames = chosen.map((k) => byKey.get(k)?.type_name).filter((n): n is string => !!n)

  async function tap(role: PickableRole) {
    if (chosen.includes(role.key)) {
      onChange(chosen.filter((k) => k !== role.key))
      return
    }
    if (!onPick) {
      onChange([...chosen, role.key])
      return
    }
    try {
      setBusy(true)
      const key = await onPick(role)
      onChange([...chosen, key])
    } catch {
      // The mutation hook toasts the server's reason.
    } finally {
      setBusy(false)
    }
  }

  async function addNew() {
    if (!onCreate || !offerNew) return
    try {
      setBusy(true)
      const key = await onCreate(newName, newStage)
      onChange([...chosen, key])
      setQ('')
      setStage(null)
    } catch {
      // The mutation hook toasts the server's reason.
    } finally {
      setBusy(false)
    }
  }

  const none = chosen.length === 0

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border-2 transition-colors',
        compact ? 'gap-2.5 p-2.5' : 'gap-3 p-3',
        none ? 'border-dashed border-tone-amber/70 bg-tone-amber-soft/20' : 'border-tone-green bg-tone-green-soft/20',
      )}
    >
      {/* What is picked so far -- moves the moment a chip is tapped. */}
      <p className={cn('text-sm', none ? 'text-tone-amber' : 'font-medium text-tone-green')} aria-live="polite">
        {none
          ? 'Nothing picked yet — tap what they get booked for.'
          : // A role made a moment ago may not be back from the server yet: count it, name it once it is.
            [`${chosen.length} chosen`, chosenSummary(chosenNames)].filter(Boolean).join(' · ')}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-card px-2.5 focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setStage(null)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (exact) void tap(exact)
              else if (offerNew) void addNew()
            }}
            placeholder={onCreate ? 'Search roles, or type a new one…' : 'Search roles…'}
            aria-label="Search job roles"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {onCreate && (
          <Button type="button" size="sm" onClick={() => input.current?.focus()} className="shrink-0">
            <Plus /> Add new role
          </Button>
        )}
      </div>

      {offerNew && (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-2.5">
          <p className="text-sm font-medium">
            Add <span className="text-primary">“{newName}”</span> as a new role
          </p>
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Part of the job">
            {STAGE_ORDER.map((s) => {
              const on = s === newStage
              const tone = STAGE_TONE[s]
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setStage(s)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    on ? 'border-foreground bg-foreground text-background' : cn('border-border bg-card hover:bg-muted', TONE_TEXT[tone]),
                  )}
                >
                  <span className={cn('size-2 rounded-full', TONE_DOT[tone])} aria-hidden />
                  {STAGE_LABEL[s]}
                </button>
              )
            })}
            <Button type="button" size="sm" className="ml-auto" onClick={() => void addNew()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              Add role
            </Button>
          </div>
        </div>
      )}

      {pickable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {onCreate ? 'No job roles yet — type one above.' : 'No job roles yet. Ask the owner to add some.'}
        </p>
      ) : shown.length === 0 && !offerNew ? (
        <p className="text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        STAGE_ORDER.map((s) => {
          const inStage = shown
            .filter((r) => r.stage === s)
            .sort((a, b) => a.type_name.localeCompare(b.type_name))
          if (inStage.length === 0) return null
          const tone = STAGE_TONE[s]
          return (
            <div key={s}>
              <p className={cn('mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider', TONE_TEXT[tone])}>
                <span className={cn('size-2 rounded-full', TONE_DOT[tone])} aria-hidden />
                {STAGE_LABEL[s]}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {inStage.map((r) => {
                  const Icon = ROLE_ICON[roleKind(r.type_name)]
                  const on = chosen.includes(r.key)
                  return (
                    <ToneChip
                      key={r.key}
                      tone={tone}
                      label={r.type_name}
                      selected={on}
                      disabled={busy}
                      onClick={() => void tap(r)}
                      icon={on ? <Check className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
                    />
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
