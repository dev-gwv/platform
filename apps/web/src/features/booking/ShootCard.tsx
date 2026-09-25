import { Link } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Clock, MapPin, UserPlus, Users } from 'lucide-react'
import type { ShootListItem, TeamSlot } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Button } from '@/shared/ui/button'
import { RowMenu, type RowMenuItem } from '@/shared/ui/row-menu'
import { formatINR } from '@/shared/ui/format'
import { cn } from '@/shared/ui/cn'
import { hoursLabel } from '@/features/shoots/assign'
import { roleCards, staffing, type Fill, type RoleCard } from './booking-model'

const FILL_TONE: Record<Fill, { card: string; pill: string }> = {
  full: { card: 'border-tone-green/30 bg-tone-green-soft/50', pill: 'bg-tone-green-soft text-tone-green' },
  partial: { card: 'border-tone-amber/40 bg-tone-amber-soft/60', pill: 'bg-tone-amber-soft text-tone-amber' },
  empty: { card: 'border-tone-rose/40 bg-tone-rose-soft/60', pill: 'bg-tone-rose-soft text-tone-rose' },
}

const COST_TONE = { not_decided: 'text-muted-foreground', tentative: 'text-tone-amber', final: 'text-tone-green' } as const

const dateParts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return {
    month: d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase(),
    day: d.getDate(),
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase(),
  }
}

/**
 * One shoot and its crew, role by role: who is on each role (face, name,
 * hours), what is still open, and the one button that fills it.
 */
export function ShootCard({
  shoot,
  slots,
  canPlan,
  menuFor,
  onAssign,
}: {
  shoot: ShootListItem
  slots: readonly TeamSlot[]
  canPlan: boolean
  menuFor: (s: TeamSlot) => RowMenuItem[]
  onAssign: (shoot: ShootListItem, role?: string) => void
}) {
  const { cards, extra } = roleCards(shoot, slots)
  const st = staffing(shoot, slots)
  const d = shoot.shoot_date ? dateParts(shoot.shoot_date) : null
  const time = shoot.start_at
    ? new Date(shoot.start_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <article
      aria-label={shoot.name}
      className={cn(
        'rounded-2xl border bg-card shadow-sm',
        st.state === 'full' ? 'border-tone-green/30' : st.state === 'empty' ? 'border-tone-rose/30' : 'border-border',
      )}
    >
      <header className="flex flex-wrap items-start gap-3 p-4">
        {d && (
          <div className="flex w-16 shrink-0 flex-col items-center rounded-xl border border-border bg-muted/40 py-2 text-center">
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">{d.month}</span>
            <span className="text-2xl font-bold leading-tight tabular-nums">{d.day}</span>
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">{d.weekday}</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-tight">
            <Link to="/shoots/$shootId" params={{ shootId: shoot.id }} className="hover:text-primary hover:underline">
              {shoot.name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            <Link to="/projects/$id" params={{ id: shoot.project_id }} className="hover:text-primary hover:underline">
              {shoot.project_name ?? 'Project'}
            </Link>
            {shoot.client_name ? ` · ${shoot.client_name}` : ''}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {time && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden /> {time}
              </span>
            )}
            {shoot.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {shoot.map_link ? (
                  <a href={shoot.map_link} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
                    {shoot.location}
                  </a>
                ) : (
                  shoot.location
                )}
              </span>
            )}
            {st.needed > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden /> {st.filled}/{st.needed} assigned
              </span>
            )}
          </p>
        </div>
        <StaffingBadge state={st.state} filled={st.filled} needed={st.needed} />
      </header>

      <div className="border-t border-border p-3 sm:p-4">
        {cards.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            <span>No requirements yet. Add roles in the shoot first.</span>
            <Button asChild size="sm" variant="outline">
              <Link to="/shoots/$shootId" params={{ shootId: shoot.id }}>
                Open shoot
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {cards.map((c) => (
              <RoleCardView key={c.name} card={c} canPlan={canPlan} menuFor={menuFor} onAssign={() => onAssign(shoot, c.name)} />
            ))}
          </div>
        )}
        {extra.length > 0 && (
          <div className="mt-3 rounded-xl border border-dashed border-border p-3">
            <p className="text-xs font-semibold text-muted-foreground">Also booked (on a role this shoot does not list)</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {extra.map((s) => (
                <BookedPerson key={s.id} slot={s} canPlan={canPlan} menu={menuFor(s)} showRole />
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  )
}

function StaffingBadge({ state, filled, needed }: { state: ReturnType<typeof staffing>['state']; filled: number; needed: number }) {
  const base = 'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold'
  if (state === 'none') return <span className={cn(base, 'border-border bg-muted text-muted-foreground')}>No roles</span>
  if (state === 'full')
    return (
      <span className={cn(base, 'border-tone-green/30 bg-tone-green-soft text-tone-green')}>
        <CheckCircle2 className="size-3.5" aria-hidden /> Fully booked
      </span>
    )
  if (state === 'empty')
    return (
      <span className={cn(base, 'border-tone-rose/30 bg-tone-rose-soft text-tone-rose')}>
        <AlertTriangle className="size-3.5" aria-hidden /> Team needed
      </span>
    )
  return (
    <span className={cn(base, 'border-tone-amber/30 bg-tone-amber-soft text-tone-amber')}>
      <Users className="size-3.5" aria-hidden /> {filled}/{needed} booked
    </span>
  )
}

function RoleCardView({
  card,
  canPlan,
  menuFor,
  onAssign,
}: {
  card: RoleCard
  canPlan: boolean
  menuFor: (s: TeamSlot) => RowMenuItem[]
  onAssign: () => void
}) {
  const tone = FILL_TONE[card.fill]
  const filled = card.quantity - card.open
  return (
    <section aria-label={`${card.name}: ${filled} of ${card.quantity}`} className={cn('flex flex-col rounded-xl border p-3', tone.card)}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-snug">{card.name}</h4>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', tone.pill)}>
          {filled}/{card.quantity}
        </span>
      </div>
      {card.people.length === 0 ? (
        <p className="mt-1.5 text-sm text-tone-rose">Not assigned yet</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {card.people.map((s) => (
            <BookedPerson key={s.id} slot={s} canPlan={canPlan} menu={menuFor(s)} />
          ))}
        </ul>
      )}
      {card.open > 0 && card.people.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {card.open} more needed
        </p>
      )}
      {canPlan && (
        <Button
          size="sm"
          variant={card.fill === 'empty' ? 'destructive' : card.fill === 'partial' ? 'default' : 'outline'}
          className="mt-3 w-full"
          onClick={onAssign}
        >
          <UserPlus /> {card.fill === 'full' ? 'Manage' : card.fill === 'partial' ? 'Assign remaining' : 'Assign'}
        </Button>
      )}
    </section>
  )
}

/** A booked person: face, name, hours -- and, for whoever plans crew, the payout. */
export function BookedPerson({ slot, canPlan, menu, showRole = false }: { slot: TeamSlot; canPlan: boolean; menu: RowMenuItem[]; showRole?: boolean }) {
  const pay = slot.final_cost ?? slot.estimated_cost
  return (
    <li className="flex items-center gap-2 rounded-lg bg-card/90 px-2 py-1.5 shadow-sm">
      <Avatar name={slot.user_name} size="sm" />
      <div className="min-w-0 flex-1">
        <Link
          to="/team-allocation/member/$uid"
          params={{ uid: slot.user_id }}
          className="block truncate text-sm font-medium hover:text-primary hover:underline"
        >
          {slot.user_name ?? 'Someone'}
        </Link>
        <p className="truncate text-[11px] text-muted-foreground">
          {showRole && slot.service_name ? `${slot.service_name} · ` : ''}
          {hoursLabel(slot)}
          {canPlan && (
            <span className={cn('ml-1', COST_TONE[slot.cost_status])}>
              · {pay != null && slot.cost_status !== 'not_decided' ? `${formatINR(pay)} ${slot.cost_status}` : 'Payout not added'}
            </span>
          )}
        </p>
      </div>
      {menu.length > 0 && <RowMenu label={`More for ${slot.user_name ?? 'this booking'}`} items={menu} />}
    </li>
  )
}
