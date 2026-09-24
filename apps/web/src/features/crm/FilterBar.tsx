import { useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronDown, Users } from 'lucide-react'
import type { CrmLead, CrmStatsQuery } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { Input, Label } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { isoDay } from './tabs/shared'
import { daysBack } from './tabs/DateRange'

/**
 * The two questions every number on this page is an answer to: which leads,
 * and over what dates.
 *
 * They were asked separately and inconsistently -- Reports, Forecast and Per
 * person each owned a date picker, so setting one left the other two on their
 * own defaults and the three sections disagreed on screen. One bar, one
 * answer, read by everything below it.
 */

export const ALL_GROUPS = '__all__'
export const NO_GROUP = '__none__'

/** Every group a studio has actually typed on a lead, in the order it reads. */
export function groupsOf(leads: readonly CrmLead[]): string[] {
  const seen = new Set<string>()
  for (const l of leads) {
    const g = l.group_name?.trim()
    if (g) seen.add(g)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/** Narrow a list to one group. `group_name` was writable in two places and read by nothing. */
export function inGroup(leads: readonly CrmLead[], group: string): CrmLead[] {
  if (group === ALL_GROUPS) return [...leads]
  if (group === NO_GROUP) return leads.filter((l) => !l.group_name?.trim())
  return leads.filter((l) => l.group_name?.trim() === group)
}

const PRESETS: ReadonlyArray<{ label: string; range: () => CrmStatsQuery }> = [
  { label: 'Last 7 days', range: () => daysBack(6) },
  { label: 'Last 30 days', range: () => daysBack(29) },
  {
    label: 'This month',
    range: () => {
      const now = new Date()
      return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) }
    },
  },
  {
    label: 'Last month',
    range: () => {
      const now = new Date()
      return {
        from: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    },
  },
  { label: 'Last 90 days', range: () => daysBack(89) },
]

const pretty = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

function presetLabel(range: CrmStatsQuery): string {
  const hit = PRESETS.find((p) => {
    const r = p.range()
    return r.from === range.from && r.to === range.to
  })
  return hit?.label ?? 'Custom'
}

/** A wide bar that opens a panel, rather than a select that hides its options. */
function Bar({
  icon: Icon,
  title,
  detail,
  open,
  onToggle,
  children,
}: {
  icon: typeof Users
  title: string
  detail?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent',
          open && 'border-primary/50',
        )}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{title}</span>
          {detail && <span className="ml-2 text-muted-foreground">{detail}</span>}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-border bg-card p-2 shadow-lg">
          {children}
        </div>
      )}
    </div>
  )
}

export function CrmFilterBar({
  leads,
  group,
  onGroup,
  range,
  onRange,
}: {
  leads: readonly CrmLead[]
  group: string
  onGroup: (g: string) => void
  range: CrmStatsQuery
  onRange: (r: CrmStatsQuery) => void
}) {
  const [openBar, setOpenBar] = useState<'group' | 'range' | null>(null)
  const groups = useMemo(() => groupsOf(leads), [leads])
  const ungrouped = useMemo(() => leads.filter((l) => !l.group_name?.trim()).length, [leads])

  const options: Array<{ value: string; label: string; count: number }> = [
    { value: ALL_GROUPS, label: 'All groups', count: leads.length },
    ...groups.map((g) => ({ value: g, label: g, count: leads.filter((l) => l.group_name?.trim() === g).length })),
    ...(ungrouped > 0 ? [{ value: NO_GROUP, label: 'No group', count: ungrouped }] : []),
  ]
  const current = options.find((o) => o.value === group) ?? options[0]!

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Bar
        icon={Users}
        title={current.label}
        detail={`${current.count} lead${current.count === 1 ? '' : 's'}`}
        open={openBar === 'group'}
        onToggle={() => setOpenBar((v) => (v === 'group' ? null : 'group'))}
      >
        {groups.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No groups yet — put a word in a lead&rsquo;s Group field (&ldquo;Wedding 2027&rdquo;, &ldquo;Corporate&rdquo;) and it appears here.
          </p>
        )}
        <ul className="max-h-64 overflow-y-auto">
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => {
                  onGroup(o.value)
                  setOpenBar(null)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Check className={cn('size-3.5 shrink-0', o.value === group ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </Bar>

      <Bar
        icon={CalendarDays}
        title={presetLabel(range)}
        detail={`${pretty(range.from)} – ${pretty(range.to)}`}
        open={openBar === 'range'}
        onToggle={() => setOpenBar((v) => (v === 'range' ? null : 'range'))}
      >
        <div className="flex flex-wrap gap-1 p-1">
          {PRESETS.map((p) => {
            const r = p.range()
            const active = r.from === range.from && r.to === range.to
            return (
              <Button
                key={p.label}
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => {
                  onRange(r)
                  setOpenBar(null)
                }}
              >
                {p.label}
              </Button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-border p-2 pt-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="crm-bar-from">From</Label>
            <Input
              id="crm-bar-from"
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => e.target.value && onRange({ ...range, from: e.target.value })}
              className="w-36"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="crm-bar-to">To</Label>
            <Input
              id="crm-bar-to"
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => e.target.value && onRange({ ...range, to: e.target.value })}
              className="w-36"
            />
          </div>
        </div>
      </Bar>
    </div>
  )
}
