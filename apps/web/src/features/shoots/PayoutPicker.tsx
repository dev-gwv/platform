import { useState } from 'react'
import { Check, ChevronDown, Minus, Plus } from 'lucide-react'
import type { PayoutMemory } from '@ipc/contracts'
import { cn } from '@/shared/ui/cn'
import { useINR } from '@/shared/money/MoneyMask'
import type { RateMember } from './assign'
import { nudge, payoutChoices } from './payout-choices'

/**
 * The payout for one booked person, picked with taps (owner, 11 Nov: "I should
 * be able to just click on it, and the dropdowns should happen. I should not
 * be using any keyboard"). A button, amber while empty and green once set; it
 * opens a panel in place (never a popover: this sits inside a dialog) with
 * their rates, what they were paid before, what the role usually gets and
 * round amounts, a ₹500 nudge, and "Other amount" for an odd figure.
 */
export function PayoutButton({
  value,
  open,
  onToggle,
  name,
}: {
  value: string
  open: boolean
  onToggle: () => void
  name: string
}) {
  const inr = useINR()
  const amount = Number(value)
  const set = value.trim() !== '' && Number.isFinite(amount)
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={set ? `Payout for ${name}: ${inr(amount)}. Change` : `Add payout for ${name}`}
      className={cn(
        'flex h-8 items-center gap-1 rounded-md border px-2 text-sm font-medium shadow-sm transition-colors',
        set ? 'border-success/50 bg-success/10 text-success hover:bg-success/15' : 'border-warning/60 bg-warning/10 text-warning hover:bg-warning/15',
        open && 'ring-2 ring-ring',
      )}
    >
      {set ? inr(amount) : '₹ Add payout'}
      <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
    </button>
  )
}

export function PayoutPanel({
  value,
  onPick,
  member,
  role,
  userId,
  memory,
}: {
  value: string
  /** The amount picked, and why ("paid Asha before"), or '' when cleared. */
  onPick: (amount: string, why?: string) => void
  member: Pick<RateMember, 'freelancer_rate' | 'rate_wedding_day' | 'rate_half_day'> & { name?: string | null }
  role: string
  userId: string
  memory: PayoutMemory | undefined
}) {
  const inr = useINR()
  const [other, setOther] = useState(false)
  const [typed, setTyped] = useState(value)
  const sections = payoutChoices(member, role, memory, userId)
  const current = Number(value) || 0
  return (
    <div className="mt-1 flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 shadow-sm" role="group" aria-label={`Payout for ${member.name ?? 'this person'}`}>
      {sections.map((s) => (
        <div key={s.title}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</p>
          <div className="flex flex-wrap gap-1.5">
            {s.choices.map((c) => {
              const on = current === c.amount
              return (
                <button
                  key={c.amount}
                  type="button"
                  onClick={() => onPick(String(c.amount), c.why || undefined)}
                  aria-pressed={on}
                  title={c.why || undefined}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium tabular-nums transition-colors',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:border-primary/60 hover:bg-primary/5',
                  )}
                >
                  {on && <Check className="size-3" aria-hidden />}
                  {inr(c.amount)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
        <div className="flex items-center gap-1 rounded-full border border-border bg-background p-0.5">
          <button type="button" aria-label="₹500 less" onClick={() => onPick(String(nudge(current, -1)))} disabled={current <= 0} className="rounded-full p-1.5 hover:bg-muted disabled:opacity-40">
            <Minus className="size-3.5" />
          </button>
          <span className="min-w-16 text-center text-sm font-semibold tabular-nums">{current > 0 ? inr(current) : '₹0'}</span>
          <button type="button" aria-label="₹500 more" onClick={() => onPick(String(nudge(current, 1)))} className="rounded-full p-1.5 hover:bg-muted">
            <Plus className="size-3.5" />
          </button>
        </div>
        {other ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              onPick(typed.replace(/[^\d.]/g, ''))
            }}
          >
            <input
              autoFocus
              inputMode="decimal"
              aria-label="Other amount"
              value={typed}
              onChange={(e) => setTyped(e.target.value.replace(/[^\d.]/g, ''))}
              className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
            />
            <button type="submit" className="h-8 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground">
              Use
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setOther(true)} className="text-sm font-medium text-primary hover:underline">
            Other amount
          </button>
        )}
        {value && (
          <button type="button" onClick={() => onPick('')} className="ml-auto text-xs text-muted-foreground hover:text-destructive">
            No payout
          </button>
        )}
      </div>
    </div>
  )
}
