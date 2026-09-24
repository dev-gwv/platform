import { cn } from '../ui/cn'

export interface SectionTab<T extends string> {
  value: T
  label: string
}

/**
 * Module-level tabs — the bar under a page title that switches between two
 * views of the same subject (Directory ↔ Salaries). Distinct from FilterTabs,
 * which narrows one list: this one changes what the list IS, so it sits on the
 * page surface and takes the accent when selected.
 */
export function SectionTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  variant = 'pill',
  label,
}: {
  tabs: ReadonlyArray<SectionTab<T>>
  value: T
  onChange: (v: T) => void
  className?: string
  /**
   * 'pill' is the filled bar this app has used everywhere. 'underline' is the
   * quieter one that sits directly under a page title -- the tabs read as part
   * of the heading rather than as a control competing with it, which matters
   * on a page whose first job is to show a list.
   */
  variant?: 'pill' | 'underline'
  label?: string
}) {
  if (variant === 'underline') {
    return (
      <div
        role="tablist"
        aria-label={label}
        className={cn('flex gap-6 overflow-x-auto border-b border-border', className)}
      >
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative whitespace-nowrap px-1 pb-3 pt-2 text-sm font-medium transition-colors',
              value === t.value
                ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex gap-1 rounded-lg border border-border bg-card p-1.5', className)}
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            value === t.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
