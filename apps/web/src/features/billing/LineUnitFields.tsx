import { useId } from 'react'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'

/**
 * Words a studio counts a line in. Only suggestions: the box takes any word,
 * so a studio that rents "panels" or "running ft" types its own.
 */
export const UNIT_SUGGESTIONS = ['sq ft', 'sq m', 'running ft', 'hours', 'pcs', 'nos', 'sets', 'persons', 'km'] as const

/** What the quantity is counted in ("sq ft"), shared by the quote builder and the invoice editor. */
export function UnitInput({
  value,
  onChange,
  className,
  label,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  label: string
}) {
  const list = useId()
  return (
    <>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 20))}
        list={list}
        placeholder="e.g. sq ft"
        aria-label={label}
        className={cn('h-8 text-xs', className)}
      />
      <datalist id={list}>
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </>
  )
}

/** How many days the line runs. Empty means the line is not charged per day. */
export function DaysInput({ value, onChange, className, label }: { value: string; onChange: (v: string) => void; className?: string; label: string }) {
  return (
    <Input
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
      placeholder="—"
      title="Leave empty if this line is not charged per day"
      aria-label={label}
      className={cn('text-right', className)}
    />
  )
}
