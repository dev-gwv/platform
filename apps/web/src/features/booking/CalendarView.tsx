import type { ShootListItem, TeamSlot } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { calendarWeeks, dayFill, todayLocal } from './booking-model'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Team Booking's month on a calendar: each day lists its shoots. A day stays
 * plain until every shoot on it has its team, then turns green; a day still
 * short says how many seats are open, quietly. Tapping a shoot opens Assign
 * team.
 */
export function CalendarView({
  month,
  shoots,
  slots,
  onOpen,
}: {
  month: string
  shoots: readonly ShootListItem[]
  slots: readonly TeamSlot[]
  onOpen: (shoot: ShootListItem) => void
}) {
  const weeks = calendarWeeks(month)
  const today = todayLocal()
  const byDay = new Map<string, ShootListItem[]>()
  for (const s of shoots) if (s.shoot_date) byDay.set(s.shoot_date, [...(byDay.get(s.shoot_date) ?? []), s])

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="grid min-w-[44rem] grid-cols-7 border-b border-border text-xs font-semibold text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-w-[44rem] grid-cols-7">
        {weeks.flat().map((day, i) => {
          if (!day) return <div key={`pad-${i}`} className="min-h-24 border-b border-r border-border bg-muted/30" />
          const list = byDay.get(day) ?? []
          const fill = dayFill(list, slots)
          return (
            <div
              key={day}
              className={cn(
                'flex min-h-24 flex-col gap-1 border-b border-r border-border p-1.5',
                fill.full && 'bg-success/[0.08]',
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'text-xs font-semibold',
                    day === today ? 'flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {list.length > 0 &&
                  (fill.full ? (
                    <span className="text-[10px] font-semibold text-success">Team set</span>
                  ) : fill.open > 0 ? (
                    <span className="text-[10px] text-muted-foreground">{fill.open} to fill</span>
                  ) : null)}
              </div>
              {list.slice(0, 3).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onOpen(s)}
                  title={[s.name, s.project_name].filter(Boolean).join(' · ')}
                  className="truncate rounded-md border border-border bg-background px-1.5 py-0.5 text-left text-xs hover:border-primary/50 hover:bg-primary/5"
                >
                  <span className="font-medium">{s.name}</span>
                  {s.project_name && <span className="text-muted-foreground"> · {s.project_name}</span>}
                </button>
              ))}
              {list.length > 3 && <span className="text-[10px] text-muted-foreground">+{list.length - 3} more</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
