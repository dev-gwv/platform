import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Wrench } from 'lucide-react'
import type { TeamSlot } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/input'
import { MetricCard } from '@/shared/ui/metric-card'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { cn } from '@/shared/ui/cn'
import { hoursLabel } from '@/features/shoots/assign'
import { CONFLICT_LABEL, type ConflictItem, type ConflictSeverity, type ConflictType } from './booking-model'

const SEVERITY: Record<ConflictSeverity, { label: string; tone: string; icon: typeof Info }> = {
  critical: { label: 'Critical', tone: 'border-tone-rose/40 bg-tone-rose-soft text-tone-rose', icon: AlertOctagon },
  warning: { label: 'Warning', tone: 'border-tone-amber/40 bg-tone-amber-soft text-tone-amber', icon: AlertTriangle },
  info: { label: 'Info', tone: 'border-tone-blue/40 bg-tone-blue-soft text-tone-blue', icon: Info },
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * What needs a second look this month, worst first, each with a way to fix
 * it: the booking opens for editing, and the shoot and the person are one tap
 * away. It empties as things are fixed -- nothing to dismiss by hand.
 */
export function ConflictsView({
  items,
  canPlan,
  menuFor,
  onFix,
}: {
  items: ConflictItem[]
  canPlan: boolean
  menuFor: (s: TeamSlot) => RowMenuItem[]
  onFix: (s: TeamSlot) => void
}) {
  const [severity, setSeverity] = useState<'' | ConflictSeverity>('')
  const [type, setType] = useState<'' | ConflictType>('')
  const shown = useMemo(
    () => items.filter((i) => (!severity || i.severity === severity) && (!type || i.type === type)),
    [items, severity, type],
  )
  const count = (s: ConflictSeverity) => items.filter((i) => i.severity === s).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="All" value={items.length} tone={items.length ? 'accent' : 'muted'} hint="this month" />
        <MetricCard label="Critical" value={count('critical')} tone={count('critical') ? 'danger' : 'muted'} hint="double bookings, bad times" />
        <MetricCard label="Warnings" value={count('warning') + count('info')} tone={count('warning') ? 'warning' : 'muted'} hint="missing links, stale" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={severity} onChange={(e) => setSeverity(e.target.value as '' | ConflictSeverity)} aria-label="Filter by severity" className="w-40">
          <option value="">Any severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value as '' | ConflictType)} aria-label="Filter by type" className="w-52">
          <option value="">Every kind</option>
          {(Object.keys(CONFLICT_LABEL) as ConflictType[]).map((k) => (
            <option key={k} value={k}>
              {CONFLICT_LABEL[k]}
            </option>
          ))}
        </Select>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border p-10 text-center">
          <CheckCircle2 className="size-8 text-tone-green" aria-hidden />
          <p className="font-semibold">{items.length === 0 ? 'No conflicts this month' : 'Nothing matches these filters'}</p>
          <p className="text-sm text-muted-foreground">Nobody is booked twice, and every booking has a shoot and a role.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((c) => {
            const sev = SEVERITY[c.severity]
            const Icon = sev.icon
            return (
              <li key={c.key} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start gap-3">
                  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', sev.tone)}>
                    <Icon className="size-3.5" aria-hidden /> {sev.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.message}</p>
                    <p className="text-xs text-muted-foreground">{CONFLICT_LABEL[c.type]}</p>
                  </div>
                  {canPlan && (
                    <Button size="sm" onClick={() => onFix(c.slot)}>
                      <Wrench /> Fix
                    </Button>
                  )}
                </div>
                <ul className="mt-3 flex flex-col gap-2">
                  {[c.slot, ...(c.other ? [c.other] : [])].map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                      <Link to="/team-allocation/member/$uid" params={{ uid: s.user_id }} className="font-medium hover:text-primary hover:underline">
                        {s.user_name ?? 'Someone'}
                      </Link>
                      <span className="text-muted-foreground">
                        {dayLabel(s.start_at)} · {hoursLabel(s)}
                        {s.service_name ? ` · ${s.service_name}` : ''}
                      </span>
                      {s.shoot_id ? (
                        <Link to="/shoots/$shootId" params={{ shootId: s.shoot_id }} className="text-primary hover:underline">
                          {s.shoot_name ?? 'Shoot'}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">No shoot</span>
                      )}
                      <span className="ml-auto">
                        <RowMenu label={`More for ${s.user_name ?? 'this booking'}`} items={menuFor(s)} />
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
