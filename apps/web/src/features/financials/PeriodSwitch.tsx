import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { PERIOD_CHOICES, choiceLabel } from './period'
import type { UsePeriod } from './use-period'

/**
 * The money pages' one period switch (see usePeriod): the same pills on
 * Invoices, Payments received, Expenses, Profit & Loss and Reports, and the
 * same choice on all of them. `onChange` runs after a pick (e.g. back to
 * page 1).
 */
export function PeriodSwitch({ p, onChange, className }: { p: UsePeriod; onChange?: () => void; className?: string }) {
  const pick = (...args: Parameters<UsePeriod['set']>) => {
    p.set(...args)
    onChange?.()
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="tablist" aria-label="Period">
      {PERIOD_CHOICES.map((k) => (
        <Pill key={k} on={p.choice === k} onClick={() => pick(k)}>
          {choiceLabel(k)}
        </Pill>
      ))}
      <Pill on={p.choice === 'custom'} onClick={() => pick('custom', { from: p.from, to: p.to })}>
        Custom
      </Pill>
      {p.choice === 'custom' && (
        <span className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="From date"
            value={p.custom.from || p.from}
            max={p.custom.to || p.to}
            onChange={(e) => e.target.value && pick('custom', { from: e.target.value, to: p.custom.to || p.to })}
            className="h-8 w-40"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={p.custom.to || p.to}
            min={p.custom.from || p.from}
            onChange={(e) => e.target.value && pick('custom', { from: p.custom.from || p.from, to: e.target.value })}
            className="h-8 w-40"
          />
        </span>
      )}
      {p.choice !== 'custom' && p.choice !== 'all' && <span className="text-xs text-muted-foreground">{p.label}</span>}
    </div>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn(
        'whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors',
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}
