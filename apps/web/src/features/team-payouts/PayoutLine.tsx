import { CheckCircle2, IndianRupee } from 'lucide-react'
import type { PaySlotRequest, SlotPayStatus } from '@ipc/contracts'
import { Input } from '@/shared/ui/input'
import { cn } from '@/shared/ui/cn'
import { useINR } from '@/shared/money/MoneyMask'

export type PayoutChoice = 'later' | 'full' | 'part'
export interface PayoutDraft {
  /** What this booking pays, as typed; starts from the booked amount. */
  amount: string
  choice: PayoutChoice
  /** Paid now, when only part of it is. */
  part: string
}

export function startPayout(status: SlotPayStatus | undefined): PayoutDraft {
  return { amount: status && status.amount > 0 ? String(status.amount) : '', choice: 'later', part: '' }
}

/**
 * What to send for a payout line, or null when nothing changed: a new
 * amount becomes the final amount, "Paid in full" pays what is still
 * outstanding, "Part paid" pays what was typed.
 */
export function payoutRequest(draft: PayoutDraft, status: SlotPayStatus, today: string): PaySlotRequest | null {
  const typed = draft.amount.trim() === '' ? status.amount : Number(draft.amount)
  const amount = Number.isFinite(typed) && typed >= 0 ? Math.round(typed * 100) / 100 : status.amount
  const changed = Math.abs(amount - status.amount) > 0.001
  const outstanding = Math.max(0, amount - status.paid)
  const part = Number(draft.part)
  const paidNow =
    draft.choice === 'full' ? outstanding : draft.choice === 'part' && Number.isFinite(part) && part > 0 ? Math.min(part, outstanding) : 0
  if (!changed && paidNow <= 0) return null
  return {
    ...(changed ? { amount } : {}),
    paid_now: Math.round(paidNow * 100) / 100,
    ...(paidNow > 0 ? { paid_date: today } : {}),
  }
}

/**
 * "{Name}'s payout ₹__ · Pay later / Paid in full / Part paid" -- paying a
 * freelancer at the moment their cards are copied. The amount starts from
 * what the booking pays and can be changed here; amber until it is paid,
 * green once it is.
 */
export function PayoutLine({
  name,
  status,
  value,
  onChange,
}: {
  name: string
  status: SlotPayStatus
  value: PayoutDraft
  onChange: (next: PayoutDraft) => void
}) {
  const inr = useINR()
  const typed = value.amount.trim() === '' ? status.amount : Number(value.amount) || 0
  const outstanding = Math.max(0, typed - status.paid)
  const settled = status.paid > 0 && outstanding <= 0.001
  const done = settled || value.choice === 'full'
  const chip = (on: boolean) =>
    cn(
      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
      on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card text-foreground hover:bg-muted',
    )

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        done ? 'border-success/40 bg-success/[0.06]' : 'border-dashed border-warning/60 bg-warning/[0.06]',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <IndianRupee className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{name}’s payout</span>
        <Input
          aria-label={`${name}'s payout`}
          inputMode="decimal"
          className="h-8 w-28"
          value={value.amount}
          placeholder="Amount"
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
        />
        {status.paid > 0 && (
          <span className="text-xs text-muted-foreground">
            {settled ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="size-3.5" aria-hidden /> Paid {inr(status.paid)}
              </span>
            ) : (
              `${inr(status.paid)} paid so far`
            )}
          </span>
        )}
      </div>
      {!settled && (
        <div role="group" aria-label="Payment" className="flex flex-wrap items-center gap-1.5">
          <button type="button" aria-pressed={value.choice === 'later'} className={chip(value.choice === 'later')} onClick={() => onChange({ ...value, choice: 'later' })}>
            Pay later
          </button>
          <button type="button" aria-pressed={value.choice === 'full'} className={chip(value.choice === 'full')} onClick={() => onChange({ ...value, choice: 'full' })}>
            Paid {outstanding > 0 ? inr(outstanding) : 'in full'}
          </button>
          <button type="button" aria-pressed={value.choice === 'part'} className={chip(value.choice === 'part')} onClick={() => onChange({ ...value, choice: 'part' })}>
            Part paid
          </button>
          {value.choice === 'part' && (
            <Input
              aria-label="Paid now"
              inputMode="decimal"
              className="h-8 w-28"
              value={value.part}
              placeholder="₹ paid now"
              onChange={(e) => onChange({ ...value, part: e.target.value })}
            />
          )}
        </div>
      )}
    </div>
  )
}
