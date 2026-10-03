import { useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clapperboard,
  FileSignature,
  HardDrive,
  Inbox,
  Receipt,
  UserCheck,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { Plan, PlanQuote } from '@ipc/contracts'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { IconTile } from '@/shared/ui/icon-tile'
import { cn } from '@/shared/ui/cn'
import { formatINR } from '@/shared/ui/format'
import { COMPARE, INCLUDED, quoteWords, tierPlans, type Cell } from './plan-features'
import { perDay } from './usage'

const ICONS: Record<(typeof INCLUDED)[number]['icon'], LucideIcon> = {
  inbox: Inbox,
  'file-signature': FileSignature,
  receipt: Receipt,
  calendar: CalendarDays,
  clapperboard: Clapperboard,
  'hard-drive': HardDrive,
  'user-check': UserCheck,
  wallet: Wallet,
}

/**
 * Starter, Pro and Studio Max, kept easy on the eyes (owner, 3 Oct): a
 * yearly/monthly switch, three cards of at most three lines, one row of
 * "every plan has every feature" chips, and "Compare plans" -- closed until
 * pressed -- with only the rows that differ. Our own prices, so formatINR
 * (never masked). Used on Settings -> Subscription and the home page.
 */
export function PlanPicker({
  plans,
  quotes,
  onChoose,
  busy,
  canChoose = true,
  chooseHint,
}: {
  plans: Plan[]
  quotes?: PlanQuote[] | undefined
  onChoose: (p: Plan) => void
  busy?: boolean
  canChoose?: boolean
  chooseHint?: string
}) {
  const [payEvery, setPayEvery] = useState<'yearly' | 'monthly'>('yearly')
  const shown = tierPlans(plans, payEvery)
  if (shown.length === 0) return null
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="inline-flex rounded-full border border-border bg-card p-0.5" role="radiogroup" aria-label="How to pay">
        {(['yearly', 'monthly'] as const).map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={payEvery === i}
            onClick={() => setPayEvery(i)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              payEvery === i ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {i === 'yearly' ? 'Pay yearly · save more' : 'Pay monthly'}
          </button>
        ))}
      </div>

      <div className="grid w-full gap-5 pt-2 md:grid-cols-3">
        {shown.map((p) => {
          const highlight = p.badge === 'Most Popular'
          const words = quoteWords(p, quotes?.find((q) => q.plan_id === p.id), formatINR)
          const day = perDay(p)
          const monthly = p.billing_interval === 'monthly' ? p.price : (p.monthly_equivalent ?? Math.round(p.price / 12))
          return (
            <Card key={p.id} className={cn('relative flex flex-col', highlight && 'border-primary ring-2 ring-primary')}>
              {highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                  Most popular
                </span>
              )}
              <CardContent className="flex flex-1 flex-col gap-4 p-5">
                <div>
                  <p className="text-lg font-semibold">{p.name}</p>
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                </div>
                <div>
                  <p className="text-3xl font-bold tabular-nums">
                    {formatINR(monthly)}
                    <span className="text-sm font-normal text-muted-foreground"> /month</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {day != null ? (
                      <>
                        {formatINR(p.price)} a year · <span className="font-medium text-success">just {formatINR(day)} a day</span>
                      </>
                    ) : (
                      'Billed every month'
                    )}
                  </p>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  {(p.features ?? []).map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex flex-col gap-1.5">
                  <Button
                    variant={highlight ? 'default' : 'outline'}
                    onClick={() => onChoose(p)}
                    disabled={busy || words.disabled || !canChoose}
                    title={canChoose ? undefined : chooseHint}
                  >
                    {busy ? 'Processing…' : words.button}
                  </Button>
                  {words.line && <p className="text-center text-xs text-muted-foreground">{words.line}</p>}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="flex w-full flex-col items-center gap-3">
        <p className="text-sm font-semibold">Every plan has every feature</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {INCLUDED.map((f) => (
            <li key={f.label} className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 text-sm">
              <IconTile icon={ICONS[f.icon]} tone={f.tone} size="sm" className="rounded-full" />
              {f.label}
            </li>
          ))}
        </ul>
      </div>

      <ComparePlans plans={shown} />
    </div>
  )
}

function CellView({ c }: { c: Cell }) {
  if (c.kind === 'yes') return <Check className="mx-auto size-4 text-success" aria-label="Included" />
  if (c.kind === 'no') return <X className="mx-auto size-4 text-muted-foreground/60" aria-label="Not included" />
  return <span className={cn('text-xs sm:text-sm', c.text === 'Unlimited' ? 'font-medium' : 'tabular-nums')}>{c.text}</span>
}

/** Closed until pressed; only the rows that differ between the plans. */
function ComparePlans({ plans }: { plans: Plan[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Compare plans
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </Button>
      {open && (
        <Card className="w-full max-w-3xl">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 pl-3 text-left font-medium text-muted-foreground" />
                  {plans.map((p) => (
                    <th key={p.id} className={cn('w-20 px-1.5 py-3 text-center font-semibold sm:w-28 sm:px-3', p.badge === 'Most Popular' && 'text-primary')}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-0">
                    <td className="py-3 pl-3 pr-1.5 text-xs sm:text-sm">{r.label}</td>
                    {plans.map((p) => (
                      <td key={p.id} className="whitespace-nowrap px-1.5 py-3 text-center sm:px-3">
                        <CellView c={r.cell(p)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
