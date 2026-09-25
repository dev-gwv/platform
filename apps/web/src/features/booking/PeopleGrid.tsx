import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { TeamMember, TeamSlot } from '@ipc/contracts'
import { Avatar } from '@/shared/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import type { RowMenuItem } from '@/shared/ui/row-menu'
import { cn } from '@/shared/ui/cn'
import { hoursLabel } from '@/features/shoots/assign'
import { monthDays, monthGrid, todayLocal, type PersonMonth } from './booking-model'

/**
 * The month for everyone at once: a row per person, a column per day, a
 * chip on every day they are out. Busiest first; anyone free all month says
 * so. The name column stays put while the days scroll.
 */
export function PeopleGrid({
  month,
  members,
  slots,
  q,
  menuFor,
}: {
  month: string
  members: readonly TeamMember[]
  slots: readonly TeamSlot[]
  q: string
  menuFor: (s: TeamSlot) => RowMenuItem[]
}) {
  const days = monthDays(month)
  const today = todayLocal()
  const rows = useMemo(() => {
    const all = monthGrid(members, slots, month)
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (r) =>
        r.member.name.toLowerCase().includes(needle) ||
        r.member.role_names.some((n) => n.toLowerCase().includes(needle)) ||
        [...r.byDay.values()].flat().some((s) => `${s.shoot_name ?? ''} ${s.project_name ?? ''} ${s.service_name ?? ''}`.toLowerCase().includes(needle)),
    )
  }, [members, slots, month, q])

  // Open on this week, not on the 1st: the days that matter today are in view.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    const cell = box?.querySelector<HTMLElement>(`[data-day="${today}"]`)
    if (!box || !cell) return
    const name = box.querySelector<HTMLElement>('thead th')?.offsetWidth ?? 0
    box.scrollLeft = Math.max(0, cell.offsetLeft - name - cell.offsetWidth * 2)
  }, [month, today, rows.length])

  if (members.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No active team members yet.</p>
  }

  return (
    <div ref={scroller} className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="table-fixed border-separate border-spacing-0 text-xs" style={{ width: `max(100%, calc(14rem + ${days.length} * 3.25rem))` }}>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-20 border-b border-r border-border bg-card px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ width: '14rem' }}>
              Team member
            </th>
            {days.map((d) => {
              const date = new Date(`${d}T00:00:00`)
              const weekend = date.getDay() === 0 || date.getDay() === 6
              return (
                <th
                  key={d}
                  scope="col"
                  data-day={d}
                  className={cn(
                    'border-b border-border px-1 py-1.5 text-center font-medium',
                    d === today ? 'bg-primary text-primary-foreground' : weekend ? 'bg-muted/60 text-muted-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span className="block text-[10px] uppercase">{date.toLocaleDateString('en-IN', { weekday: 'narrow' })}</span>
                  <span className="block text-sm tabular-nums">{date.getDate()}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <PersonRow key={r.member.user_id} row={r} days={days} today={today} menuFor={menuFor} />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={days.length + 1} className="p-6 text-center text-sm text-muted-foreground">
                Nobody matches that search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function PersonRow({ row, days, today, menuFor }: { row: PersonMonth; days: string[]; today: string; menuFor: (s: TeamSlot) => RowMenuItem[] }) {
  const free = row.days === 0
  return (
    <tr className="group">
      <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2 text-left align-top font-normal group-hover:bg-muted/40">
        <div className="flex items-start gap-2">
          <Avatar name={row.member.name} size="sm" />
          <div className="min-w-0">
            <Link
              to="/team-allocation/member/$uid"
              params={{ uid: row.member.user_id }}
              className="block truncate text-sm font-semibold hover:text-primary hover:underline"
            >
              {row.member.name}
            </Link>
            {row.member.role_names.length > 0 && (
              <p className="truncate text-[11px] text-muted-foreground">{row.member.role_names.slice(0, 2).join(', ')}</p>
            )}
            <p className="mt-0.5 text-[11px]">
              {free ? (
                <span className="rounded-full bg-tone-green-soft px-1.5 py-0.5 font-semibold text-tone-green">Free this month</span>
              ) : (
                <span className="text-muted-foreground">
                  <b className="font-semibold text-foreground">{row.shoots}</b> shoot{row.shoots === 1 ? '' : 's'} · {row.days} day{row.days === 1 ? '' : 's'} · {row.hours} h
                </span>
              )}
            </p>
          </div>
        </div>
      </th>
      {days.map((d) => {
        const list = row.byDay.get(d) ?? []
        return (
          <td key={d} className={cn('border-b border-border p-0.5 align-top', d === today && 'bg-primary/5')}>
            {list.length > 0 && <DayCell day={d} person={row.member.name} list={list} menuFor={menuFor} />}
          </td>
        )
      })}
    </tr>
  )
}

function DayCell({ day, person, list, menuFor }: { day: string; person: string; list: TeamSlot[]; menuFor: (s: TeamSlot) => RowMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const booked = list.filter((s) => s.status === 'booked')
  const label = new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${person}, ${label}: ${list.map((s) => s.shoot_name ?? 'booked').join(', ')}`}
          className={cn(
            'flex h-full min-h-9 w-full flex-col gap-0.5 rounded-md px-1 py-1 text-left text-[10px] font-semibold leading-tight transition-colors',
            booked.length > 1
              ? 'bg-tone-rose-soft text-tone-rose ring-1 ring-tone-rose/40'
              : booked.length === 1
                ? 'bg-tone-green-soft text-tone-green hover:ring-1 hover:ring-tone-green/40'
                : 'bg-muted text-muted-foreground line-through',
          )}
        >
          {list.slice(0, 2).map((s) => (
            <span key={s.id} className="block truncate">
              {s.shoot_name ?? s.service_name ?? 'Booked'}
            </span>
          ))}
          {list.length > 2 && <span className="block">+{list.length - 2}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <p className="px-1 pb-1 text-xs font-semibold text-muted-foreground">
          {person} · {label}
        </p>
        <ul className="flex flex-col gap-2">
          {list.map((s) => (
            <li key={s.id} className="rounded-lg border border-border p-2">
              <p className="text-sm font-semibold">{s.shoot_name ?? 'Blocked time'}</p>
              <p className="text-xs text-muted-foreground">
                {[s.service_name, hoursLabel(s), s.project_name].filter(Boolean).join(' · ')}
                {s.status !== 'booked' && <span className="ml-1 font-semibold">· {s.status}</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {menuFor(s).map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      m.onSelect()
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-[11px] font-medium hover:bg-muted [&_svg]:size-3"
                  >
                    {m.icon}
                    {m.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
