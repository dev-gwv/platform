import { Link } from '@tanstack/react-router'
import { AlarmClock } from 'lucide-react'
import type { MyDueItem } from '@ipc/contracts'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { cn } from '../ui/cn'
import { DUE_TONE_CLASS, daysLeftText, dueTone } from '../ui/days-left'
import { useMyDue } from '@/features/my-work/api'

/**
 * What is coming due, in the top bar: "1 late" in red, else "3 due soon" in
 * amber; nothing when nothing is close. Tap it for the list -- late, today,
 * the next few days -- each line opening the thing itself.
 */
export function DueChip() {
  const { data } = useMyDue()
  const items = data ?? []
  if (items.length === 0) return null
  const late = items.filter((i) => i.days < 0).length
  const tone = late > 0 ? 'late' : 'soon'
  const groups: { label: string; rows: MyDueItem[] }[] = [
    { label: 'Late', rows: items.filter((i) => i.days < 0) },
    { label: 'Today', rows: items.filter((i) => i.days === 0) },
    { label: 'Next few days', rows: items.filter((i) => i.days > 0) },
  ].filter((g) => g.rows.length > 0)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={late > 0 ? `${late} late` : `${items.length} due soon`}
          className={cn('flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold', DUE_TONE_CLASS[tone])}
        >
          <AlarmClock className="size-3.5" aria-hidden />
          <span className="hidden sm:inline min-[1800px]:hidden">{late > 0 ? `${late} late` : `${items.length} due`}</span>
          <span className="hidden min-[1800px]:inline">{late > 0 ? `${late} late` : `${items.length} due soon`}</span>
          <span className="sm:hidden">{late > 0 ? late : items.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
              <ul className="flex flex-col">
                {g.rows.map((i) => (
                  <li key={`${i.kind}:${i.id}`}>
                    <DueLine item={i} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DueLine({ item }: { item: MyDueItem }) {
  const tone = dueTone(item.days)
  const body = (
    <span className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[item.project_name, item.who].filter(Boolean).join(' · ') || (item.kind === 'task' ? 'Task' : 'Edit')}
        </span>
      </span>
      <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold', DUE_TONE_CLASS[tone])}>
        {daysLeftText(item.days)}
      </span>
    </span>
  )
  if (item.kind === 'task') return <Link to="/tasks" search={{ open: item.id } as never}>{body}</Link>
  if (item.mine) return <Link to="/my-work" search={{ d: item.id } as never}>{body}</Link>
  return item.project_id ? (
    <Link to="/projects/$id" params={{ id: item.project_id }} search={{ tab: 'deliverables', d: item.id } as never}>
      {body}
    </Link>
  ) : (
    body
  )
}
