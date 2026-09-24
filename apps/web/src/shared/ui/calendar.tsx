import type { ComponentProps } from 'react'
import { DayPicker, type DropdownProps } from 'react-day-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from './cn'
import { Select } from './select'

/**
 * A month you can read at a glance: rounded days, today ringed, the chosen day
 * a solid pill in the brand colour, the next and previous months' days faded.
 * Month and year are our own dropdowns, so jumping to a birthday in 1994 or a
 * wedding next October is two taps, not forty clicks of an arrow.
 */
export function Calendar({ className, classNames, ...props }: ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays
      weekStartsOn={1}
      captionLayout="dropdown"
      className={cn('select-none', className)}
      classNames={{
        months: 'relative flex flex-col',
        month: 'flex flex-col gap-3',
        month_caption: 'flex h-9 items-center pr-20',
        caption_label: 'hidden',
        dropdowns: 'flex items-center gap-1.5',
        nav: 'absolute right-0 top-0 z-10 flex h-9 items-center gap-1',
        button_previous:
          'flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30',
        button_next:
          'flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'flex h-8 w-9 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
        week: 'mt-1 flex',
        day: 'group size-9 p-0 text-center text-sm',
        day_button: cn(
          'flex size-9 items-center justify-center rounded-full tabular-nums transition-colors',
          'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'group-data-[selected=true]:bg-primary group-data-[selected=true]:font-semibold group-data-[selected=true]:text-primary-foreground group-data-[selected=true]:hover:bg-primary',
        ),
        today: '[&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-primary/40 [&>button]:font-semibold',
        outside: 'text-muted-foreground/50',
        disabled: 'pointer-events-none text-muted-foreground/30 line-through',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? <ChevronLeft className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />,
        Dropdown: CalendarDropdown,
      }}
      {...props}
    />
  )
}

/** Month / year pickers in the app's own dropdown, not the OS list. */
function CalendarDropdown({ options, value, onChange, 'aria-label': label, disabled }: DropdownProps) {
  return (
    <Select
      aria-label={label}
      value={value === undefined ? '' : String(value)}
      onChange={onChange}
      disabled={disabled}
      className="[&>button]:h-8 [&>button]:rounded-full [&>button]:border-transparent [&>button]:bg-muted [&>button]:text-sm [&>button]:font-semibold [&>button]:shadow-none"
    >
      {(options ?? []).map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </Select>
  )
}
