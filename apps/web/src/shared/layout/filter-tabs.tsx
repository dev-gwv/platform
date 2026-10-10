import { cn } from '../ui/cn'

interface FilterTab<T extends string> {
  value: T
  label: string
  count?: number | undefined
}

/** Locked primitive — segmented filter control used on list pages. */
export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: ReadonlyArray<FilterTab<T>>
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex gap-1 rounded-lg bg-muted p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === t.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs opacity-70">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
